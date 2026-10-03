import { Database } from 'bun:sqlite';
import { chmodSync } from 'fs';
export type { Database };

const SCHEMA = `
CREATE TABLE users(
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE accounts(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank TEXT NOT NULL,
  name TEXT NOT NULL,
  last4 TEXT NOT NULL,
  account_ref TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  UNIQUE(user_id, bank, account_ref)
);

CREATE TABLE documents(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  filename TEXT NOT NULL,
  statement_date TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  totals_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('parsed','needs_review','superseded','failed')),
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT,
  stored_path TEXT,
  uploaded_at INTEGER NOT NULL,
  UNIQUE(user_id, sha256)
);

CREATE TABLE categories(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  UNIQUE(user_id, name)
);

CREATE TABLE merchant_rules(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transactions(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK(source IN ('pdf','manual')),
  txn_date TEXT NOT NULL,
  posted_date TEXT,
  description TEXT NOT NULL,
  merchant TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  fx_amount_minor INTEGER,
  fx_currency TEXT,
  kind TEXT NOT NULL,
  instalment_ref TEXT,
  instalment_seq TEXT,
  sub_account TEXT,
  occurrence INTEGER NOT NULL DEFAULT 1,
  dedupe_key TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  notes TEXT,
  payment_method TEXT,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_txn_dedupe ON transactions(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX ix_txn_user_date ON transactions(user_id, txn_date);
CREATE INDEX ix_txn_user_cat ON transactions(user_id, category_id);
CREATE INDEX ix_txn_doc ON transactions(document_id);
`;

export function openDb(path: string): Database {
  const db = new Database(path);
  if (path !== ':memory:') {
    try {
      chmodSync(path, 0o600);
    } catch {
      // best effort
    }
  }

  db.run('PRAGMA journal_mode=WAL;');
  db.run('PRAGMA foreign_keys=ON;');

  const row = db.query('PRAGMA user_version').get() as { user_version: number };
  const userVersion = row.user_version;
  if (userVersion === 0) {
    db.run('BEGIN');
    db.run(SCHEMA);
    db.run('PRAGMA user_version = 1');
    db.run('COMMIT');
  }

  return db;
}
