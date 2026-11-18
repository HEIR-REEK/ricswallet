-- RicsWallet Phase 1: USDT Deposit System (BNB Smart Chain / BEP-20)
-- Production PostgreSQL DDL (mirrors runtime transactional schema)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS deposit_addresses (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  address_lower TEXT NOT NULL,
  derivation_index INTEGER NOT NULL,
  derivation_path TEXT NOT NULL,
  assigned_user_id TEXT NOT NULL REFERENCES users(id),
  assigned_invoice_id TEXT,
  network TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (network, address_lower),
  UNIQUE (network, derivation_index)
);

CREATE TABLE IF NOT EXISTS deposit_invoices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  address_id TEXT NOT NULL REFERENCES deposit_addresses(id),
  address TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'USDT',
  network TEXT NOT NULL DEFAULT 'BSC_BEP20',
  network_label TEXT NOT NULL DEFAULT 'BNB Smart Chain (BEP-20)',
  token_contract TEXT NOT NULL,
  decimals INTEGER NOT NULL DEFAULT 18,
  minimum_amount_raw NUMERIC(78, 0) NOT NULL,
  expected_amount_raw NUMERIC(78, 0),
  detected_amount_raw NUMERIC(78, 0) NOT NULL DEFAULT 0,
  credited_amount_raw NUMERIC(78, 0) NOT NULL DEFAULT 0,
  confirmations INTEGER NOT NULL DEFAULT 0,
  required_confirmations INTEGER NOT NULL DEFAULT 15,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'detected', 'confirmed', 'expired', 'review', 'cancelled')),
  status_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chain_transfers (
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
  amount_raw NUMERIC(78, 0) NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 0,
  invoice_id TEXT REFERENCES deposit_invoices(id),
  user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected', 'confirming', 'confirmed', 'credited', 'review', 'rejected', 'reorged')),
  validation_code TEXT,
  validation_message TEXT,
  ledger_entry_id TEXT,
  credited_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain, tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  asset TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount_raw NUMERIC(78, 0) NOT NULL,
  balance_after_raw NUMERIC(78, 0) NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  invoice_id TEXT REFERENCES deposit_invoices(id),
  tx_hash TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_type, source_id)
);

CREATE TABLE IF NOT EXISTS account_balances (
  user_id TEXT NOT NULL REFERENCES users(id),
  asset TEXT NOT NULL,
  available_raw NUMERIC(78, 0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, asset)
);

CREATE TABLE IF NOT EXISTS indexer_state (
  chain TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'simulator',
  last_processed_block BIGINT NOT NULL DEFAULT 0,
  chain_head_block BIGINT NOT NULL DEFAULT 0,
  rpc_status TEXT NOT NULL DEFAULT 'healthy',
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT
);
