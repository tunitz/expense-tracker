import { describe, it, expect } from 'bun:test';
import { openDb } from './db';
import { randomUUID } from 'crypto';
import {
  DEFAULT_CATEGORIES,
  categoryForTxn,
  ensureDefaultCategories,
} from './categorize';

function userWith(db: ReturnType<typeof openDb>): string {
  const id = randomUUID();
  db.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    id,
    `${id}@t.io`,
    'x',
    Date.now(),
  ]);
  return id;
}

function addTxn(
  db: ReturnType<typeof openDb>,
  userId: string,
  merchant: string,
  kind = 'purchase',
): string {
  const id = randomUUID();
  db.run(
    `INSERT INTO transactions (id, user_id, source, txn_date, description, merchant, amount_minor, kind, occurrence, created_at)
     VALUES (?, ?, 'pdf', '2026-09-01', ?, ?, 10000, ?, 1, ?)`,
    [id, userId, merchant, merchant, kind, Date.now()],
  );
  return id;
}

function catOf(db: ReturnType<typeof openDb>, txnId: string): string | null {
  const r = db
    .query('SELECT c.name AS name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?')
    .get(txnId) as { name: string | null };
  return r.name;
}

describe('categoryForTxn', () => {
  const cases: [string, string][] = [
    ['GRAB, PASIG CITY, PH', 'Transport'],
    ['JOLLIBEE SAMPLE, MANILA, PH', 'Food'],
    ['MCDONALDS SAMPLE, MANILA, PH', 'Food'],
    ['ANTHROPIC* CLAUDE SUB, ANTHROP', 'Subscriptions'],
    ['OPENAI *CHATGPT SUBSCR, OPENAI', 'Subscriptions'],
    ['DEEPSEERWEA, 10000000001, HK', 'Subscriptions'],
    ['W *Xiaomi MiMo, platform.xiao', 'Subscriptions'],
    ['PAYPAL *DIGITALOCEA, 100000001', 'Subscriptions'],
    ['Online Bills Payment to PLDT I', 'Bills'],
    ['PAYPAL *STEAM GAMES, 100000001', 'Entertainment'],
    ['ROSE PHARMACY SAMPLE, PH', 'Health'],
    ['WATSONS SAMPLE MALL, PH', 'Health'],
    ['DECATHLON SAMPLE, MANILA, PH', 'Shopping'],
    ['TEMU.COM, SINGAPORE, SG', 'Shopping'],
    ['POWER MAC SAMPLE', 'Shopping'],
    ['7-ELEVEN-ST1001, MANILA, PH', 'Food'],
    ['OPENROUTER, INC, OPENROUTER.AI, US', 'Subscriptions'],
    ['PAYPAL *CLOUDFLARE, 1000000001, US', 'Subscriptions'],
    ['SKECHERS SAMPLE, MANILA, PH', 'Shopping'],
    ['AQUAFLASK SAMPLE, MANILA, PH', 'Shopping'],
    ['DATABLITZ-ECEPP', 'Shopping'],
    ['ROBINSONS SPMKT SAMPLE, PH', 'Food'],
    ['ROBINSONS SUPERMARKET, MANILA, PH', 'Food'],
    ['LAZADA SPMKT, TAGUIG CITY, PH', 'Shopping'],
    ['LAZADA PHILS, TAGUIG CITY, PH', 'Shopping'],
    ['MOVE IT, PASIG CITY, PH', 'Transport'],
    ['GRAB MOVEIT, PASIG CITY, PH', 'Transport'],
    ['Maxim Client, MANILA, PH', 'Transport'],
    ['OCEANJET, MANILA, PH', 'Transport'],
    ['COMMANDCODE.AI, COMMANDCODE.A, US', 'Subscriptions'],
    ['OPENCODE, OPENCODE.AI, US', 'Subscriptions'],
    ['KENNY ROGERS SAMPLE, PH', 'Food'],
    ['NYBUFFALOBRADSHOTWING, MANILA, PH', 'Food'],
    ['THE BURGER JOINT, MANILA, PH', 'Food'],
    ['SSD SAMPLE BRANCH, PH', 'Health'],
  ];
  for (const [merchant, expected] of cases) {
    it(`${merchant} -> ${expected}`, () => {
      expect(categoryForTxn({ merchant, kind: 'purchase' })).toBe(expected);
    });
  }

  it('is case-insensitive', () => {
    expect(categoryForTxn({ merchant: 'grab makati', kind: 'purchase' })).toBe('Transport');
  });

  it('instalment principal lines without a known merchant default to Installments', () => {
    expect(categoryForTxn({ merchant: 'Instalment Principal [1000002]', kind: 'instalment_principal' })).toBe('Installments');
  });

  it('merchant 0% instalment rows still match their merchant category', () => {
    expect(categoryForTxn({ merchant: 'POWER MAC SAMPLE', kind: 'instalment_principal' })).toBe('Shopping');
    expect(categoryForTxn({ merchant: 'Powermac-Sample Mall', kind: 'instalment_principal' })).toBe('Shopping');
    expect(categoryForTxn({ merchant: 'Lazada Ph Sample 3m', kind: 'instalment_principal' })).toBe('Shopping');
    expect(categoryForTxn({ merchant: 'ABENSON-SAMPLE', kind: 'instalment_principal' })).toBe('Shopping');
  });

  it('unknown merchants default to Others instead of staying uncategorized', () => {
    expect(categoryForTxn({ merchant: 'SAMPLE SHOP 101, MANILA, PH', kind: 'purchase' })).toBe('Others');
    expect(categoryForTxn({ merchant: 'SAMPLE MOTORS, MANILA, PH', kind: 'purchase' })).toBe('Others');
    expect(categoryForTxn({ merchant: 'ZZ UNKNOWN SHOP', kind: 'purchase' })).toBe('Others');
  });

  it('instalment interest goes to Fees & Interest regardless of merchant text', () => {
    expect(categoryForTxn({ merchant: 'Instalment Interest (01/06) [1000003]', kind: 'instalment_interest' })).toBe('Fees & Interest');
  });

  it('payments and credits are never categorized', () => {
    expect(categoryForTxn({ merchant: 'Payment - Thank You', kind: 'payment' })).toBeNull();
    expect(categoryForTxn({ merchant: 'GRAB REFUND', kind: 'credit' })).toBeNull();
  });
});

