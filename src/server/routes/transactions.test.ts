import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { openDb } from '../db';
import { register, login } from '../auth';
import type { AppEnv } from '../app';
import { transactionsRoutes } from './transactions';

function createAppWithUser(db: Database, userId: string) {
  const app = new Hono<AppEnv>();

  // Stub requireUser: set c.set('user', {id, email}) for the given user
  app.use('*', async (c, next) => {
    c.set('user', { id: userId, email: 'test@example.com' });
    await next();
  });

  app.route('/transactions', transactionsRoutes(db));
  return app;
}

function createTwoUserApp(db: Database, user1Id: string, user2Id: string) {
  return {
    app1: createAppWithUser(db, user1Id),
    app2: createAppWithUser(db, user2Id),
  };
}

function seedData(db: Database, userId: string, accountId: string) {
  const cat1Id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)',
  ).run(cat1Id, userId, 'Food', '#ef4444');
  const cat2Id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)',
  ).run(cat2Id, userId, 'Transport', '#3b82f6');

  // Transaction 1: purchase, 2024-01-15, Food, 5000
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, document_id, source, txn_date, description, merchant,
       amount_minor, kind, occurrence, dedupe_key, category_id, notes, payment_method, deleted_at, created_at)
     VALUES (?, ?, ?, NULL, 'pdf', '2024-01-15', 'STARBUCKS', 'STARBUCKS', 5000, 'purchase', 1, 'key1', ?, NULL, NULL, NULL, ?)`,
  ).run(crypto.randomUUID(), userId, accountId, cat1Id, Date.now() - 100000);

  // Transaction 2: purchase, 2024-01-20, Transport, 3000
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, document_id, source, txn_date, description, merchant,
       amount_minor, kind, occurrence, dedupe_key, category_id, notes, payment_method, deleted_at, created_at)
     VALUES (?, ?, ?, NULL, 'pdf', '2024-01-20', 'GRAB', 'GRAB', 3000, 'purchase', 1, 'key2', ?, NULL, NULL, NULL, ?)`,
  ).run(crypto.randomUUID(), userId, accountId, cat2Id, Date.now() - 90000);

  // Transaction 3: purchase, 2024-02-10, Food, 2000
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, document_id, source, txn_date, description, merchant,
       amount_minor, kind, occurrence, dedupe_key, category_id, notes, payment_method, deleted_at, created_at)
     VALUES (?, ?, ?, NULL, 'pdf', '2024-02-10', 'MCDONALDS', 'MCDONALDS', 2000, 'purchase', 1, 'key3', ?, NULL, NULL, NULL, ?)`,
  ).run(crypto.randomUUID(), userId, accountId, cat1Id, Date.now() - 80000);

  // Transaction 4: payment (EXCLUDED from spend), 2024-02-15, no category
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, document_id, source, txn_date, description, merchant,
       amount_minor, kind, occurrence, dedupe_key, category_id, notes, payment_method, deleted_at, created_at)
     VALUES (?, ?, ?, NULL, 'pdf', '2024-02-15', 'PAYMENT', 'PAYMENT', 10000, 'payment', 1, 'key4', NULL, NULL, NULL, NULL, ?)`,
  ).run(crypto.randomUUID(), userId, accountId, Date.now() - 70000);

  // Transaction 5: credit (EXCLUDED from spend), 2024-02-20, no category
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, document_id, source, txn_date, description, merchant,
       amount_minor, kind, occurrence, dedupe_key, category_id, notes, payment_method, deleted_at, created_at)
     VALUES (?, ?, ?, NULL, 'pdf', '2024-02-20', 'CREDIT', 'CREDIT', 1000, 'credit', 1, 'key5', NULL, NULL, NULL, NULL, ?)`,
  ).run(crypto.randomUUID(), userId, accountId, Date.now() - 60000);

  // Transaction 6: purchase, 2024-02-25, uncategorized
  db.prepare(
    `INSERT INTO transactions (id, user_id, account_id, document_id, source, txn_date, description, merchant,
       amount_minor, kind, occurrence, dedupe_key, category_id, notes, payment_method, deleted_at, created_at)
     VALUES (?, ?, ?, NULL, 'pdf', '2024-02-25', 'RANDOM SHOP', 'RANDOM SHOP', 1500, 'purchase', 1, 'key6', NULL, NULL, NULL, NULL, ?)`,
  ).run(crypto.randomUUID(), userId, accountId, Date.now() - 50000);

  return { cat1Id, cat2Id };
}

describe('transactions routes', () => {
  let db: Database;
  let user1Id: string;
  let user2Id: string;
  let accountId: string;

  beforeEach(async () => {
    db = openDb(':memory:');

    // Create two users
    const u1 = await register(db, 'user1@test.com', 'password123');
    const u2 = await register(db, 'user2@test.com', 'password456');
    user1Id = u1.id;
    user2Id = u2.id;

    // Create an account for user1
    accountId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO accounts (id, user_id, bank, name, last4, account_ref) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(accountId, user1Id, 'BPI', 'Savings', '1234', 'bpi-sav');
  });

  afterAll(() => {
    db.close();
  });

  describe('GET / (list)', () => {
    it('lists transactions with user isolation', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const res = await app.request('/transactions');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
      expect(body.items.length).toBe(6);
      expect(body.total).toBe(6);
    });

    it('filters by date range (inclusive)', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const res = await app.request('/transactions?from=2024-02-01&to=2024-02-28');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ txnDate: string }>; total: number };
      expect(body.items.length).toBe(4);
      expect(body.total).toBe(4);
      body.items.forEach((item) => {
        expect(item.txnDate >= '2024-02-01' && item.txnDate <= '2024-02-28').toBe(true);
      });
    });

    it('filters by query string (case-insensitive LIKE on merchant/description)', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const res = await app.request('/transactions?q=grab');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ merchant: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0]!.merchant.toLowerCase()).toContain('grab');
    });

    it('filters by category none (uncategorized spend only, excluding payment/credit)', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const res = await app.request('/transactions?categoryId=none');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ categoryId: string | null; kind: string; merchant: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0]!.categoryId).toBeNull();
      expect(body.items[0]!.kind).toBe('purchase');
      expect(body.items[0]!.merchant).toBe('RANDOM SHOP');
    });

    it('filters by accountId', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const res = await app.request(`/transactions?accountId=${accountId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ accountId: string | null }> };
      expect(body.items.length).toBe(6);
    });

    it('filters by kind', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const res = await app.request('/transactions?kind=payment');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ kind: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0]!.kind).toBe('payment');
    });

    it('filters by source', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const res = await app.request('/transactions?source=pdf');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ source: string }> };
      expect(body.items.length).toBe(6);
      body.items.forEach((item) => {
        expect(item.source).toBe('pdf');
      });
    });

    it('excludes soft-deleted rows', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      // Soft delete one row
      const row = db.prepare('SELECT id FROM transactions WHERE kind = ?').get('payment') as { id: string };
      db.prepare('UPDATE transactions SET deleted_at = ? WHERE id = ?').run(Date.now(), row.id);

      const res = await app.request('/transactions');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
      expect(body.items.length).toBe(5);
      expect(body.total).toBe(5);
      const ids = body.items.map((i) => i.id);
      expect(ids).not.toContain(row.id);
    });
  });

  describe('POST / (manual create)', () => {
    it('creates a manual transaction => 201', async () => {
      const app = createAppWithUser(db, user1Id);
      const catId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)',
      ).run(catId, user1Id, 'TestCat', '#10b981');

      const res = await app.request('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txnDate: '2024-03-01',
          merchant: 'TEST MERCHANT',
          amountMinor: 500,
          accountId,
          categoryId: catId,
          notes: 'test note',
          paymentMethod: 'card',
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBeDefined();

      // Verify it appears in the list
      const listRes = await app.request('/transactions');
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { items: Array<{ source: string; description: string }> };
      const manual = listBody.items.find((i) => i.source === 'manual');
      expect(manual).toBeDefined();
      expect(manual!.description).toBe('TEST MERCHANT');
    });

    it('rejects invalid date => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      const res = await app.request('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txnDate: '2024-13-01', // invalid month
          merchant: 'MERCHANT',
          amountMinor: 100,
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe('invalid');
      expect(body.field).toBe('txnDate');
    });

    it('rejects invalid date format => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      const res = await app.request('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txnDate: '01-01-2024',
          merchant: 'MERCHANT',
          amountMinor: 100,
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe('invalid');
      expect(body.field).toBe('txnDate');
    });

    it('rejects invalid amount => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      const res = await app.request('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txnDate: '2024-03-01',
          merchant: 'MERCHANT',
          amountMinor: -100,
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe('invalid');
      expect(body.field).toBe('amountMinor');
    });

    it('rejects invalid accountId => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      const res = await app.request('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txnDate: '2024-03-01',
          merchant: 'MERCHANT',
          amountMinor: 100,
          accountId: 'nonexistent-id',
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe('invalid');
      expect(body.field).toBe('accountId');
    });

    it('rejects invalid categoryId => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      const res = await app.request('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txnDate: '2024-03-01',
          merchant: 'MERCHANT',
          amountMinor: 100,
          categoryId: 'nonexistent-cat',
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe('invalid');
      expect(body.field).toBe('categoryId');
    });
  });

  describe('PATCH /:id', () => {
    it('sets categoryId on a PDF transaction => 200', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const cat = crypto.randomUUID();
      db.prepare(
        'INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)',
      ).run(cat, user1Id, 'PatchCat', '#8b5cf6');

      const row = db.prepare(
        'SELECT id FROM transactions WHERE source = ? AND category_id IS NULL LIMIT 1',
      ).get('pdf') as { id: string };

      const res = await app.request(`/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: cat }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      // Verify the category was set
      const updated = db.prepare('SELECT category_id FROM transactions WHERE id = ?').get(row.id) as { category_id: string | null };
      expect(updated.category_id).toBe(cat);
    });

    it('PATCH on another user\'s transaction => 404', async () => {
      const app = createAppWithUser(db, user2Id);
      seedData(db, user1Id, accountId);

      const row = db.prepare(
        'SELECT id FROM transactions WHERE source = ? LIMIT 1',
      ).get('pdf') as { id: string };

      const res = await app.request(`/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: 'foreign-cat-id' }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('not_found');
    });

    it('rejects category belonging to another user => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      // Insert a category for user2
      const user2CatId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)',
      ).run(user2CatId, user2Id, 'Other', '#000000');

      // Pick an uncategorized PDF transaction of user1
      const row = db.prepare(
        'SELECT id FROM transactions WHERE source = ? AND category_id IS NULL LIMIT 1',
      ).get('pdf') as { id: string };

      // user1 PATCHes their own txn with user2's category
      const res = await app.request(`/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: user2CatId }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe('invalid');
      expect(body.field).toBe('categoryId');

      // Verify the category was NOT changed
      const updated = db.prepare('SELECT category_id FROM transactions WHERE id = ?').get(row.id) as { category_id: string | null };
      expect(updated.category_id).toBeNull();
    });

    it('rejects PATCH on non-existent id => 404', async () => {
      const app = createAppWithUser(db, user1Id);
      const res = await app.request('/transactions/nonexistent-id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'test' }),
      });
      expect(res.status).toBe(404);
    });

    it('rejects PATCH merchant on PDF row => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const row = db.prepare('SELECT id FROM transactions WHERE source = ? LIMIT 1').get('pdf') as { id: string };

      const res = await app.request(`/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant: 'NEW MERCHANT' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe('invalid');
      expect(body.field).toBe('merchant');
    });

    it('patches merchant on manual row => 200', async () => {
      const app = createAppWithUser(db, user1Id);

      // Create a manual transaction
      const createRes = await app.request('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txnDate: '2024-03-01',
          merchant: 'OLD MERCHANT',
          amountMinor: 100,
        }),
      });
      expect(createRes.status).toBe(201);
      const createBody = (await createRes.json()) as { id: string };

      const res = await app.request(`/transactions/${createBody.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant: 'NEW MERCHANT' }),
      });
      expect(res.status).toBe(200);
      await res.json();

      const updated = db.prepare('SELECT merchant, description FROM transactions WHERE id = ?').get(createBody.id) as { merchant: string; description: string };
      expect(updated.merchant).toBe('NEW MERCHANT');
      expect(updated.description).toBe('NEW MERCHANT');
    });

    it('rejects PATCH amountMinor on PDF row => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const row = db.prepare('SELECT id FROM transactions WHERE source = ? LIMIT 1').get('pdf') as { id: string };

      const res = await app.request(`/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountMinor: 9999 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe('invalid');
      expect(body.field).toBe('amountMinor');
    });

    it('rejects PATCH txnDate on PDF row => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const row = db.prepare('SELECT id FROM transactions WHERE source = ? LIMIT 1').get('pdf') as { id: string };

      const res = await app.request(`/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnDate: '2099-01-01' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe('invalid');
      expect(body.field).toBe('txnDate');
    });

    it('rejects foreign user PATCH => 404', async () => {
      const { app1, app2 } = createTwoUserApp(db, user1Id, user2Id);
      seedData(db, user1Id, accountId);

      const row = db.prepare('SELECT id FROM transactions WHERE user_id = ? LIMIT 1').get(user1Id) as { id: string };

      const res = await app2.request(`/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'hacked' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('hard deletes manual transaction => 204', async () => {
      const app = createAppWithUser(db, user1Id);

      // Create a manual transaction
      const createRes = await app.request('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txnDate: '2024-03-01',
          merchant: 'DELETE ME',
          amountMinor: 100,
        }),
      });
      expect(createRes.status).toBe(201);
      const createBody = (await createRes.json()) as { id: string };

      const delRes = await app.request(`/transactions/${createBody.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(204);

      // Verify row is gone
      const row = db.prepare('SELECT id FROM transactions WHERE id = ?').get(createBody.id);
      expect(row).toBeNull();

      // Verify not in list
      const listRes = await app.request('/transactions');
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { items: Array<{ id: string }> };
      expect(listBody.items.some((i) => i.id === createBody.id)).toBe(false);
    });

    it('soft deletes PDF transaction => 204, row still exists', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const row = db.prepare('SELECT id FROM transactions WHERE source = ? LIMIT 1').get('pdf') as { id: string };

      const delRes = await app.request(`/transactions/${row.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(204);

      // Verify row still exists but is soft-deleted
      const softRow = db.prepare('SELECT id, deleted_at FROM transactions WHERE id = ?').get(row.id) as { id: string; deleted_at: number };
      expect(softRow.id).toBe(row.id);
      expect(softRow.deleted_at).toBeGreaterThan(0);

      // Verify not in list
      const listRes = await app.request('/transactions');
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { items: Array<{ id: string }> };
      expect(listBody.items.some((i) => i.id === row.id)).toBe(false);
    });

    it('returns 404 for foreign user DELETE => 404', async () => {
      const { app1, app2 } = createTwoUserApp(db, user1Id, user2Id);
      seedData(db, user1Id, accountId);

      const row = db.prepare('SELECT id FROM transactions WHERE user_id = ? LIMIT 1').get(user1Id) as { id: string };

      const delRes = await app2.request(`/transactions/${row.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(404);
    });
  });

  describe('GET /summary', () => {
    it('excludes payment and credit from spend', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      // Expected spend: 5000 + 3000 + 2000 + 1500 = 11500 (purchase kinds only)
      // payment (10000) and credit (1000) are excluded
      const res = await app.request('/transactions/summary');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { spendMinor: number };
      expect(body.spendMinor).toBe(11500);
    });

    it('byMonth sums match spend for the filtered range', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const res = await app.request('/transactions/summary?from=2024-01-01&to=2024-12-31');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { spendMinor: number; byMonth: Array<{ month: string; totalMinor: number }> };
      const monthSum = body.byMonth.reduce((sum, m) => sum + m.totalMinor, 0);
      expect(monthSum).toBe(body.spendMinor);
    });

    it('byCategory includes uncategorized', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      const res = await app.request('/transactions/summary');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { byCategory: Array<{ name: string; categoryId: string | null; color: string }> };
      const uncategorized = body.byCategory.find((c) => c.categoryId === null);
      expect(uncategorized).toBeDefined();
      expect(uncategorized!.name).toBe('Uncategorized');
      expect(uncategorized!.color).toBe('#64748b');
    });

    it('user2 summary is independent', async () => {
      const { app1, app2 } = createTwoUserApp(db, user1Id, user2Id);
      seedData(db, user1Id, accountId);

      const res = await app2.request('/transactions/summary');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { spendMinor: number };
      expect(body.spendMinor).toBe(0);
    });

    it('summary respects date filter', async () => {
      const app = createAppWithUser(db, user1Id);
      seedData(db, user1Id, accountId);

      // Jan: 5000 + 3000 = 8000
      const res = await app.request('/transactions/summary?from=2024-01-01&to=2024-01-31');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { spendMinor: number };
      expect(body.spendMinor).toBe(8000);
    });
  });

  describe('categories CRUD', () => {
    it('GET /categories returns user categories', async () => {
      const app = createAppWithUser(db, user1Id);
      db.prepare(
        'INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)',
      ).run(crypto.randomUUID(), user1Id, 'Food', '#ef4444');

      const res = await app.request('/transactions/categories');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ name: string }>;
      expect(body.length).toBe(1);
      expect(body[0]!.name).toBe('Food');
    });

    it('POST /categories creates a category => 201', async () => {
      const app = createAppWithUser(db, user1Id);
      const res = await app.request('/transactions/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Category', color: '#abcdef' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBeDefined();
    });

    it('POST /categories rejects duplicate name => 409', async () => {
      const app = createAppWithUser(db, user1Id);
      db.prepare(
        'INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)',
      ).run(crypto.randomUUID(), user1Id, 'Dup', '#111111');

      const res = await app.request('/transactions/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Dup' }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('exists');
    });

    it('DELETE /categories/:id removes category => 204', async () => {
      const app = createAppWithUser(db, user1Id);
      const catId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)',
      ).run(catId, user1Id, 'ToDelete', '#222222');

      const delRes = await app.request(`/transactions/categories/${catId}`, { method: 'DELETE' });
      expect(delRes.status).toBe(204);

      // Verify gone
      const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(catId);
      expect(cat).toBeNull();
    });

    it('DELETE /categories/:id returns 404 for foreign category', async () => {
      const { app1, app2 } = createTwoUserApp(db, user1Id, user2Id);
      const catId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)',
      ).run(catId, user1Id, 'Foreign', '#333333');

      const delRes = await app2.request(`/transactions/categories/${catId}`, { method: 'DELETE' });
      expect(delRes.status).toBe(404);
    });

    it('POST /categories rejects empty name => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      const res = await app.request('/transactions/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; field: string };
      expect(body.error).toBe('invalid');
      expect(body.field).toBe('name');
    });
  });

  describe('cross-user isolation', () => {
    it('user2 cannot see user1 transactions => 404 on user1 id', async () => {
      const { app1, app2 } = createTwoUserApp(db, user1Id, user2Id);
      seedData(db, user1Id, accountId);

      const row = db.prepare('SELECT id FROM transactions WHERE user_id = ? LIMIT 1').get(user1Id) as { id: string };

      const res = await app2.request(`/transactions/${row.id}`);
      expect(res.status).toBe(404);
    });
  });
});
