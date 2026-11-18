import crypto from 'node:crypto';
import { AppDatabase } from '../db.js';
import { AppConfig } from '../config.js';
import { HdAddressService } from '../wallet/hdAddressService.js';
import { LedgerService } from './ledgerService.js';
import { formatRawTokenAmount, parseTokenAmountToRaw } from '../../shared/units.js';
import {
  ChainTransferDTO,
  DepositInvoiceDTO,
  InvoiceStatus,
  TransferStatus,
} from '../../shared/types.js';

export class DepositService {
  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig,
    private readonly hdWallet: HdAddressService,
    private readonly ledgerService: LedgerService
  ) {}

  async expireStaleInvoices(nowIso: string = new Date().toISOString()): Promise<number> {
    const res = await this.db.run(
      `UPDATE deposit_invoices
       SET status = 'expired',
           status_reason = 'Deposit window expired before any transfer was detected.',
           updated_at = ?
       WHERE status = 'waiting'
         AND expires_at <= ?`,
      [nowIso, nowIso]
    );
    return res.changes;
  }

  async createOrGetInvoice(
    userId: string,
    options: { expectedAmountUsdt?: string; forceNew?: boolean } = {}
  ): Promise<DepositInvoiceDTO> {
    // CRITICAL LIVE-FUNDS SAFETY CHECK:
    // If connected to a real BSC RPC (live blockchain mode), refuse to issue addresses from
    // the public demo XPUB so nobody ever sends real USDT to an unowned demo key!
    if (this.config.bscRpcUrl && this.config.isDefaultDemoXpub) {
      throw new Error(
        'CUSTODY CONFIGURATION REQUIRED: BSC_RPC_URL is active, but DEPOSIT_WALLET_XPUB is still the built-in demo key. Generate your own watch-only xpub (`npm run generate-xpub`) and set DEPOSIT_WALLET_XPUB in your environment variables before accepting real deposits.'
      );
    }

    await this.expireStaleInvoices();

    const now = new Date();
    const nowIso = now.toISOString();

    if (!options.forceNew && !options.expectedAmountUsdt) {
      const existing = await this.db.get<{ id: string }>(
        `SELECT id FROM deposit_invoices
         WHERE user_id = ?
           AND status IN ('waiting', 'detected')
           AND expires_at > ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, nowIso]
      );

      if (existing) {
        const dto = await this.getInvoiceById(existing.id, userId);
        if (dto) return dto;
      }
    }

    const expectedAmountRaw = options.expectedAmountUsdt?.trim()
      ? parseTokenAmountToRaw(options.expectedAmountUsdt.trim(), this.config.usdtDecimals)
      : null;

    if (expectedAmountRaw !== null && BigInt(expectedAmountRaw) < BigInt(this.config.minDepositRaw)) {
      throw new Error(
        `Expected amount must be at least ${this.config.minDepositUsdt} ${this.config.asset}.`
      );
    }

    const invoiceId = `inv_${crypto.randomBytes(8).toString('hex')}`;
    const addressId = `addr_${crypto.randomBytes(8).toString('hex')}`;
    const expiresAtIso = new Date(
      now.getTime() + this.config.invoiceExpiryMinutes * 60 * 1000
    ).toISOString();

    await this.db.transaction(async () => {
      const idxRow = await this.db.get<{ next_index: number | string }>(
        `SELECT COALESCE(MAX(derivation_index), -1) + 1 AS next_index
         FROM deposit_addresses
         WHERE network = ?`,
        [this.config.networkKey]
      );

      const derived = this.hdWallet.deriveAddress(Number(idxRow?.next_index ?? 0));

      await this.db.run(
        `INSERT INTO deposit_addresses (
           id, address, address_lower, derivation_index, derivation_path,
           assigned_user_id, assigned_invoice_id, network, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
          addressId,
          derived.address,
          derived.addressLower,
          derived.derivationIndex,
          derived.derivationPath,
          userId,
          invoiceId,
          this.config.networkKey,
          nowIso,
        ]
      );

      await this.db.run(
        `INSERT INTO deposit_invoices (
           id, user_id, address_id, address, asset, network, network_label,
           token_contract, decimals, minimum_amount_raw, expected_amount_raw,
           detected_amount_raw, credited_amount_raw, confirmations,
           required_confirmations, tx_hash, status, status_reason,
           created_at, expires_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', '0', 0, ?, NULL, 'waiting', NULL, ?, ?, ?)`,
        [
          invoiceId,
          userId,
          addressId,
          derived.address,
          this.config.asset,
          this.config.networkKey,
          this.config.networkLabel,
          this.config.usdtTokenContract,
          this.config.usdtDecimals,
          this.config.minDepositRaw,
          expectedAmountRaw,
          this.config.requiredConfirmations,
          nowIso,
          expiresAtIso,
          nowIso,
        ]
      );
    });

    const created = await this.getInvoiceById(invoiceId, userId);
    if (!created) {
      throw new Error('Failed to load newly created deposit invoice.');
    }
    return created;
  }

  async cancelInvoice(invoiceId: string, userId: string): Promise<DepositInvoiceDTO> {
    const invoice = await this.getInvoiceById(invoiceId, userId);
    if (!invoice) {
      throw new Error('Deposit invoice not found.');
    }
    if (invoice.status !== 'waiting') {
      throw new Error(`Cannot cancel invoice in "${invoice.status}" state.`);
    }

    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE deposit_invoices
       SET status = 'cancelled',
           status_reason = 'Cancelled by user.',
           updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'waiting'`,
      [nowIso, invoiceId, userId]
    );

    return (await this.getInvoiceById(invoiceId, userId))!;
  }

  async forceExpireInvoice(invoiceId: string): Promise<DepositInvoiceDTO | null> {
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE deposit_invoices
       SET expires_at = ?,
           status = CASE WHEN status = 'waiting' THEN 'expired' ELSE status END,
           status_reason = CASE WHEN status = 'waiting' THEN 'Deposit window expired.' ELSE status_reason END,
           updated_at = ?
       WHERE id = ?`,
      [pastIso, nowIso, invoiceId]
    );
    return this.getInvoiceById(invoiceId);
  }

  async getInvoiceById(
    invoiceId: string,
    restrictUserId?: string
  ): Promise<DepositInvoiceDTO | null> {
    await this.expireStaleInvoices();

    const row = restrictUserId
      ? await this.db.get<Record<string, unknown>>(
          `SELECT i.*, a.derivation_index, a.derivation_path
           FROM deposit_invoices i
           JOIN deposit_addresses a ON a.id = i.address_id
           WHERE i.id = ? AND i.user_id = ?`,
          [invoiceId, restrictUserId]
        )
      : await this.db.get<Record<string, unknown>>(
          `SELECT i.*, a.derivation_index, a.derivation_path
           FROM deposit_invoices i
           JOIN deposit_addresses a ON a.id = i.address_id
           WHERE i.id = ?`,
          [invoiceId]
        );

    if (!row) return null;
    return this.mapInvoiceRow(row);
  }

  async listUserInvoices(userId: string, limit = 50): Promise<DepositInvoiceDTO[]> {
    await this.expireStaleInvoices();

    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT i.*, a.derivation_index, a.derivation_path
       FROM deposit_invoices i
       JOIN deposit_addresses a ON a.id = i.address_id
       WHERE i.user_id = ?
       ORDER BY i.created_at DESC
       LIMIT ?`,
      [userId, limit]
    );

    return Promise.all(rows.map((r) => this.mapInvoiceRow(r)));
  }

  async listUserTransfers(userId: string, limit = 50): Promise<ChainTransferDTO[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM chain_transfers
       WHERE user_id = ?
       ORDER BY observed_at DESC, id DESC
       LIMIT ?`,
      [userId, limit]
    );
    return rows.map((r) => this.mapTransferRow(r));
  }

  async adminResolveReviewTransfer(
    transferId: string,
    action: 'approve_credit' | 'reject',
    adminNote: string
  ): Promise<ChainTransferDTO> {
    return this.db.transaction(async () => {
      const row = await this.db.get<Record<string, unknown>>(
        `SELECT * FROM chain_transfers WHERE id = ?`,
        [transferId]
      );

      if (!row) {
        throw new Error('Chain transfer not found.');
      }

      if (row.status === 'credited') {
        return this.mapTransferRow(row);
      }

      const nowIso = new Date().toISOString();

      if (action === 'reject') {
        await this.db.run(
          `UPDATE chain_transfers
           SET status = 'rejected',
               validation_message = ?
           WHERE id = ?`,
          [adminNote || 'Rejected during admin review.', transferId]
        );

        if (row.invoice_id) {
          await this.db.run(
            `UPDATE deposit_invoices
             SET status = 'review',
                 status_reason = ?,
                 updated_at = ?
             WHERE id = ? AND status != 'confirmed'`,
            [adminNote || 'Transfer rejected by support review.', nowIso, String(row.invoice_id)]
          );
        }

        const updated = await this.db.get<Record<string, unknown>>(
          `SELECT * FROM chain_transfers WHERE id = ?`,
          [transferId]
        );
        return this.mapTransferRow(updated!);
      }

      if (
        row.validation_code === 'WRONG_TOKEN_CONTRACT' ||
        row.validation_code === 'WRONG_NETWORK'
      ) {
        throw new Error(
          `Cannot credit transfer with validation error ${String(row.validation_code)} — token/network does not match official BSC USDT.`
        );
      }

      if (Number(row.confirmations) < this.config.requiredConfirmations) {
        throw new Error(
          `Transfer only has ${String(row.confirmations)}/${this.config.requiredConfirmations} confirmations. Wait for finality before crediting.`
        );
      }

      const userId = row.user_id ? String(row.user_id) : null;
      if (!userId) {
        throw new Error('Transfer is not associated with a known user deposit address.');
      }

      const idempotencyKey = `chain_tx:${String(row.chain)}:${String(row.tx_hash).toLowerCase()}:${String(row.log_index)}`;
      const { entry } = await this.ledgerService.creditUserAccount({
        userId,
        amountRaw: String(row.amount_raw),
        sourceType: 'chain_transfer',
        sourceId: String(row.id),
        idempotencyKey,
        invoiceId: (row.invoice_id as string | null) ?? null,
        txHash: String(row.tx_hash),
        note: adminNote || 'Approved & credited via Admin Review reconciliation',
      });

      await this.db.run(
        `UPDATE chain_transfers
         SET status = 'credited',
             validation_code = 'ADMIN_APPROVED',
             validation_message = ?,
             ledger_entry_id = ?,
             credited_at = ?
         WHERE id = ?`,
        [adminNote || 'Approved by admin review.', entry.id, nowIso, transferId]
      );

      if (row.invoice_id) {
        const inv = await this.db.get<{ credited_amount_raw: string }>(
          `SELECT credited_amount_raw FROM deposit_invoices WHERE id = ?`,
          [String(row.invoice_id)]
        );
        const nextCredited = (
          BigInt(inv?.credited_amount_raw ?? '0') + BigInt(String(row.amount_raw))
        ).toString();

        await this.db.run(
          `UPDATE deposit_invoices
           SET status = 'confirmed',
               credited_amount_raw = ?,
               status_reason = ?,
               updated_at = ?
           WHERE id = ?`,
          [nextCredited, 'Credited following support review.', nowIso, String(row.invoice_id)]
        );
      }

      const updated = await this.db.get<Record<string, unknown>>(
        `SELECT * FROM chain_transfers WHERE id = ?`,
        [transferId]
      );
      return this.mapTransferRow(updated!);
    });
  }

  async adminSearch(rawQuery: string): Promise<{
    query: string;
    invoices: Array<DepositInvoiceDTO & { userEmail: string; userName: string }>;
    transfers: ChainTransferDTO[];
  }> {
    const q = rawQuery.trim();
    const like = `%${q.toLowerCase()}%`;

    const invRows = await this.db.all<Record<string, unknown>>(
      `SELECT i.*, a.derivation_index, a.derivation_path, u.email AS user_email, u.name AS user_name
       FROM deposit_invoices i
       JOIN deposit_addresses a ON a.id = i.address_id
       JOIN users u ON u.id = i.user_id
       WHERE LOWER(i.id) LIKE ?
          OR LOWER(i.address) LIKE ?
          OR LOWER(COALESCE(i.tx_hash, '')) LIKE ?
          OR LOWER(u.email) LIKE ?
          OR LOWER(u.id) LIKE ?
       ORDER BY i.created_at DESC
       LIMIT 25`,
      [like, like, like, like, like]
    );

    const txRows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM chain_transfers
       WHERE LOWER(tx_hash) LIKE ?
          OR LOWER(to_address) LIKE ?
          OR LOWER(from_address) LIKE ?
          OR LOWER(COALESCE(invoice_id, '')) LIKE ?
          OR LOWER(COALESCE(user_id, '')) LIKE ?
       ORDER BY observed_at DESC, id DESC
       LIMIT 25`,
      [like, like, like, like, like]
    );

    const mappedInvoices = await Promise.all(
      invRows.map(async (r) => ({
        ...(await this.mapInvoiceRow(r)),
        userEmail: String(r.user_email),
        userName: String(r.user_name),
      }))
    );

    return {
      query: q,
      invoices: mappedInvoices,
      transfers: txRows.map((r) => this.mapTransferRow(r)),
    };
  }

  async mapInvoiceRow(row: Record<string, unknown>): Promise<DepositInvoiceDTO> {
    const id = String(row.id);
    const decimals = Number(row.decimals ?? this.config.usdtDecimals);
    const minimumAmountRaw = String(row.minimum_amount_raw);
    const expectedAmountRaw = (row.expected_amount_raw as string | null) ?? null;
    const detectedAmountRaw = String(row.detected_amount_raw ?? '0');
    const creditedAmountRaw = String(row.credited_amount_raw ?? '0');
    const txHash = (row.tx_hash as string | null) ?? null;

    const transferRows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM chain_transfers WHERE invoice_id = ? ORDER BY observed_at DESC, id DESC`,
      [id]
    );

    return {
      id,
      userId: String(row.user_id),
      address: String(row.address),
      derivationIndex: Number(row.derivation_index ?? 0),
      derivationPath: String(row.derivation_path ?? `m/44'/60'/0'/0/0`),
      asset: String(row.asset),
      network: String(row.network),
      networkLabel: String(row.network_label),
      tokenContract: String(row.token_contract),
      decimals,
      minimumAmountRaw,
      minimumAmountFormatted: formatRawTokenAmount(minimumAmountRaw, decimals),
      expectedAmountRaw,
      expectedAmountFormatted: expectedAmountRaw
        ? formatRawTokenAmount(expectedAmountRaw, decimals)
        : null,
      detectedAmountRaw,
      detectedAmountFormatted: formatRawTokenAmount(detectedAmountRaw, decimals),
      creditedAmountRaw,
      creditedAmountFormatted: formatRawTokenAmount(creditedAmountRaw, decimals),
      confirmations: Number(row.confirmations ?? 0),
      requiredConfirmations: Number(row.required_confirmations ?? this.config.requiredConfirmations),
      txHash,
      explorerUrl: txHash ? `${this.config.explorerUrl}/tx/${txHash}` : null,
      status: row.status as InvoiceStatus,
      statusReason: (row.status_reason as string | null) ?? null,
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      updatedAt: String(row.updated_at),
      transfers: transferRows.map((t) => this.mapTransferRow(t)),
    };
  }

  mapTransferRow(row: Record<string, unknown>): ChainTransferDTO {
    const txHash = String(row.tx_hash);
    const amountRaw = String(row.amount_raw);
    return {
      id: String(row.id),
      chain: String(row.chain),
      chainId: Number(row.chain_id),
      txHash,
      logIndex: Number(row.log_index),
      blockNumber: Number(row.block_number),
      blockHash: String(row.block_hash),
      tokenContract: String(row.token_contract),
      tokenSymbolHint: (row.token_symbol_hint as string | null) ?? null,
      fromAddress: String(row.from_address),
      toAddress: String(row.to_address),
      amountRaw,
      amountFormatted: formatRawTokenAmount(amountRaw, this.config.usdtDecimals),
      confirmations: Number(row.confirmations ?? 0),
      invoiceId: (row.invoice_id as string | null) ?? null,
      userId: (row.user_id as string | null) ?? null,
      status: row.status as TransferStatus,
      validationCode: (row.validation_code as string | null) ?? null,
      validationMessage: (row.validation_message as string | null) ?? null,
      ledgerEntryId: (row.ledger_entry_id as string | null) ?? null,
      creditedAt: (row.credited_at as string | null) ?? null,
      observedAt: String(row.observed_at),
      explorerUrl: `${this.config.explorerUrl}/tx/${txHash}`,
    };
  }
}
