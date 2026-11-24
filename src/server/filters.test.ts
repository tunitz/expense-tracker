import { describe, it, expect } from 'bun:test';
import { openDb } from './db';
import { buildTxnQuery } from '../../web/src/lib/filters';
import { Hono } from 'hono';
import { transactionsRoutes } from './routes/transactions';
import { ensureDefaultCategories } from './categorize';
import { randomUUID } from 'crypto';

// Mirrors api.listTxns: empty values are dropped from the query string.
function toQueryString(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.append(k, String(v));
  return p.toString();
}

const base = { month: 'all', category: 'all', source: 'all', search: '', page: 0 };

describe('buildTxnQuery category filter', () => {
  it('"all" sends no categoryId', () => {
    expect(buildTxnQuery(base).categoryId).toBeUndefined();
  });
  it('"none" survives the query string as categoryId=none', () => {
    const qs = toQueryString(buildTxnQuery({ ...base, category: 'none' }));
    expect(new URLSearchParams(qs).get('categoryId')).toBe('none');
  });
  it('a real category id is passed through', () => {
    expect(buildTxnQuery({ ...base, category: 'abc' }).categoryId).toBe('abc');
  });
});

describe('Uncategorized filter end to end', () => {
  it('returns only uncategorized rows', async () => {
    const db = openDb(':memory:');
    const u = randomUUID();
    db.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [u, 'f@t.io', 'x', Date.now()]);
    ensureDefaultCategories(db, u);
    const food = (db.query("SELECT id FROM categories WHERE user_id = ? AND name = 'Food'").get(u) as { id: string }).id;
    const add = (m: string, cat: string | null, kind = 'purchase') =>
      db.run(
        `INSERT INTO transactions (id, user_id, source, txn_date, description, merchant, amount_minor, kind, occurrence, created_at, category_id)
         VALUES (?, ?, 'pdf', '2026-09-01', ?, ?, 100, ?, 1, ?, ?)`,
        [randomUUID(), u, m, m, kind, Date.now(), cat],
      );
    add('A', food); add('B', null); add('C', null); add('PAYMENT', null, 'payment'); add('CREDIT', null, 'credit');
    const app = new Hono<any>();
    app.use('*', async (c, n) => { c.set('user', { id: u, email: 'x' }); await n(); });
    app.route('/t', transactionsRoutes(db));
    const qs = toQueryString(buildTxnQuery({ ...base, category: 'none' }));
    const res = await app.request(`/t?${qs}`);
    const body = (await res.json()) as { items: { merchant: string }[]; total: number };
    expect(body.items.map((i) => i.merchant).sort()).toEqual(['B', 'C']);
    expect(body.total).toBe(2);
  });
});
