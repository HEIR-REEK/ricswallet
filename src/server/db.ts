import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from 'node:sqlite';
import pg from 'pg';

export type SqlParam = string | number | bigint | null;

export interface RunResult {
  changes: number;
}

export interface AppDatabase {
  readonly dialect: 'sqlite' | 'postgres';
  get<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SHARED_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS deposit_addresses (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    address_lower TEXT NOT NULL,
    derivation_index INTEGER NOT NULL,
    derivation_path TEXT NOT NULL,
    assigned_user_id TEXT NOT NULL REFERENCES users(id),
    assigned_invoice_id TEXT,
    network TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    created_at TEXT NOT NULL,
    UNIQUE (network, address_lower),
    UNIQUE (network, derivation_index)
  )`,
  `CREATE TABLE IF NOT EXISTS deposit_invoices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    address_id TEXT NOT NULL REFERENCES deposit_addresses(id),
    address TEXT NOT NULL,
    asset TEXT NOT NULL,
    network TEXT NOT NULL,
    network_label TEXT NOT NULL,
    token_contract TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    minimum_amount_raw TEXT NOT NULL,
    expected_amount_raw TEXT,
    detected_amount_raw TEXT NOT NULL DEFAULT '0',
    credited_amount_raw TEXT NOT NULL DEFAULT '0',
    confirmations INTEGER NOT NULL DEFAULT 0,
    required_confirmations INTEGER NOT NULL DEFAULT 15,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'waiting'
      CHECK (status IN ('waiting', 'detected', 'confirmed', 'expired', 'review', 'cancelled')),
    status_reason TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_user ON deposit_invoices(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_address ON deposit_invoices(address)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_status ON deposit_invoices(status)`,
  `CREATE TABLE IF NOT EXISTS chain_transfers (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    token_contract TEXT NOT NULL,
    token_symbol_hint TEXT,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    to_address_lower TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    confirmations INTEGER NOT NULL DEFAULT 0,
    invoice_id TEXT REFERENCES deposit_invoices(id),
    user_id TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'detected'
      CHECK (status IN ('detected', 'confirming', 'confirmed', 'credited', 'review', 'rejected', 'reorged')),
    validation_code TEXT,
    validation_message TEXT,
    ledger_entry_id TEXT,
    credited_at TEXT,
    observed_at TEXT NOT NULL,
    UNIQUE (chain, tx_hash, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_transfers_to_addr ON chain_transfers(to_address_lower)`,
  `CREATE INDEX IF NOT EXISTS idx_transfers_invoice ON chain_transfers(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transfers_status ON chain_transfers(status)`,
  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    asset TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
    amount_raw TEXT NOT NULL,
    balance_after_raw TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    invoice_id TEXT REFERENCES deposit_invoices(id),
    tx_hash TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (source_type, source_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS account_balances (
    user_id TEXT NOT NULL REFERENCES users(id),
    asset TEXT NOT NULL,
    available_raw TEXT NOT NULL DEFAULT '0',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, asset)
  )`,
  `CREATE TABLE IF NOT EXISTS indexer_state (
    chain TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'simulator',
    last_processed_block BIGINT NOT NULL DEFAULT 0,
    chain_head_block BIGINT NOT NULL DEFAULT 0,
    rpc_status TEXT NOT NULL DEFAULT 'healthy',
    last_heartbeat_at TEXT NOT NULL,
    last_error TEXT,
    auto_mine INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS simulated_chain_logs (
    id TEXT PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    token_contract TEXT NOT NULL,
    token_symbol_hint TEXT,
    topics_json TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    reorged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (tx_hash, log_index)
  )`,
];

function convertPlaceholdersToPg(sql: string): string {
  let idx = 0;
  let inQuotes = false;
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      inQuotes = !inQuotes;
      out += ch;
    } else if (ch === '?' && !inQuotes) {
      idx += 1;
      out += `$${idx}`;
    } else {
      out += ch;
    }
  }
  return out;
}

class PostgresAppDatabase implements AppDatabase {
  public readonly dialect = 'postgres' as const;
  private readonly pool: pg.Pool;
  private readonly txStorage = new AsyncLocalStorage<{ client: pg.PoolClient; depth: number }>();

  constructor(databaseUrl: string) {
    const isLocal =
      databaseUrl.includes('localhost') ||
      databaseUrl.includes('127.0.0.1') ||
      databaseUrl.includes('sslmode=disable');

    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
      max: 10,
    });
  }

