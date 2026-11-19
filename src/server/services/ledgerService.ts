import crypto from 'node:crypto';
import { AppDatabase } from '../db.js';
import { AppConfig } from '../config.js';
import { addRawAmounts, formatRawTokenAmount, subRawAmounts } from '../../shared/units.js';
import {
  LedgerEntryDTO,
  ReconciliationReportDTO,
  WalletBalanceSummary,
} from '../../shared/types.js';

export class LedgerService {
  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig
  ) {}

  /**
   * Post an immutable, idempotent credit entry to `ledger_entries` AND atomically
   * update `account_balances` inside the same database transaction.
   */
  async creditUserAccount(params: {
    userId: string;
    amountRaw: string;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    invoiceId?: string | null;
    txHash?: string | null;
    note?: string | null;
  }): Promise<{ entry: LedgerEntryDTO; alreadyExisted: boolean }> {
    if (BigInt(params.amountRaw) <= 0n) {
      throw new Error('Credit amount must be strictly positive.');
    }

    return this.db.transaction(async () => {
      const existing = await this.db.get<Record<string, unknown>>(
        `SELECT * FROM ledger_entries
         WHERE idempotency_key = ? OR (source_type = ? AND source_id = ?)`,
        [params.idempotencyKey, params.sourceType, params.sourceId]
      );

      if (existing) {
        return {
          entry: this.mapLedgerRow(existing),
          alreadyExisted: true,
        };
      }

      const now = new Date().toISOString();
      const balRow = await this.db.get<{ available_raw: string }>(
        `SELECT available_raw FROM account_balances WHERE user_id = ? AND asset = ?`,
        [params.userId, this.config.asset]
      );

      const currentBalanceRaw = balRow?.available_raw ?? '0';
      const nextBalanceRaw = addRawAmounts(currentBalanceRaw, params.amountRaw);

      if (balRow) {
        await this.db.run(
          `UPDATE account_balances
           SET available_raw = ?, updated_at = ?
           WHERE user_id = ? AND asset = ?`,
          [nextBalanceRaw, now, params.userId, this.config.asset]
        );
      } else {
        await this.db.run(
          `INSERT INTO account_balances (user_id, asset, available_raw, updated_at)
           VALUES (?, ?, ?, ?)`,
          [params.userId, this.config.asset, nextBalanceRaw, now]
        );
      }

      const entryId = `led_${crypto.randomBytes(8).toString('hex')}`;
      await this.db.run(
        `INSERT INTO ledger_entries (
           id, user_id, asset, direction, amount_raw, balance_after_raw,
           source_type, source_id, idempotency_key, invoice_id, tx_hash, note, created_at
         ) VALUES (?, ?, ?, 'credit', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entryId,
          params.userId,
          this.config.asset,
          params.amountRaw,
          nextBalanceRaw,
          params.sourceType,
          params.sourceId,
          params.idempotencyKey,
          params.invoiceId ?? null,
          params.txHash ?? null,
          params.note ?? null,
          now,
        ]
      );

      const created = await this.db.get<Record<string, unknown>>(
        `SELECT * FROM ledger_entries WHERE id = ?`,
        [entryId]
      );

      return {
        entry: this.mapLedgerRow(created!),
        alreadyExisted: false,
      };
    });
  }

  async getWalletBalanceSummary(userId: string): Promise<WalletBalanceSummary> {
    const balRow = await this.db.get<{ available_raw: string }>(
      `SELECT available_raw FROM account_balances WHERE user_id = ? AND asset = ?`,
      [userId, this.config.asset]
    );

    const availableRaw = balRow?.available_raw ?? '0';

    const pendingTransfers = await this.db.all<{ status: string; amount_raw: string }>(
      `SELECT status, amount_raw
       FROM chain_transfers
       WHERE user_id = ?
         AND status IN ('detected', 'confirming', 'review')
         AND validation_code IS DISTINCT FROM 'WRONG_TOKEN_CONTRACT'
         AND validation_code IS DISTINCT FROM 'WRONG_NETWORK'`,
      [userId]
    );

    let confirmingRaw = '0';
    let heldInReviewRaw = '0';
    for (const t of pendingTransfers) {
      if (t.status === 'detected' || t.status === 'confirming') {
        confirmingRaw = addRawAmounts(confirmingRaw, t.amount_raw);
      } else if (t.status === 'review') {
        heldInReviewRaw = addRawAmounts(heldInReviewRaw, t.amount_raw);
      }
    }

    const countRow = await this.db.get<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM ledger_entries WHERE user_id = ? AND asset = ? AND direction = 'credit'`,
      [userId, this.config.asset]
    );

    return {
      asset: this.config.asset,
      availableRaw,
      availableFormatted: formatRawTokenAmount(availableRaw, this.config.usdtDecimals),
      confirmingRaw,
      confirmingFormatted: formatRawTokenAmount(confirmingRaw, this.config.usdtDecimals),
      heldInReviewRaw,
      heldInReviewFormatted: formatRawTokenAmount(heldInReviewRaw, this.config.usdtDecimals),
      totalCreditedCount: Number(countRow?.cnt ?? 0),
    };
  }

  async listUserLedgerEntries(userId: string, limit = 50): Promise<LedgerEntryDTO[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT l.*, u.email AS user_email
       FROM ledger_entries l
       JOIN users u ON u.id = l.user_id
       WHERE l.user_id = ?
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ?`,
      [userId, limit]
    );

    return rows.map((r) => this.mapLedgerRow(r));
  }

  async listRecentLedgerEntries(limit = 50): Promise<LedgerEntryDTO[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT l.*, u.email AS user_email
       FROM ledger_entries l
       JOIN users u ON u.id = l.user_id
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((r) => this.mapLedgerRow(r));
  }

  async reconcileAllBalances(): Promise<ReconciliationReportDTO> {
    const users = await this.db.all<{ id: string; email: string; cached_raw: string }>(
      `SELECT u.id, u.email, COALESCE(b.available_raw, '0') AS cached_raw
       FROM users u
       LEFT JOIN account_balances b ON b.user_id = u.id AND b.asset = ?`,
      [this.config.asset]
    );

    const mismatches: ReconciliationReportDTO['mismatches'] = [];
    let totalLiabilityRaw = '0';

    for (const user of users) {
      const entries = await this.db.all<{ direction: 'credit' | 'debit'; amount_raw: string }>(
        `SELECT direction, amount_raw FROM ledger_entries WHERE user_id = ? AND asset = ?`,
        [user.id, this.config.asset]
      );

      let computedRaw = '0';
      for (const e of entries) {
        computedRaw =
          e.direction === 'credit'
            ? addRawAmounts(computedRaw, e.amount_raw)
            : subRawAmounts(computedRaw, e.amount_raw);
      }

      totalLiabilityRaw = addRawAmounts(totalLiabilityRaw, computedRaw);

      if (BigInt(user.cached_raw) !== BigInt(computedRaw)) {
        mismatches.push({
          userId: user.id,
          email: user.email,
          cachedBalanceRaw: user.cached_raw,
          ledgerSumRaw: computedRaw,
          differenceRaw: subRawAmounts(user.cached_raw, computedRaw),
        });
      }
    }

    const totalRow = await this.db.get<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM ledger_entries WHERE asset = ?`,
      [this.config.asset]
    );

    return {
      checkedAt: new Date().toISOString(),
      allMatched: mismatches.length === 0,
      usersChecked: users.length,
      mismatches,
      totalSystemLiabilityRaw: totalLiabilityRaw,
      totalSystemLiabilityFormatted: formatRawTokenAmount(totalLiabilityRaw, this.config.usdtDecimals),
      totalLedgerEntries: Number(totalRow?.cnt ?? 0),
    };
  }

  mapLedgerRow(row: Record<string, unknown>): LedgerEntryDTO {
    const txHash = (row.tx_hash as string | null) ?? null;
    const amountRaw = String(row.amount_raw);
    const balanceAfterRaw = String(row.balance_after_raw);
    return {
      id: String(row.id),
      userId: String(row.user_id),
      userEmail: row.user_email ? String(row.user_email) : undefined,
      asset: String(row.asset),
      direction: row.direction as 'credit' | 'debit',
      amountRaw,
      amountFormatted: formatRawTokenAmount(amountRaw, this.config.usdtDecimals),
      balanceAfterRaw,
      balanceAfterFormatted: formatRawTokenAmount(balanceAfterRaw, this.config.usdtDecimals),
      sourceType: String(row.source_type),
      sourceId: String(row.source_id),
      idempotencyKey: String(row.idempotency_key),
      invoiceId: (row.invoice_id as string | null) ?? null,
      txHash,
      explorerUrl: txHash ? `${this.config.explorerUrl}/tx/${txHash}` : null,
      note: (row.note as string | null) ?? null,
      createdAt: String(row.created_at),
    };
  }
}
