import crypto from 'node:crypto';
import { AbiCoder, getAddress, Interface, JsonRpcProvider, zeroPadValue } from 'ethers';
import { AppDatabase } from '../db.js';
import { AppConfig } from '../config.js';
import { LedgerService } from './ledgerService.js';
import { DepositService } from './depositService.js';
import { ERC20_TRANSFER_TOPIC } from '../../shared/constants.js';
import {
  addRawAmounts,
  compareRawAmounts,
  formatRawTokenAmount,
  parseTokenAmountToRaw,
} from '../../shared/units.js';
import { ChainTransferDTO, IndexerHealthDTO } from '../../shared/types.js';

const ERC20_IFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export interface RawEvmTransferLog {
  chainId: number;
  blockNumber: number;
  blockHash: string;
  txHash: string;
  logIndex: number;
  tokenContract: string;
  tokenSymbolHint?: string | null;
  topics: string[];
  data: string;
}

export class IndexerService {
  private rpcProvider: JsonRpcProvider | null = null;
  private workerTimer: NodeJS.Timeout | null = null;
  private syncing = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig,
    private readonly ledgerService: LedgerService,
    private readonly depositService: DepositService
  ) {
    if (this.config.bscRpcUrl) {
      this.rpcProvider = new JsonRpcProvider(this.config.bscRpcUrl, this.config.chainId, {
        staticNetwork: true,
      });
    }
  }

  async ensureIndexerState(): Promise<void> {
    const mode = this.rpcProvider ? 'rpc' : 'simulator';
    const existing = await this.db.get<Record<string, unknown>>(
      `SELECT * FROM indexer_state WHERE chain = ?`,
      [this.config.networkKey]
    );

    const nowIso = new Date().toISOString();
    if (!existing) {
      const initialBlock = this.rpcProvider ? 0 : 44210800;
      await this.db.run(
        `INSERT INTO indexer_state (
           chain, mode, last_processed_block, chain_head_block,
           rpc_status, last_heartbeat_at, last_error, auto_mine
         ) VALUES (?, ?, ?, ?, 'healthy', ?, NULL, 1)`,
        [this.config.networkKey, mode, initialBlock, initialBlock, nowIso]
      );
    } else if (existing.mode !== mode) {
      // If transitioning from simulator mode to live RPC mode, reset cursor to 0 so live RPC
      // initializes cleanly from the real chain head!
      const resetCursor = mode === 'rpc' ? 0 : Number(existing.last_processed_block);
      await this.db.run(
        `UPDATE indexer_state
         SET mode = ?, last_processed_block = ?, last_heartbeat_at = ?
         WHERE chain = ?`,
        [mode, resetCursor, nowIso, this.config.networkKey]
      );
    } else {
      await this.db.run(
        `UPDATE indexer_state SET last_heartbeat_at = ? WHERE chain = ?`,
        [nowIso, this.config.networkKey]
      );
    }
  }

  startBackgroundWorker(intervalMs?: number): void {
    if (this.workerTimer) return;
    const effectiveInterval =
      intervalMs ?? (this.rpcProvider ? this.config.rpcPollIntervalMs : 1200);
    this.workerTimer = setInterval(() => {
      void this.tickBackground();
    }, effectiveInterval);
  }

  stopBackgroundWorker(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  private async tickBackground(): Promise<void> {
    if (this.syncing) return;
    try {
      if (!this.rpcProvider) {
        const state = await this.getStateRow();
        if (Number(state.auto_mine) === 1) {
          const pendingConfirming = await this.db.get<{ cnt: number | string }>(
            `SELECT COUNT(*) AS cnt FROM chain_transfers
             WHERE status IN ('detected', 'confirming')
               AND confirmations < ?`,
            [this.config.requiredConfirmations]
          );

          if (Number(pendingConfirming?.cnt ?? 0) > 0) {
            await this.db.run(
              `UPDATE indexer_state
               SET chain_head_block = chain_head_block + 1
               WHERE chain = ?`,
              [this.config.networkKey]
            );
          }
        }
      }
      await this.syncOnce();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.db.run(
        `UPDATE indexer_state
         SET rpc_status = 'degraded', last_error = ?, last_heartbeat_at = ?
         WHERE chain = ?`,
        [msg, new Date().toISOString(), this.config.networkKey]
      );
    }
  }

  async setAutoMine(enabled: boolean): Promise<IndexerHealthDTO> {
    await this.db.run(`UPDATE indexer_state SET auto_mine = ? WHERE chain = ?`, [
      enabled ? 1 : 0,
      this.config.networkKey,
    ]);
    return this.getHealth();
  }

  async simulateTransferOnChain(params: {
    toAddress: string;
    amountUsdt: string;
    fromAddress?: string;
    tokenContract?: string;
    tokenSymbolHint?: string;
    chainId?: number;
    txHash?: string;
    logIndex?: number;
    advanceBlocks?: number;
  }): Promise<ChainTransferDTO> {
    if (!this.config.simulatorEnabled) {
      throw new Error('Simulator is disabled in live production mode.');
    }

    const cleanTo = getAddress(params.toAddress.trim());
    const cleanFrom = getAddress(
      params.fromAddress?.trim() || '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3'
    );
    const tokenContract = getAddress(
      params.tokenContract?.trim() || this.config.usdtTokenContract
    );
    const chainId = params.chainId ?? this.config.chainId;
    const amountRaw = parseTokenAmountToRaw(params.amountUsdt, this.config.usdtDecimals);

    const txHash =
      params.txHash?.trim().toLowerCase() || `0x${crypto.randomBytes(32).toString('hex')}`;
    const logIndex = params.logIndex ?? 0;

    const topics = [
      ERC20_TRANSFER_TOPIC,
      zeroPadValue(cleanFrom, 32),
      zeroPadValue(cleanTo, 32),
    ];
    const dataHex = AbiCoder.defaultAbiCoder().encode(['uint256'], [BigInt(amountRaw)]);

    await this.db.transaction(async () => {
      const existingSim = await this.db.get<Record<string, unknown>>(
        `SELECT * FROM simulated_chain_logs WHERE tx_hash = ? AND log_index = ?`,
        [txHash, logIndex]
      );

      if (!existingSim) {
        const state = await this.getStateRow();
        const nextBlock = Number(state.chain_head_block) + 1;
        const blockHash = `0x${crypto
          .createHash('sha256')
          .update(`bsc-block-${nextBlock}`)
          .digest('hex')}`;

        await this.db.run(`UPDATE indexer_state SET chain_head_block = ? WHERE chain = ?`, [
          nextBlock,
          this.config.networkKey,
        ]);

        await this.db.run(
          `INSERT INTO simulated_chain_logs (
             id, chain_id, block_number, block_hash, tx_hash, log_index,
             token_contract, token_symbol_hint, topics_json, data_hex, reorged, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [
            `simlog_${crypto.randomBytes(8).toString('hex')}`,
            chainId,
            nextBlock,
            blockHash,
            txHash,
            logIndex,
            tokenContract,
            params.tokenSymbolHint ??
              (tokenContract.toLowerCase() === this.config.usdtTokenContract.toLowerCase()
                ? 'USDT'
                : 'FAKE_USDT'),
            JSON.stringify(topics),
            dataHex,
            new Date().toISOString(),
          ]
        );
      } else {
        await this.processRawLog({
          chainId: Number(existingSim.chain_id),
          blockNumber: Number(existingSim.block_number),
          blockHash: String(existingSim.block_hash),
          txHash: String(existingSim.tx_hash),
          logIndex: Number(existingSim.log_index),
          tokenContract: String(existingSim.token_contract),
          tokenSymbolHint: (existingSim.token_symbol_hint as string | null) ?? null,
          topics: JSON.parse(String(existingSim.topics_json)) as string[],
          data: String(existingSim.data_hex),
        });
      }

      if (params.advanceBlocks && params.advanceBlocks > 0) {
        await this.db.run(
          `UPDATE indexer_state
           SET chain_head_block = chain_head_block + ?
           WHERE chain = ?`,
          [params.advanceBlocks, this.config.networkKey]
        );
      }
    });

    await this.syncOnce();

    const row = await this.db.get<Record<string, unknown>>(
      `SELECT * FROM chain_transfers WHERE chain = ? AND tx_hash = ? AND log_index = ?`,
      [this.config.networkKey, txHash, logIndex]
    );

    if (!row) {
      throw new Error(
        'Transfer recipient does not belong to any allocated RicsWallet deposit address.'
      );
    }
    return this.depositService.mapTransferRow(row);
  }

  async mineSimulatedBlocks(blocks: number): Promise<IndexerHealthDTO> {
    if (!this.config.simulatorEnabled) {
      throw new Error('Simulator is disabled in live production mode.');
    }
    if (blocks < 1 || blocks > 1000) {
      throw new Error('Block count must be between 1 and 1000.');
    }
    await this.db.run(
      `UPDATE indexer_state
       SET chain_head_block = chain_head_block + ?
       WHERE chain = ?`,
      [blocks, this.config.networkKey]
    );

    await this.syncOnce();
    return this.getHealth();
  }

  async simulateReorg(txHash: string): Promise<ChainTransferDTO> {
    if (!this.config.simulatorEnabled) {
      throw new Error('Simulator is disabled in live production mode.');
    }
    const normalizedHash = txHash.trim().toLowerCase();
    const transfer = await this.db.get<Record<string, unknown>>(
      `SELECT * FROM chain_transfers WHERE tx_hash = ?`,
      [normalizedHash]
    );

    if (!transfer) {
      throw new Error('Transaction hash not found.');
    }
    if (transfer.status === 'credited') {
      throw new Error('Cannot reorg an already finalized & credited transfer.');
    }

    await this.db.run(`UPDATE simulated_chain_logs SET reorged = 1 WHERE tx_hash = ?`, [
      normalizedHash,
    ]);

    await this.syncOnce();

    const updated = await this.db.get<Record<string, unknown>>(
      `SELECT * FROM chain_transfers WHERE id = ?`,
      [String(transfer.id)]
    );
    return this.depositService.mapTransferRow(updated!);
  }

  async verifyAndIngestWebhook(
    rawPayload: string,
    signatureHeader: string | undefined,
    event: {
      chainId: number;
      blockNumber: number;
      blockHash: string;
      txHash: string;
      logIndex: number;
      tokenContract: string;
      fromAddress: string;
      toAddress: string;
      amountRaw: string;
    }
  ): Promise<ChainTransferDTO | null> {
    const expectedHmac = crypto
      .createHmac('sha256', this.config.webhookHmacSecret)
      .update(rawPayload)
      .digest('hex');

    if (
      !signatureHeader ||
      signatureHeader.length !== expectedHmac.length ||
      !crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedHmac))
    ) {
      throw new Error('Invalid webhook HMAC signature.');
    }

    const topics = [
      ERC20_TRANSFER_TOPIC,
      zeroPadValue(getAddress(event.fromAddress), 32),
      zeroPadValue(getAddress(event.toAddress), 32),
    ];
    const data = AbiCoder.defaultAbiCoder().encode(['uint256'], [BigInt(event.amountRaw)]);

    await this.db.transaction(async () => {
      const state = await this.getStateRow();
      if (event.blockNumber > Number(state.chain_head_block)) {
        await this.db.run(`UPDATE indexer_state SET chain_head_block = ? WHERE chain = ?`, [
          event.blockNumber,
          this.config.networkKey,
        ]);
      }

      if (!this.rpcProvider) {
        await this.db.run(
          `INSERT INTO simulated_chain_logs (
             id, chain_id, block_number, block_hash, tx_hash, log_index,
             token_contract, token_symbol_hint, topics_json, data_hex, reorged, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'USDT', ?, ?, 0, ?)
           ON CONFLICT (tx_hash, log_index) DO NOTHING`,
          [
            `whlog_${crypto.randomBytes(8).toString('hex')}`,
            event.chainId,
            event.blockNumber,
            event.blockHash,
            event.txHash.toLowerCase(),
            event.logIndex,
            getAddress(event.tokenContract),
            JSON.stringify(topics),
            data,
            new Date().toISOString(),
          ]
        );
      }

      await this.processRawLog({
        chainId: event.chainId,
        blockNumber: event.blockNumber,
        blockHash: event.blockHash,
        txHash: event.txHash.toLowerCase(),
        logIndex: event.logIndex,
        tokenContract: getAddress(event.tokenContract),
        topics,
        data,
      });
    });

    await this.verifyAndFinalizeCredits();

    const row = await this.db.get<Record<string, unknown>>(
      `SELECT * FROM chain_transfers WHERE chain = ? AND tx_hash = ? AND log_index = ?`,
      [this.config.networkKey, event.txHash.toLowerCase(), event.logIndex]
    );

    return row ? this.depositService.mapTransferRow(row) : null;
  }

  async syncOnce(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      await this.depositService.expireStaleInvoices();

      if (this.rpcProvider) {
        await this.syncFromLiveRpc();
      } else {
        await this.syncFromSimulatorLogs();
      }

      await this.verifyAndFinalizeCredits();

      await this.db.run(
        `UPDATE indexer_state
         SET rpc_status = 'healthy', last_error = NULL, last_heartbeat_at = ?
         WHERE chain = ?`,
        [new Date().toISOString(), this.config.networkKey]
      );
    } finally {
      this.syncing = false;
    }
  }

  private async syncFromLiveRpc(): Promise<void> {
    if (!this.rpcProvider) return;
    const headBlock = await this.rpcProvider.getBlockNumber();
    const state = await this.getStateRow();
    let cursor = Number(state.last_processed_block);

    // Initialize cursor on very first connect to live BSC RPC
    if (cursor <= 0 || cursor > headBlock) {
      cursor = Math.max(0, headBlock - 20);
      await this.db.run(
        `UPDATE indexer_state SET last_processed_block = ?, chain_head_block = ? WHERE chain = ?`,
        [cursor, headBlock, this.config.networkKey]
      );
    } else {
      await this.db.run(`UPDATE indexer_state SET chain_head_block = ? WHERE chain = ?`, [
        headBlock,
        this.config.networkKey,
      ]);
    }

    const addrRows = await this.db.all<{ address: string }>(
      `SELECT address FROM deposit_addresses WHERE network = ? AND status = 'active'`,
      [this.config.networkKey]
    );

    if (addrRows.length === 0) {
      await this.db.run(`UPDATE indexer_state SET last_processed_block = ? WHERE chain = ?`, [
        headBlock,
        this.config.networkKey,
      ]);
      return;
    }

    const paddedRecipients = addrRows.map((a) => zeroPadValue(getAddress(a.address), 32));
    let batchSize = Math.max(10, this.config.rpcLogBatchBlocks);
    const targetHead = Math.min(headBlock, cursor + 2000); // Smooth bounded catch-up per cycle

    while (cursor < targetHead) {
      const fromBlock = cursor + 1;
      const toBlock = Math.min(fromBlock + batchSize - 1, targetHead);

      try {
        const logs = await this.rpcProvider.getLogs({
          address: this.config.usdtTokenContract,
          fromBlock,
          toBlock,
          topics: [ERC20_TRANSFER_TOPIC, null, paddedRecipients],
        });

        await this.db.transaction(async () => {
          for (const log of logs) {
            await this.processRawLog({
              chainId: this.config.chainId,
              blockNumber: log.blockNumber,
              blockHash: log.blockHash,
              txHash: log.transactionHash.toLowerCase(),
              logIndex: log.index,
              tokenContract: getAddress(log.address),
              tokenSymbolHint: 'USDT',
              topics: [...log.topics],
              data: log.data,
            });
          }

          await this.db.run(
            `UPDATE indexer_state SET last_processed_block = ? WHERE chain = ?`,
            [toBlock, this.config.networkKey]
          );
        });

        cursor = toBlock;
      } catch (err) {
        // If RPC provider complains about block range size, halve batch size and retry cleanly
        if (batchSize > 10) {
          batchSize = Math.max(10, Math.floor(batchSize / 2));
          continue;
        }
        throw err;
      }
    }
  }

  private async syncFromSimulatorLogs(): Promise<void> {
    await this.db.transaction(async () => {
      const state = await this.getStateRow();
      const cursor = Number(state.last_processed_block);
      const headBlock = Number(state.chain_head_block);

      if (cursor < headBlock) {
        const simLogs = await this.db.all<Record<string, unknown>>(
          `SELECT * FROM simulated_chain_logs
           WHERE block_number > ? AND block_number <= ? AND reorged = 0
           ORDER BY block_number ASC, log_index ASC`,
          [cursor, headBlock]
        );

        for (const sim of simLogs) {
          await this.processRawLog({
            chainId: Number(sim.chain_id),
            blockNumber: Number(sim.block_number),
            blockHash: String(sim.block_hash),
            txHash: String(sim.tx_hash),
            logIndex: Number(sim.log_index),
            tokenContract: String(sim.token_contract),
            tokenSymbolHint: (sim.token_symbol_hint as string | null) ?? null,
            topics: JSON.parse(String(sim.topics_json)) as string[],
            data: String(sim.data_hex),
          });
        }

        await this.db.run(
          `UPDATE indexer_state SET last_processed_block = ? WHERE chain = ?`,
          [headBlock, this.config.networkKey]
        );
      }
    });
  }

  private async processRawLog(raw: RawEvmTransferLog): Promise<void> {
    if (!raw.topics || raw.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) {
      return;
    }

    const decoded = ERC20_IFACE.decodeEventLog('Transfer', raw.data, raw.topics);
    const fromAddress = getAddress(String(decoded[0]));
    const toAddress = getAddress(String(decoded[1]));
    const amountBig = decoded[2] as bigint;
    const amountRaw = amountBig.toString();

    if (amountBig <= 0n) {
      return;
    }

    const txHash = raw.txHash.toLowerCase();

    const existing = await this.db.get<{ id: string }>(
      `SELECT id FROM chain_transfers WHERE chain = ? AND tx_hash = ? AND log_index = ?`,
      [this.config.networkKey, txHash, raw.logIndex]
    );

    if (existing) {
      return;
    }

    const addrRecord = await this.db.get<Record<string, unknown>>(
      `SELECT * FROM deposit_addresses
       WHERE address_lower = ? AND status = 'active'
       LIMIT 1`,
      [toAddress.toLowerCase()]
    );

    if (!addrRecord) {
      return;
    }

    const userId = String(addrRecord.assigned_user_id);
    const invoiceId = (addrRecord.assigned_invoice_id as string | null) ?? null;
    const invoiceRow = invoiceId
      ? await this.db.get<Record<string, unknown>>(
          `SELECT * FROM deposit_invoices WHERE id = ?`,
          [invoiceId]
        )
      : undefined;

    const nowIso = new Date().toISOString();
    const state = await this.getStateRow();
    const confirmations = Math.max(1, Number(state.chain_head_block) - raw.blockNumber + 1);

    let status = 'confirming';
    let validationCode: string | null = 'OK';
    let validationMessage: string | null = 'Valid BEP-20 USDT transfer detected; awaiting finality.';

    if (raw.chainId !== this.config.chainId) {
      status = 'review';
      validationCode = 'WRONG_NETWORK';
      validationMessage = `Received transfer on unsupported Chain ID ${raw.chainId} (expected BSC Chain ID ${this.config.chainId}). Contact support.`;
    } else if (raw.tokenContract.toLowerCase() !== this.config.usdtTokenContract.toLowerCase()) {
      status = 'review';
      validationCode = 'WRONG_TOKEN_CONTRACT';
      validationMessage = `Unapproved token contract ${raw.tokenContract}. Only official BSC USDT (${this.config.usdtTokenContract}) is credited.`;
    } else if (
      invoiceRow &&
      (invoiceRow.status === 'expired' || invoiceRow.status === 'cancelled') &&
      this.config.lateDepositPolicy === 'review'
    ) {
      status = 'review';
      validationCode = 'LATE_DEPOSIT';
      validationMessage =
        'Transfer arrived after deposit request expired. Queued for support review & reconciliation.';
    }

    const transferId = `txf_${crypto.randomBytes(8).toString('hex')}`;
    await this.db.run(
      `INSERT INTO chain_transfers (
         id, chain, chain_id, tx_hash, log_index, block_number, block_hash,
         token_contract, token_symbol_hint, from_address, to_address, to_address_lower,
         amount_raw, confirmations, invoice_id, user_id, status,
         validation_code, validation_message, ledger_entry_id, credited_at, observed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [
        transferId,
        this.config.networkKey,
        raw.chainId,
        txHash,
        raw.logIndex,
        raw.blockNumber,
        raw.blockHash,
        raw.tokenContract,
        raw.tokenSymbolHint ?? null,
        fromAddress,
        toAddress,
        toAddress.toLowerCase(),
        amountRaw,
        confirmations,
        invoiceId,
        userId,
        status,
        validationCode,
        validationMessage,
        nowIso,
      ]
    );

    if (invoiceRow && invoiceId) {
      if (status === 'review') {
        await this.db.run(
          `UPDATE deposit_invoices
           SET status = CASE WHEN status = 'confirmed' THEN 'confirmed' ELSE 'review' END,
               status_reason = ?,
               tx_hash = COALESCE(tx_hash, ?),
               confirmations = ?,
               updated_at = ?
           WHERE id = ?`,
          [validationMessage, txHash, confirmations, nowIso, invoiceId]
        );
      } else {
        const nextDetected = addRawAmounts(String(invoiceRow.detected_amount_raw ?? '0'), amountRaw);
        await this.db.run(
          `UPDATE deposit_invoices
           SET detected_amount_raw = ?,
               tx_hash = ?,
               confirmations = ?,
               status = CASE WHEN status = 'confirmed' THEN 'confirmed' ELSE 'detected' END,
               status_reason = 'On-chain transfer detected — waiting for block confirmations.',
               updated_at = ?
           WHERE id = ?`,
          [nextDetected, txHash, confirmations, nowIso, invoiceId]
        );
      }
    }
  }

  /**
   * Step 6 & 7: Re-verify inclusion (handling reorgs on both Simulator and Live BSC RPC!)
   * outside the DB lock first, then atomically finalize confirmations & ledger credits.
   */
  private async verifyAndFinalizeCredits(): Promise<void> {
    const state = await this.getStateRow();
    const headBlock = Number(state.chain_head_block);

    const activeTransfers = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM chain_transfers
       WHERE chain = ?
         AND status IN ('detected', 'confirming', 'review')`,
      [this.config.networkKey]
    );

    // Pre-fetch live RPC receipts (network I/O done outside DB transaction!) for transfers reaching finality
    const reorgedIds = new Set<string>();
    const canonicalBlockByTransferId = new Map<string, number>();

    if (this.rpcProvider) {
      for (const tr of activeTransfers) {
        const provisionalConfs = Math.max(1, headBlock - Number(tr.block_number) + 1);
        if (provisionalConfs >= this.config.requiredConfirmations) {
          const receipt = await this.rpcProvider.getTransactionReceipt(String(tr.tx_hash));
          if (!receipt || receipt.status !== 1) {
            reorgedIds.add(String(tr.id));
          } else {
            canonicalBlockByTransferId.set(String(tr.id), receipt.blockNumber);
          }
        }
      }
    }

    await this.db.transaction(async () => {
      const nowIso = new Date().toISOString();
      const candidateInvoiceIds = new Set<string>();

      for (const tr of activeTransfers) {
        const trId = String(tr.id);
        const txHash = String(tr.tx_hash);
        const logIndex = Number(tr.log_index);
        const invoiceId = (tr.invoice_id as string | null) ?? null;

        let isReorged = reorgedIds.has(trId);
        if (!this.rpcProvider) {
          const simLog = await this.db.get<{ reorged: number }>(
            `SELECT reorged FROM simulated_chain_logs WHERE tx_hash = ? AND log_index = ?`,
            [txHash, logIndex]
          );
          if (simLog && Number(simLog.reorged) === 1) {
            isReorged = true;
          }
        }

        if (isReorged) {
          await this.db.run(
            `UPDATE chain_transfers
             SET status = 'reorged',
                 confirmations = 0,
                 validation_code = 'CHAIN_REORG',
                 validation_message = 'Transaction dropped or reverted during chain reorganization before finality.'
             WHERE id = ?`,
            [trId]
          );

          if (invoiceId) {
            const sub = await this.db.get<{ detected_amount_raw: string }>(
              `SELECT detected_amount_raw FROM deposit_invoices WHERE id = ?`,
              [invoiceId]
            );
            const prevDetected = BigInt(sub?.detected_amount_raw ?? '0');
            const reduced =
              prevDetected > BigInt(String(tr.amount_raw))
                ? (prevDetected - BigInt(String(tr.amount_raw))).toString()
                : '0';

            await this.db.run(
              `UPDATE deposit_invoices
               SET detected_amount_raw = ?,
                   confirmations = 0,
                   status = CASE WHEN status = 'confirmed' THEN 'confirmed' ELSE 'waiting' END,
                   status_reason = 'Unconfirmed transaction rolled back due to chain reorg. Waiting for valid deposit.',
                   updated_at = ?
               WHERE id = ?`,
              [reduced, nowIso, invoiceId]
            );
          }
          continue;
        }

        const effectiveBlock = canonicalBlockByTransferId.get(trId) ?? Number(tr.block_number);
        const confirmations = Math.max(1, headBlock - effectiveBlock + 1);

        if (confirmations !== Number(tr.confirmations) || effectiveBlock !== Number(tr.block_number)) {
          await this.db.run(
            `UPDATE chain_transfers SET confirmations = ?, block_number = ? WHERE id = ?`,
            [confirmations, effectiveBlock, trId]
          );
        }

        if (
          invoiceId &&
          (tr.status === 'detected' || tr.status === 'confirming') &&
          confirmations < this.config.requiredConfirmations
        ) {
          await this.db.run(
            `UPDATE deposit_invoices
             SET confirmations = ?,
                 status = CASE WHEN status = 'confirmed' THEN 'confirmed' ELSE 'detected' END,
                 status_reason = ?,
                 updated_at = ?
             WHERE id = ?`,
            [
              confirmations,
              `Confirming on BNB Smart Chain (${confirmations} / ${this.config.requiredConfirmations} confirmations)…`,
              nowIso,
              invoiceId,
            ]
          );
        }

        const vCode = (tr.validation_code as string | null) ?? 'OK';
        if (
          confirmations >= this.config.requiredConfirmations &&
          (vCode === 'OK' || vCode === 'UNDERPAYMENT_HOLD') &&
          invoiceId
        ) {
          candidateInvoiceIds.add(invoiceId);
        }
      }

      for (const invoiceId of candidateInvoiceIds) {
        const invRow = await this.db.get<Record<string, unknown>>(
          `SELECT * FROM deposit_invoices WHERE id = ?`,
          [invoiceId]
        );
        if (!invRow) continue;

        const eligibleTransfers = await this.db.all<Record<string, unknown>>(
          `SELECT * FROM chain_transfers
           WHERE invoice_id = ?
             AND confirmations >= ?
             AND status IN ('detected', 'confirming', 'review')
             AND COALESCE(validation_code, 'OK') IN ('OK', 'UNDERPAYMENT_HOLD')
             AND credited_at IS NULL
           ORDER BY block_number ASC, log_index ASC`,
          [invoiceId, this.config.requiredConfirmations]
        );

        if (eligibleTransfers.length === 0) continue;

        let cumulativeValidRaw = String(invRow.credited_amount_raw ?? '0');
        for (const et of eligibleTransfers) {
          cumulativeValidRaw = addRawAmounts(cumulativeValidRaw, String(et.amount_raw));
        }

        const minimumRaw = String(invRow.minimum_amount_raw);

        if (compareRawAmounts(cumulativeValidRaw, minimumRaw) < 0) {
          const receivedFmt = formatRawTokenAmount(cumulativeValidRaw, this.config.usdtDecimals);
          const minFmt = formatRawTokenAmount(minimumRaw, this.config.usdtDecimals);
          const shortfallRaw = (BigInt(minimumRaw) - BigInt(cumulativeValidRaw)).toString();
          const shortfallFmt = formatRawTokenAmount(shortfallRaw, this.config.usdtDecimals);
          const holdMsg = `Received ${receivedFmt} USDT — below minimum deposit of ${minFmt} USDT. Send at least ${shortfallFmt} USDT more to this address to credit automatically, or contact support.`;

          for (const et of eligibleTransfers) {
            await this.db.run(
              `UPDATE chain_transfers
               SET status = 'review',
                   validation_code = 'UNDERPAYMENT_HOLD',
                   validation_message = ?
               WHERE id = ?`,
              [holdMsg, String(et.id)]
            );
          }

          await this.db.run(
            `UPDATE deposit_invoices
             SET status = 'review',
                 confirmations = ?,
                 status_reason = ?,
                 updated_at = ?
             WHERE id = ?`,
            [this.config.requiredConfirmations, holdMsg, nowIso, invoiceId]
          );
          continue;
        }

        let newlyCreditedSum = '0';
        let latestTxHash = (invRow.tx_hash as string | null) ?? null;
        let maxConf = Number(invRow.confirmations ?? this.config.requiredConfirmations);

        for (const et of eligibleTransfers) {
          const etId = String(et.id);
          const txHash = String(et.tx_hash);
          const logIndex = Number(et.log_index);
          const amountRaw = String(et.amount_raw);
          const idempotencyKey = `chain_tx:${String(et.chain)}:${txHash}:${logIndex}`;

          const { entry, alreadyExisted } = await this.ledgerService.creditUserAccount({
            userId: String(invRow.user_id),
            amountRaw,
            sourceType: 'chain_transfer',
            sourceId: etId,
            idempotencyKey,
            invoiceId,
            txHash,
            note: `Confirmed BEP-20 USDT deposit (${String(et.confirmations)} confirmations)`,
          });

          await this.db.run(
            `UPDATE chain_transfers
             SET status = 'credited',
                 validation_code = 'OK',
                 validation_message = 'Confirmed & credited to ledger.',
                 ledger_entry_id = ?,
                 credited_at = ?
             WHERE id = ?`,
            [entry.id, nowIso, etId]
          );

          if (!alreadyExisted) {
            newlyCreditedSum = addRawAmounts(newlyCreditedSum, amountRaw);
          }
          latestTxHash = txHash;
          maxConf = Math.max(maxConf, Number(et.confirmations));
        }

        const totalCreditedOnInvoice = addRawAmounts(
          String(invRow.credited_amount_raw ?? '0'),
          newlyCreditedSum
        );

        await this.db.run(
          `UPDATE deposit_invoices
           SET status = 'confirmed',
               credited_amount_raw = ?,
               confirmations = ?,
               tx_hash = COALESCE(?, tx_hash),
               status_reason = 'Required confirmations reached; ledger credit posted.',
               updated_at = ?
           WHERE id = ?`,
          [totalCreditedOnInvoice, maxConf, latestTxHash, nowIso, invoiceId]
        );
      }
    });
  }

  async getHealth(): Promise<IndexerHealthDTO> {
    const state = await this.getStateRow();
    const lastProcessed = Number(state.last_processed_block);
    const headBlock = Number(state.chain_head_block);

    const reviewRow = await this.db.get<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM chain_transfers WHERE status = 'review'`
    );

    const unmatchedRow = await this.db.get<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM chain_transfers WHERE user_id IS NULL`
    );

    return {
      chain: this.config.networkKey,
      mode: (state.mode as 'rpc' | 'simulator') ?? 'simulator',
      chainId: this.config.chainId,
      networkLabel: this.config.networkLabel,
      officialUsdtContract: this.config.usdtTokenContract,
      requiredConfirmations: this.config.requiredConfirmations,
      minimumDepositFormatted: formatRawTokenAmount(
        this.config.minDepositRaw,
        this.config.usdtDecimals
      ),
      lastProcessedBlock: lastProcessed,
      chainHeadBlock: headBlock,
      blockLag: Math.max(0, headBlock - lastProcessed),
      rpcStatus: (state.rpc_status as 'healthy' | 'degraded' | 'offline') ?? 'healthy',
      lastHeartbeatAt: String(state.last_heartbeat_at),
      lastError: (state.last_error as string | null) ?? null,
      unmatchedTransfersCount: Number(unmatchedRow?.cnt ?? 0),
      reviewQueueCount: Number(reviewRow?.cnt ?? 0),
      autoMineEnabled: Number(state.auto_mine ?? 1) === 1,
    };
  }

  private async getStateRow(): Promise<Record<string, unknown>> {
    await this.ensureIndexerState();
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT * FROM indexer_state WHERE chain = ?`,
      [this.config.networkKey]
    );
    return row!;
  }
}
