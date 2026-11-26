import { test, expect } from 'bun:test';
import { openDb } from './db';
import { importStatement, DuplicateDocumentError } from './import';
import { extractPages } from './parsers/extract';
import { parseUnionBank } from './parsers/unionbank';
import type { ParsedStatement, ParsedTxn, TxnKind } from './parsers/types';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Hand-crafted fixture ────────────────────────────────────────────

function makeFixture(): ParsedStatement {
  const txns: ParsedTxn[] = [
    { txnDate: '2024-01-05', postedDate: '2024-01-06', description: 'MERCHANT A', merchant: 'MERCHANT A', amountMinor: 10000, fxAmountMinor: null, fxCurrency: null, kind: 'purchase' as TxnKind, instalmentRef: null, instalmentSeq: null, subAccount: null },
    { txnDate: '2024-01-10', postedDate: '2024-01-11', description: 'MERCHANT B', merchant: 'MERCHANT B', amountMinor: 20000, fxAmountMinor: null, fxCurrency: null, kind: 'purchase' as TxnKind, instalmentRef: null, instalmentSeq: null, subAccount: null },
    // Duplicate of first txn (identical key)
    { txnDate: '2024-01-05', postedDate: '2024-01-06', description: 'MERCHANT A', merchant: 'MERCHANT A', amountMinor: 10000, fxAmountMinor: null, fxCurrency: null, kind: 'purchase' as TxnKind, instalmentRef: null, instalmentSeq: null, subAccount: null },
    { txnDate: '2024-01-15', postedDate: '2024-01-16', description: 'MERCHANT C', merchant: 'MERCHANT C', amountMinor: 30000, fxAmountMinor: null, fxCurrency: null, kind: 'purchase' as TxnKind, instalmentRef: null, instalmentSeq: null, subAccount: null },
  ];
  return {
    bank: 'unionbank',
    accountRef: '1234',
    accountLast4: '1234',
    accountName: 'JOHN DOE',
    statementDate: '2024-01-20',
    periodStart: '2024-01-01',
    periodEnd: '2024-01-20',
    dueDate: '2024-02-05',
    totals: { previousBalanceMinor: 0, purchasesMinor: 60000, paymentsMinor: 0, totalDueMinor: 60000, minDueMinor: 0 },
    txns,
    warnings: [],
  };
}

function makeFixtureWithOverlap(): ParsedStatement {
  // 2 of the same txns from the first fixture + 1 new txn
  const txns: ParsedTxn[] = [
    // Duplicate of fixture txn 1 (occurrence 1)
    { txnDate: '2024-01-05', postedDate: '2024-01-06', description: 'MERCHANT A', merchant: 'MERCHANT A', amountMinor: 10000, fxAmountMinor: null, fxCurrency: null, kind: 'purchase' as TxnKind, instalmentRef: null, instalmentSeq: null, subAccount: null },
    // Duplicate of fixture txn 1 (occurrence 2)
    { txnDate: '2024-01-05', postedDate: '2024-01-06', description: 'MERCHANT A', merchant: 'MERCHANT A', amountMinor: 10000, fxAmountMinor: null, fxCurrency: null, kind: 'purchase' as TxnKind, instalmentRef: null, instalmentSeq: null, subAccount: null },
    // New txn not in first fixture
    { txnDate: '2024-01-25', postedDate: '2024-01-26', description: 'NEW STORE', merchant: 'NEW STORE', amountMinor: 5000, fxAmountMinor: null, fxCurrency: null, kind: 'purchase' as TxnKind, instalmentRef: null, instalmentSeq: null, subAccount: null },
  ];
  return {
    bank: 'unionbank',
    accountRef: '1234',
    accountLast4: '1234',
    accountName: 'JOHN DOE',
    statementDate: '2024-01-25',
    periodStart: '2024-01-21',
    periodEnd: '2024-01-20',
    dueDate: '2024-02-10',
    totals: { previousBalanceMinor: 60000, purchasesMinor: 25000, paymentsMinor: 0, totalDueMinor: 85000, minDueMinor: 0 },
    txns,
    warnings: [],
  };
}

function insertUser(db: ReturnType<typeof openDb>, userId: string): void {
  db.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [userId, `${userId}@test.com`, 'hash', Date.now()]);
}

// ─── Tests ───────────────────────────────────────────────────────────

