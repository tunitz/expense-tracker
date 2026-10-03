import { openDb } from './db';
import { describe, it, expect } from 'bun:test';

describe('openDb', () => {
  it('openDb(\':memory:\') twice works', () => {
    const db1 = openDb(':memory:');
    const db2 = openDb(':memory:');
    expect(db1).toBeDefined();
    expect(db2).toBeDefined();
  });

  it('PRAGMA user_version = 1 after open', () => {
    const db = openDb(':memory:');
    const row = db.query('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(1);
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
