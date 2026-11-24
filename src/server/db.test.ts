import { openDb } from './db';
import { describe, it, expect } from 'bun:test';

describe('openDb', () => {
  it('openDb(\':memory:\') twice works', () => {
    const db1 = openDb(':memory:');
    const db2 = openDb(':memory:');
    expect(db1).toBeDefined();
    expect(db2).toBeDefined();
  });

  it('PRAGMA user_version = 2 after open', () => {
    const db = openDb(':memory:');
    const row = db.query('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(2);
  });

  it('migrates v1 DB to v2: seeds Installments/Others and normalizes instalment merchants', () => {
    const tmp = `/tmp/expense-tracker-migrate-${crypto.randomUUID()}.db`;
    const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
    const raw = new Database(tmp);
    raw.run(`
      CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE accounts(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, bank TEXT NOT NULL, name TEXT NOT NULL, last4 TEXT NOT NULL, account_ref TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'PHP');
      CREATE TABLE documents(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT NOT NULL, sha256 TEXT NOT NULL, filename TEXT NOT NULL, statement_date TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, totals_json TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, supersedes_id TEXT, stored_path TEXT, uploaded_at INTEGER NOT NULL);
      CREATE TABLE categories(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#64748b', UNIQUE(user_id, name));
      CREATE TABLE merchant_rules(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, pattern TEXT NOT NULL, category_id TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE transactions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT, document_id TEXT, source TEXT NOT NULL, txn_date TEXT NOT NULL, posted_date TEXT, description TEXT NOT NULL, merchant TEXT NOT NULL, amount_minor INTEGER NOT NULL, fx_amount_minor INTEGER, fx_currency TEXT, kind TEXT NOT NULL, instalment_ref TEXT, instalment_seq TEXT, sub_account TEXT, occurrence INTEGER NOT NULL DEFAULT 1, dedupe_key TEXT, category_id TEXT, notes TEXT, payment_method TEXT, deleted_at INTEGER, created_at INTEGER NOT NULL);
      PRAGMA user_version = 1;
    `);
    raw.run('INSERT INTO users VALUES (?, ?, ?, ?)', ['u1', 'u1@test.io', 'h', 1]);
    raw.run('INSERT INTO categories VALUES (?, ?, ?, ?)', ['c1', 'u1', 'Food', '#f97316']);
    raw.run(
      `INSERT INTO transactions (id, user_id, source, txn_date, description, merchant, amount_minor, kind, instalment_ref, instalment_seq, occurrence, created_at)
       VALUES (?, ?, 'pdf', '2026-10-02', 'Instalment Principal (02/12) [9407765]', 'Instalment Principal (02/12) [9407765]', 351779, 'instalment_principal', '9407765', '02/12', 1, 1)`,
      ['t1', 'u1'],
    );
    raw.close();

    const migrated = openDb(tmp);
    try {
      const ver = migrated.query('PRAGMA user_version').get() as { user_version: number };
      expect(ver.user_version).toBe(2);
      const cats = (migrated.query('SELECT name FROM categories WHERE user_id = ? ORDER BY name').all('u1') as { name: string }[]).map((r) => r.name);
      expect(cats).toEqual(['Food', 'Installments', 'Others']);
      const txn = migrated.query('SELECT merchant, description FROM transactions WHERE id = ?').get('t1') as { merchant: string; description: string };
      expect(txn.merchant).toBe('Instalment Principal [9407765]');
      expect(txn.description).toBe('Instalment Principal (02/12) [9407765]');
    } finally {
      migrated.close();
      const { unlinkSync } = require('node:fs') as typeof import('node:fs');
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(tmp + suffix); } catch {}
      }
    }
  });

  it('all expected tables exist', () => {
    const db = openDb(':memory:');
    const tables = (
      db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all()
    ) as { name: string }[];
    const names = tables.map((row) => row.name);

    const expected = [
      'accounts',
      'categories',
      'documents',
      'merchant_rules',
      'sessions',
      'transactions',
      'users',
    ];

    for (const t of expected) {
      expect(names).toContain(t);
    }
  });

  it('inserting a user then a transaction works', () => {
    const db = openDb(':memory:');
    const userId = crypto.randomUUID();

    db.run(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [userId, 'test@example.com', '$2b$12$hash', Date.now()]
    );

    const accountId = crypto.randomUUID();
    db.run(
      'INSERT INTO accounts (id, user_id, bank, name, last4, account_ref, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [accountId, userId, 'BDO', 'Savings', '1234', 'ref1', 'PHP']
    );

    const txnId = crypto.randomUUID();
    db.run(
      `INSERT INTO transactions (
        id, user_id, account_id, source, txn_date, description, merchant,
        amount_minor, kind, occurrence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txnId,
        userId,
        accountId,
        'manual',
        '2025-01-01',
        'Test txn',
        'Merchant',
        5000,
        'debit',
        1,
        Date.now(),
      ]
    );

    const count = db.query('SELECT COUNT(*) AS cnt FROM transactions').get() as {
      cnt: number;
    };
    expect(count.cnt).toBe(1);
  });

  it('two transactions with same non-null dedupe_key throws', () => {
    const db = openDb(':memory:');
    const userId = crypto.randomUUID();
    db.run(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [userId, 'test@example.com', '$2b$12$hash', Date.now()]
    );

    const accountId = crypto.randomUUID();
    db.run(
      'INSERT INTO accounts (id, user_id, bank, name, last4, account_ref, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [accountId, userId, 'BDO', 'Savings', '1234', 'ref1', 'PHP']
    );

    const txnId1 = crypto.randomUUID();
    db.run(
      `INSERT INTO transactions (
        id, user_id, account_id, source, txn_date, description, merchant,
        amount_minor, kind, occurrence, dedupe_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txnId1,
        userId,
        accountId,
        'pdf',
        '2025-01-01',
        'Test',
        'Merchant',
        5000,
        'debit',
        1,
        'same-key',
        Date.now(),
      ]
    );

    const txnId2 = crypto.randomUUID();
    expect(() => {
      db.run(
        `INSERT INTO transactions (
          id, user_id, account_id, source, txn_date, description, merchant,
          amount_minor, kind, occurrence, dedupe_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          txnId2,
          userId,
          accountId,
          'pdf',
          '2025-01-02',
          'Test2',
          'Merchant2',
          6000,
          'debit',
          1,
          'same-key',
          Date.now(),
        ]
      );
    }).toThrow();
  });

  it('two transactions with NULL dedupe_key both succeed', () => {
    const db = openDb(':memory:');
    const userId = crypto.randomUUID();
    db.run(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [userId, 'test@example.com', '$2b$12$hash', Date.now()]
    );

    const accountId = crypto.randomUUID();
    db.run(
      'INSERT INTO accounts (id, user_id, bank, name, last4, account_ref, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [accountId, userId, 'BDO', 'Savings', '1234', 'ref1', 'PHP']
    );

    const txnId1 = crypto.randomUUID();
    db.run(
      `INSERT INTO transactions (
        id, user_id, account_id, source, txn_date, description, merchant,
        amount_minor, kind, occurrence, dedupe_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txnId1,
        userId,
        accountId,
        'manual',
        '2025-01-01',
        'Test',
        'Merchant',
        5000,
        'debit',
        1,
        null,
        Date.now(),
      ]
    );

    const txnId2 = crypto.randomUUID();
    // Should not throw
    db.run(
      `INSERT INTO transactions (
        id, user_id, account_id, source, txn_date, description, merchant,
        amount_minor, kind, occurrence, dedupe_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txnId2,
        userId,
        accountId,
        'manual',
        '2025-01-02',
        'Test2',
        'Merchant2',
        6000,
        'debit',
        1,
        null,
        Date.now(),
      ]
    );

    const count = db.query('SELECT COUNT(*) AS cnt FROM transactions').get() as {
      cnt: number;
    };
    expect(count.cnt).toBe(2);
  });

  it('inserting a transaction with non-existent user_id throws', () => {
    const db = openDb(':memory:');
    const fakeUserId = crypto.randomUUID();
    const accountId = crypto.randomUUID();

    const txnId = crypto.randomUUID();
    expect(() => {
      db.run(
        `INSERT INTO transactions (
          id, user_id, account_id, source, txn_date, description, merchant,
          amount_minor, kind, occurrence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          txnId,
          fakeUserId,
          accountId,
          'manual',
          '2025-01-01',
          'Test',
          'Merchant',
          5000,
          'debit',
          1,
          Date.now(),
        ]
      );
    }).toThrow();
  });

  it('documents row with status \'bogus\' throws', () => {
    const db = openDb(':memory:');
    const userId = crypto.randomUUID();
    db.run(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [userId, 'test@example.com', '$2b$12$hash', Date.now()]
    );

    const accountId = crypto.randomUUID();
    db.run(
      'INSERT INTO accounts (id, user_id, bank, name, last4, account_ref, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [accountId, userId, 'BDO', 'Savings', '1234', 'ref1', 'PHP']
    );

    const docId = crypto.randomUUID();
    expect(() => {
      db.run(
        `INSERT INTO documents (
          id, user_id, account_id, sha256, filename, statement_date,
          period_start, period_end, totals_json, status, uploaded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          docId,
          userId,
          accountId,
          'abc123',
          'test.pdf',
          '2025-01-01',
          '2025-01-01',
          '2025-01-31',
          '{}',
          'bogus',
          Date.now(),
        ]
      );
    }).toThrow();
  });
});