test('first import: added 4, skipped 0, transactions count 4', () => {
  const db = openDb(':memory:');
  const userId = 'user-1';
  insertUser(db, userId);
  const fixture = makeFixture();
  const meta = { sha256: 'aaa', filename: 'test.pdf', storedPath: null };

  const result = importStatement(db, userId, fixture, meta);

  expect(result.added).toBe(4);
  expect(result.skipped).toBe(0);
  expect(result.status).toBe('parsed');
  expect(result.version).toBe(1);

  const count = db.query('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?').get(userId) as { c: number };
  expect(count.c).toBe(4);
});

test('same sha256 again throws DuplicateDocumentError', () => {
  const db = openDb(':memory:');
  const userId = 'user-2';
  insertUser(db, userId);
  const fixture = makeFixture();
  const meta = { sha256: 'aaa', filename: 'test.pdf', storedPath: null };

  importStatement(db, userId, fixture, meta);

  expect(() => importStatement(db, userId, fixture, meta)).toThrow(DuplicateDocumentError);
});

test('second statement overlapping: added 1, skipped 2, total rows 5, version 2', () => {
  const db = openDb(':memory:');
  const userId = 'user-3';
  insertUser(db, userId);
  const fixture1 = makeFixture();
  const meta1 = { sha256: 'aaa', filename: 'test1.pdf', storedPath: null };
  const fixture2 = makeFixtureWithOverlap();
  const meta2 = { sha256: 'bbb', filename: 'test2.pdf', storedPath: null };

  const r1 = importStatement(db, userId, fixture1, meta1);
  expect(r1.added).toBe(4);
  expect(r1.skipped).toBe(0);

  const r2 = importStatement(db, userId, fixture2, meta2);
  expect(r2.added).toBe(1);
  expect(r2.skipped).toBe(2);

  const count = db.query('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?').get(userId) as { c: number };
  expect(count.c).toBe(5);

  const docCount = db.query('SELECT COUNT(*) AS c FROM documents WHERE user_id = ?').get(userId) as { c: number };
  expect(docCount.c).toBe(2);

  const v2 = db.query('SELECT version FROM documents WHERE user_id = ? AND filename = ?').get(userId, 'test2.pdf') as { version: number };
  expect(v2.version).toBe(2);
});

test('second user importing same statement gets own rows (isolation)', () => {
  const db = openDb(':memory:');
  const userId1 = 'user-isolate-1';
  const userId2 = 'user-isolate-2';
  insertUser(db, userId1);
  insertUser(db, userId2);
  const fixture = makeFixture();
  const meta = { sha256: 'iso-sha', filename: 'iso.pdf', storedPath: null };

  const r1 = importStatement(db, userId1, fixture, meta);
  expect(r1.added).toBe(4);

  const r2 = importStatement(db, userId2, fixture, meta);
  expect(r2.added).toBe(4);

  const c1 = db.query('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?').get(userId1) as { c: number };
  const c2 = db.query('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?').get(userId2) as { c: number };
  expect(c1.c).toBe(4);
  expect(c2.c).toBe(4);
});

const unionbankPdfPath = join(process.cwd(), 'fixtures/private/unionbank.pdf');
const hasUnionbankPdf = existsSync(unionbankPdfPath);

test.skipIf(!hasUnionbankPdf)('real unionbank fixture: added 91, skipped 0', async () => {
  const pdfData = readFileSync(unionbankPdfPath);
  const pages = await extractPages(new Uint8Array(pdfData), '486911');
  const parsed = parseUnionBank(pages);

  const db = openDb(':memory:');
  const userId = 'user-real';
  insertUser(db, userId);
  const meta = { sha256: 'real-sha-1', filename: 'unionbank.pdf', storedPath: null };

  const result = importStatement(db, userId, parsed, meta);
  expect(result.added).toBe(91);
  expect(result.skipped).toBe(0);
});

test.skipIf(!hasUnionbankPdf)('re-import real fixture with different sha256: added 0, skipped 91, version 2', async () => {
  const pdfData = readFileSync(unionbankPdfPath);
  const pages = await extractPages(new Uint8Array(pdfData), '486911');
  const parsed = parseUnionBank(pages);

  const db = openDb(':memory:');
  const userId = 'user-real-re';
  insertUser(db, userId);
  const meta1 = { sha256: 'real-sha-2', filename: 'unionbank.pdf', storedPath: null };
  const meta2 = { sha256: 'real-sha-3', filename: 'unionbank.pdf', storedPath: null };

  importStatement(db, userId, parsed, meta1);

  const result = importStatement(db, userId, parsed, meta2);
  expect(result.added).toBe(0);
  expect(result.skipped).toBe(91);
});