describe('ensureDefaultCategories', () => {
  it('seeds the default set for a user with no categories', () => {
    const db = openDb(':memory:');
    const u = userWith(db);
    ensureDefaultCategories(db, u);
    const names = (db.query('SELECT name FROM categories WHERE user_id = ? ORDER BY name').all(u) as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(DEFAULT_CATEGORIES.map((c) => c.name).sort());
  });

  it('is idempotent', () => {
    const db = openDb(':memory:');
    const u = userWith(db);
    ensureDefaultCategories(db, u);
    ensureDefaultCategories(db, u);
    const n = (db.query('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?').get(u) as { n: number }).n;
    expect(n).toBe(DEFAULT_CATEGORIES.length);
  });

  it('does not bring back a category the user deleted', () => {
    const db = openDb(':memory:');
    const u = userWith(db);
    ensureDefaultCategories(db, u);
    db.run("DELETE FROM categories WHERE user_id = ? AND name = 'Health'", [u]);
    ensureDefaultCategories(db, u);
    const n = (db.query('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?').get(u) as { n: number }).n;
    expect(n).toBe(DEFAULT_CATEGORIES.length - 1);
  });

  it('backfills existing uncategorized transactions when it seeds', () => {
    const db = openDb(':memory:');
    const u = userWith(db);
    const grab = addTxn(db, u, 'GRAB, PASIG CITY, PH');
    const unknown = addTxn(db, u, 'ZZ UNKNOWN SHOP');
    const pay = addTxn(db, u, 'Payment - Thank You', 'payment');
    ensureDefaultCategories(db, u);
    expect(catOf(db, grab)).toBe('Transport');
    expect(catOf(db, unknown)).toBe('Others');
    expect(catOf(db, pay)).toBeNull();
  });

  it('seeds one user without touching another', () => {
    const db = openDb(':memory:');
    const a = userWith(db);
    const b = userWith(db);
    ensureDefaultCategories(db, a);
    const n = (db.query('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?').get(b) as { n: number }).n;
    expect(n).toBe(0);
  });
});

describe('wiring', () => {
  it('register seeds default categories for the new user', async () => {
    const { createApp } = await import('./app');
    const db = openDb(':memory:');
    const app = createApp(db);
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'seed@b.co', password: 'longenoughpw' }),
    });
    expect(res.status).toBe(201);
    const n = (db.query('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
    expect(n).toBe(DEFAULT_CATEGORIES.length);
  });

  it('login seeds and backfills an existing user who has no categories', async () => {
    const { createApp } = await import('./app');
    const db = openDb(':memory:');
    const app = createApp(db);
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'old@b.co', password: 'longenoughpw' }),
    });
    const u = (db.query("SELECT id FROM users WHERE email = 'old@b.co'").get() as { id: string }).id;
    db.run('DELETE FROM categories WHERE user_id = ?', [u]); // simulate a pre-feature account
    const t = addTxn(db, u, 'GRAB, MAKATI, PH');
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'old@b.co', password: 'longenoughpw' }),
    });
    expect(res.status).toBe(200);
    expect(catOf(db, t)).toBe('Transport');
  });

  it('importStatement categorizes known rows, puts unknown merchants in Others, and leaves payments null', async () => {
    const { importStatement } = await import('./import');
    const db = openDb(':memory:');
    const u = userWith(db);
    ensureDefaultCategories(db, u);
    const base = { postedDate: null, fxAmountMinor: null, fxCurrency: null, instalmentRef: null, instalmentSeq: null, subAccount: null };
    const st = {
      bank: 'bpi' as const, accountRef: '1', accountLast4: '1', accountName: 'X',
      statementDate: '2026-09-14', periodStart: '2026-08-15', periodEnd: '2026-09-14', dueDate: null,
      totals: { previousBalanceMinor: 0, purchasesMinor: 0, paymentsMinor: 0, totalDueMinor: 0, minDueMinor: 0 },
      warnings: [],
      txns: [
        { ...base, txnDate: '2026-09-01', description: 'JOLLIBEE JB1', merchant: 'JOLLIBEE JB1', amountMinor: 5000, kind: 'purchase' as const },
        { ...base, txnDate: '2026-09-02', description: 'ZZ UNKNOWN', merchant: 'ZZ UNKNOWN', amountMinor: 6000, kind: 'purchase' as const },
        { ...base, txnDate: '2026-09-03', description: 'Payment - Thank You', merchant: 'Payment - Thank You', amountMinor: -7000, kind: 'payment' as const },
      ],
    };
    importStatement(db, u, st, { sha256: 'abc', filename: 'f.pdf', storedPath: null });
    const rows = db.query('SELECT merchant, c.name AS cat FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.user_id = ? ORDER BY t.txn_date').all(u) as { merchant: string; cat: string | null }[];
    expect(rows.map((r) => r.cat)).toEqual(['Food', 'Others', null]);
  });

  it('user merchant_rules auto-categorize future statement imports (including instalment plans across months)', async () => {
    const { importStatement } = await import('./import');
    const { Hono } = await import('hono');
    const { transactionsRoutes } = await import('./routes/transactions');
    const db = openDb(':memory:');
    const u = userWith(db);
    const otherUser = userWith(db);
    ensureDefaultCategories(db, u);
    ensureDefaultCategories(db, otherUser);

    const app = new Hono<any>();
    app.use('*', async (c, next) => { c.set('user', { id: u, email: 'a@b.c' }); await next(); });
    app.route('/t', transactionsRoutes(db));

    const base = { postedDate: null, fxAmountMinor: null, fxCurrency: null, subAccount: null };
    const mkStmt = (stmtDate: string, seq: string, txnDate: string) => ({
      bank: 'unionbank' as const, accountRef: '4321', accountLast4: '4321', accountName: 'X',
      statementDate: stmtDate, periodStart: txnDate, periodEnd: stmtDate, dueDate: null,
      totals: { previousBalanceMinor: 0, purchasesMinor: 350000, paymentsMinor: 0, totalDueMinor: 350000, minDueMinor: 0 },
      warnings: [],
      txns: [
        {
          ...base,
          txnDate,
          description: `Instalment Principal (${seq}) [1000001]`,
          merchant: 'Instalment Principal [1000001]',
          amountMinor: 350000,
          kind: 'instalment_principal' as const,
          instalmentRef: '1000001',
          instalmentSeq: seq,
        },
      ],
    });

    // Month 1: defaults to Installments
    importStatement(db, u, mkStmt('2026-11-03', '03/12', '2026-11-03'), { sha256: 'm1', filename: 'nov.pdf', storedPath: null });
    const novTxn = db.query('SELECT id FROM transactions WHERE user_id = ?').get(u) as { id: string };
    expect(catOf(db, novTxn.id)).toBe('Installments');

    // User labels plan [1000001] as Shopping -> saves merchant_rule
    const shoppingId = (db.query("SELECT id FROM categories WHERE user_id = ? AND name = 'Shopping'").get(u) as { id: string }).id;
    const patchRes = await app.request(`/t/${novTxn.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: shoppingId }),
    });
    expect(patchRes.status).toBe(200);
    expect(((await patchRes.json()) as { ruleSaved: boolean }).ruleSaved).toBe(true);

    // Month 2: same plan with (04/12) auto-categorizes as Shopping for u, but stays Installments for otherUser
    importStatement(db, u, mkStmt('2026-12-03', '04/12', '2026-12-03'), { sha256: 'm2', filename: 'dec.pdf', storedPath: null });
    const decTxn = db.query("SELECT id FROM transactions WHERE user_id = ? AND txn_date = '2026-12-03'").get(u) as { id: string };
    expect(catOf(db, decTxn.id)).toBe('Shopping');

    importStatement(db, otherUser, mkStmt('2026-12-03', '04/12', '2026-12-03'), { sha256: 'm2-other', filename: 'dec.pdf', storedPath: null });
    const otherTxn = db.query('SELECT id FROM transactions WHERE user_id = ?').get(otherUser) as { id: string };
    expect(catOf(db, otherTxn.id)).toBe('Installments');
  });

  it('import never overwrites a category the user already set on a re-linked row', async () => {
    const { importStatement } = await import('./import');
    const db = openDb(':memory:');
    const u = userWith(db);
    ensureDefaultCategories(db, u);
    const base = { postedDate: null, fxAmountMinor: null, fxCurrency: null, instalmentRef: null, instalmentSeq: null, subAccount: null };
    const mk = (sha: string) => ({
      bank: 'bpi' as const, accountRef: '1', accountLast4: '1', accountName: 'X',
      statementDate: '2026-09-14', periodStart: '2026-08-15', periodEnd: '2026-09-14', dueDate: null,
      totals: { previousBalanceMinor: 0, purchasesMinor: 0, paymentsMinor: 0, totalDueMinor: 0, minDueMinor: 0 },
      warnings: [],
      txns: [{ ...base, txnDate: '2026-09-01', description: 'GRAB X', merchant: 'GRAB X', amountMinor: 5000, kind: 'purchase' as const }],
    });
    importStatement(db, u, mk('a'), { sha256: 'a', filename: 'a.pdf', storedPath: null });
    const shopping = (db.query("SELECT id FROM categories WHERE user_id = ? AND name = 'Shopping'").get(u) as { id: string }).id;
    db.run('UPDATE transactions SET category_id = ? WHERE user_id = ?', [shopping, u]);
    importStatement(db, u, mk('b'), { sha256: 'b', filename: 'b.pdf', storedPath: null });
    const cat = (db.query('SELECT c.name AS n FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.user_id = ?').get(u) as { n: string }).n;
    expect(cat).toBe('Shopping');
  });
});

describe('PATCH with applyToMerchant', () => {
  async function setup() {
    const { Hono } = await import('hono');
    const { transactionsRoutes } = await import('./routes/transactions');
    const db = openDb(':memory:');
    const u = userWith(db);
    const other = userWith(db);
    ensureDefaultCategories(db, u);
    ensureDefaultCategories(db, other);
    const app = new Hono<any>();
    app.use('*', async (c, next) => { c.set('user', { id: u, email: 'a@b.c' }); await next(); });
    app.route('/t', transactionsRoutes(db));
    const cat = (name: string, uid = u) => (db.query('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(uid, name) as { id: string }).id;
    return { db, app, u, other, cat };
  }
  const patch = (app: any, id: string, body: unknown) =>
    app.request(`/t/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('applies the category to every transaction with the same merchant, only for this user', async () => {
    const { db, app, u, other, cat } = await setup();
    const a = addTxn(db, u, 'ZZ UNKNOWN SHOP');
    const b = addTxn(db, u, 'ZZ UNKNOWN SHOP');
    const c = addTxn(db, u, 'OTHER SHOP');
    const theirs = addTxn(db, other, 'ZZ UNKNOWN SHOP');
    const res = await patch(app, a, { categoryId: cat('Shopping'), applyToMerchant: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(2);
    expect(catOf(db, a)).toBe('Shopping');
    expect(catOf(db, b)).toBe('Shopping');
    expect(catOf(db, c)).toBeNull();
    expect(catOf(db, theirs)).toBeNull();
  });

  it('without the flag only the one transaction changes', async () => {
    const { db, app, u, cat } = await setup();
    const a = addTxn(db, u, 'ZZ UNKNOWN SHOP');
    const b = addTxn(db, u, 'ZZ UNKNOWN SHOP');
    await patch(app, a, { categoryId: cat('Shopping') });
    expect(catOf(db, a)).toBe('Shopping');
    expect(catOf(db, b)).toBeNull();
  });

  it('saveRule: false updates only the single row without saving a rule', async () => {
    const { db, app, u, cat } = await setup();
    const a = addTxn(db, u, 'ONE OFF SHOP');
    const res = await patch(app, a, { categoryId: cat('Shopping'), saveRule: false });
    expect(((await res.json()) as { ruleSaved: boolean }).ruleSaved).toBe(false);
    const ruleCount = (db.query('SELECT COUNT(*) AS n FROM merchant_rules WHERE user_id = ?').get(u) as { n: number }).n;
    expect(ruleCount).toBe(0);
  });

  it('applyToMerchant with a null category clears the whole merchant and deletes its rule', async () => {
    const { db, app, u, cat } = await setup();
    const a = addTxn(db, u, 'ZZ UNKNOWN SHOP');
    const b = addTxn(db, u, 'ZZ UNKNOWN SHOP');
    await patch(app, a, { categoryId: cat('Shopping'), applyToMerchant: true });
    expect((db.query('SELECT COUNT(*) AS n FROM merchant_rules WHERE user_id = ?').get(u) as { n: number }).n).toBe(1);
    await patch(app, a, { categoryId: null, applyToMerchant: true });
    expect(catOf(db, a)).toBeNull();
    expect(catOf(db, b)).toBeNull();
    expect((db.query('SELECT COUNT(*) AS n FROM merchant_rules WHERE user_id = ?').get(u) as { n: number }).n).toBe(0);
  });
});

describe('default category colors', () => {
  it('are unique and never the grey used for Uncategorized', () => {
    const colors = DEFAULT_CATEGORIES.map((c) => c.color.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors).not.toContain('#64748b');
  });
});

describe('POST /documents/:id/recategorize', () => {
  async function setup() {
    const { Hono } = await import('hono');
    const { documentsRoutes } = await import('./routes/documents');
    const db = openDb(':memory:');
    const u = userWith(db);
    const other = userWith(db);
    const app = new Hono<any>();
    app.use('*', async (c, next) => { c.set('user', { id: u, email: 'a@b.c' }); await next(); });
    app.route('/d', documentsRoutes(db));
    const mkDoc = (uid: string, sha: string) => {
      const acct = randomUUID(), doc = randomUUID();
      db.run("INSERT INTO accounts (id, user_id, bank, name, last4, account_ref) VALUES (?, ?, 'bpi', 'X', '1', ?)", [acct, uid, acct]);
      db.run(
        "INSERT INTO documents (id, user_id, account_id, sha256, filename, statement_date, period_start, period_end, totals_json, status, version, uploaded_at) VALUES (?, ?, ?, ?, 'f.pdf', '2026-09-14', '2026-08-15', '2026-09-14', '{}', 'parsed', 1, ?)",
        [doc, uid, acct, sha, Date.now()],
      );
      return doc;
    };
    const inDoc = (uid: string, doc: string, merchant: string) => {
      const id = addTxn(db, uid, merchant);
      db.run('UPDATE transactions SET document_id = ? WHERE id = ?', [doc, id]);
      return id;
    };
    return { db, app, u, other, mkDoc, inDoc };
  }
  const call = (app: any, id: string) => app.request(`/d/${id}/recategorize`, { method: 'POST' });

  it('categorizes only that statement\'s uncategorized rows (assigning Others to unknown) and reports counts', async () => {
    const { db, app, u, mkDoc, inDoc } = await setup();
    ensureDefaultCategories(db, u);
    const d1 = mkDoc(u, 'a'), d2 = mkDoc(u, 'b');
    const grab = inDoc(u, d1, 'GRAB, MAKATI, PH');
    const unknown = inDoc(u, d1, 'ZZ UNKNOWN SHOP');
    const elsewhere = inDoc(u, d2, 'GRAB, PASIG CITY, PH');
    const res = await call(app, d1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2, remaining: 0 });
    expect(catOf(db, grab)).toBe('Transport');
    expect(catOf(db, unknown)).toBe('Others');
    expect(catOf(db, elsewhere)).toBeNull();
  });

  it('upgrades Others rows when a user merchant_rule is added', async () => {
    const { db, app, u, mkDoc, inDoc } = await setup();
    ensureDefaultCategories(db, u);
    const { upsertMerchantRule } = await import('./categorize');
    const d1 = mkDoc(u, 'a');
    const unknown = inDoc(u, d1, 'SAMPLE SHOP 101, MANILA, PH');
    await call(app, d1);
    expect(catOf(db, unknown)).toBe('Others');

    const foodId = (db.query("SELECT id FROM categories WHERE user_id = ? AND name = 'Food'").get(u) as { id: string }).id;
    upsertMerchantRule(db, u, 'SAMPLE SHOP 101, MANILA, PH', foodId);
    const res = await call(app, d1);
    expect(await res.json()).toEqual({ updated: 1, remaining: 0 });
    expect(catOf(db, unknown)).toBe('Food');
  });

  it('never overwrites a category the user already set', async () => {
    const { db, app, u, mkDoc, inDoc } = await setup();
    ensureDefaultCategories(db, u);
    const d = mkDoc(u, 'a');
    const t = inDoc(u, d, 'GRAB, MAKATI, PH');
    const shopping = (db.query("SELECT id FROM categories WHERE user_id = ? AND name = 'Shopping'").get(u) as { id: string }).id;
    db.run('UPDATE transactions SET category_id = ? WHERE id = ?', [shopping, t]);
    await call(app, d);
    expect(catOf(db, t)).toBe('Shopping');
  });

  it('picks up transactions that predate the categories', async () => {
    const { db, app, u, mkDoc, inDoc } = await setup();
    const d = mkDoc(u, 'a');
    const t = inDoc(u, d, 'JOLLIBEE JB1');
    ensureDefaultCategories(db, u); // would already backfill; clear to simulate an old import
    db.run('UPDATE transactions SET category_id = NULL WHERE id = ?', [t]);
    const res = await call(app, d);
    expect(((await res.json()) as { updated: number }).updated).toBe(1);
    expect(catOf(db, t)).toBe('Food');
  });

  it('404 for another user\'s or unknown statement', async () => {
    const { db, app, u, other, mkDoc, inDoc } = await setup();
    ensureDefaultCategories(db, u);
    const theirs = mkDoc(other, 'z');
    const t = inDoc(other, theirs, 'GRAB, MAKATI, PH');
    expect((await call(app, theirs)).status).toBe(404);
    expect((await call(app, randomUUID())).status).toBe(404);
    expect(catOf(db, t)).toBeNull();
  });
});

describe('users who stayed logged in across the deploy (no categories yet)', () => {
  async function setup() {
    const { Hono } = await import('hono');
    const { documentsRoutes } = await import('./routes/documents');
    const { transactionsRoutes } = await import('./routes/transactions');
    const db = openDb(':memory:');
    const u = userWith(db);
    const app = new Hono<any>();
    app.use('*', async (c, next) => { c.set('user', { id: u, email: 'a@b.c' }); await next(); });
    app.route('/d', documentsRoutes(db));
    app.route('/t', transactionsRoutes(db));
    const acct = randomUUID(), doc = randomUUID();
    db.run("INSERT INTO accounts (id, user_id, bank, name, last4, account_ref) VALUES (?, ?, 'bpi', 'X', '1', ?)", [acct, u, acct]);
    db.run(
      "INSERT INTO documents (id, user_id, account_id, sha256, filename, statement_date, period_start, period_end, totals_json, status, version, uploaded_at) VALUES (?, ?, ?, 'a', 'f.pdf', '2026-09-14', '2026-08-15', '2026-09-14', '{}', 'parsed', 1, ?)",
      [doc, u, acct, Date.now()],
    );
    const t = addTxn(db, u, 'GRAB, MAKATI, PH');
    db.run('UPDATE transactions SET document_id = ? WHERE id = ?', [doc, t]);
    return { db, app, u, doc, t };
  }

  it('Re-categorize seeds the defaults first, then categorizes', async () => {
    const { db, app, doc, t } = await setup();
    const res = await app.request(`/d/${doc}/recategorize`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(catOf(db, t)).toBe('Transport'); // seeding backfilled it
    expect(await res.json()).toEqual({ updated: 1, remaining: 0 }); // and the count reflects it
  });

  it('listing categories seeds the defaults so the dropdown is never empty', async () => {
    const { db, app, t } = await setup();
    const res = await app.request('/t/categories');
    const cats = (await res.json()) as { name: string }[];
    expect(cats.map((c) => c.name).sort()).toEqual(DEFAULT_CATEGORIES.map((c) => c.name).sort());
    expect(catOf(db, t)).toBe('Transport');
  });
});
