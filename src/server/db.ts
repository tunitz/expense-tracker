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
CREATE UNIQUE INDEX uq_merchant_rules_user_pattern ON merchant_rules(user_id, pattern);
CREATE INDEX ix_txn_user_date ON transactions(user_id, txn_date);
CREATE INDEX ix_txn_user_cat ON transactions(user_id, category_id);
CREATE INDEX ix_txn_doc ON transactions(document_id);
`;

const V2_EXTRA_CATEGORIES: { name: string; color: string }[] = [
  { name: 'Installments', color: '#14b8a6' },
  { name: 'Others', color: '#78716c' },
];

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
    db.run('PRAGMA user_version = 2');
    db.run('COMMIT');
  } else if (userVersion < 2) {
    db.run('BEGIN');
    db.run(
      `DELETE FROM merchant_rules
       WHERE rowid NOT IN (
         SELECT MAX(rowid) FROM merchant_rules GROUP BY user_id, pattern
       )`,
    );
    db.run(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_rules_user_pattern ON merchant_rules(user_id, pattern)',
    );

    // Seed newly added default categories once for existing users who already have categories.
    const existingUsers = db
      .query('SELECT DISTINCT user_id FROM categories')
      .all() as { user_id: string }[];
    const insCat = db.prepare(
      'INSERT OR IGNORE INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)',
    );
    for (const { user_id } of existingUsers) {
      for (const c of V2_EXTRA_CATEGORIES) {
        insCat.run(crypto.randomUUID(), user_id, c.name, c.color);
      }
    }

    // Strip monthly sequence counters from stored UnionBank instalment merchant labels so rules match across cycles.
    const instRows = db
      .query(
        "SELECT id, merchant FROM transactions WHERE kind IN ('instalment_principal', 'instalment_interest')",
      )
      .all() as { id: string; merchant: string }[];
    const updMerchant = db.prepare('UPDATE transactions SET merchant = ? WHERE id = ?');
    for (const r of instRows) {
      const normalized = r.merchant.replace(
        /^(Instalment (?:Principal|Interest))\s+\(\d{2}\/\d{2}\)\s*(\[\d+\])$/,
        '$1 $2',
      );
      if (normalized !== r.merchant) {
        updMerchant.run(normalized, r.id);
      }
    }

    db.run('PRAGMA user_version = 2');
    db.run('COMMIT');
  }

  return db;
}