  async migrate(): Promise<void> {
    for (const stmt of SHARED_SCHEMA_STATEMENTS) {
      await this.pool.query(stmt);
    }
  }

  private getQueryable(): pg.Pool | pg.PoolClient {
    return this.txStorage.getStore()?.client ?? this.pool;
  }

  async get<T = Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = []
  ): Promise<T | undefined> {
    const res = await this.getQueryable().query(convertPlaceholdersToPg(sql), params);
    return (res.rows[0] as T | undefined) ?? undefined;
  }

  async all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const res = await this.getQueryable().query(convertPlaceholdersToPg(sql), params);
    return res.rows as T[];
  }

  async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
    const res = await this.getQueryable().query(convertPlaceholdersToPg(sql), params);
    return { changes: res.rowCount ?? 0 };
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const existing = this.txStorage.getStore();
    if (!existing) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await this.txStorage.run({ client, depth: 1 }, work);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      } finally {
        client.release();
      }
    } else {
      const sp = `sp_${existing.depth}`;
      await existing.client.query(`SAVEPOINT ${sp}`);
      try {
        const result = await this.txStorage.run(
          { client: existing.client, depth: existing.depth + 1 },
          work
        );
        await existing.client.query(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (err) {
        await existing.client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw err;
      }
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class SqliteAppDatabase implements AppDatabase {
  public readonly dialect = 'sqlite' as const;
  private readonly raw: DatabaseSyncType;
  private readonly txStorage = new AsyncLocalStorage<{ depth: number }>();
  private mutexChain: Promise<void> = Promise.resolve();

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    const requireSqlite = createRequire(import.meta.url);
    const { DatabaseSync } = requireSqlite('node:sqlite') as {
      DatabaseSync: typeof DatabaseSyncType;
    };
    this.raw = new DatabaseSync(dbPath);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
  }

  async migrate(): Promise<void> {
    for (const stmt of SHARED_SCHEMA_STATEMENTS) {
      this.raw.exec(stmt);
    }
  }

  async get<T = Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = []
  ): Promise<T | undefined> {
    const row = this.raw.prepare(sql).get(...(params as SQLInputValue[]));
    return (row as T | undefined) ?? undefined;
  }

  async all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const rows = this.raw.prepare(sql).all(...(params as SQLInputValue[]));
    return rows as T[];
  }

  async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
    const res = this.raw.prepare(sql).run(...(params as SQLInputValue[]));
    return { changes: Number(res.changes ?? 0) };
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const existing = this.txStorage.getStore();
    if (existing) {
      const sp = `sp_${existing.depth}`;
      this.raw.exec(`SAVEPOINT ${sp};`);
      try {
        const result = await this.txStorage.run({ depth: existing.depth + 1 }, work);
        this.raw.exec(`RELEASE SAVEPOINT ${sp};`);
        return result;
      } catch (err) {
        this.raw.exec(`ROLLBACK TO SAVEPOINT ${sp};`);
        throw err;
      }
    }

    // Serialize top-level SQLite transactions cleanly across async ticks
    let releaseLock!: () => void;
    const prev = this.mutexChain;
    this.mutexChain = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await prev;

    try {
      this.raw.exec('BEGIN IMMEDIATE;');
      try {
        const result = await this.txStorage.run({ depth: 1 }, work);
        this.raw.exec('COMMIT;');
        return result;
      } catch (err) {
        try {
          this.raw.exec('ROLLBACK;');
        } catch {
          // ignore
        }
        throw err;
      }
    } finally {
      releaseLock();
    }
  }

  async close(): Promise<void> {
    this.raw.close();
  }
}

export async function createDatabase(options: {
  databaseUrl?: string | null;
  sqliteDbPath: string;
}): Promise<AppDatabase> {
  if (options.databaseUrl) {
    const pgDb = new PostgresAppDatabase(options.databaseUrl);
    await pgDb.migrate();
    return pgDb;
  }

  const sqliteDb = new SqliteAppDatabase(options.sqliteDbPath);
  await sqliteDb.migrate();
  return sqliteDb;
}
