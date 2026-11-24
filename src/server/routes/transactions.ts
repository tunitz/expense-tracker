import { ensureDefaultCategories, upsertMerchantRule, deleteMerchantRule } from '../categorize';
import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { AppEnv } from '../app';

const MAX_LIMIT = 500;

function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const parts = d.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const day = Number(parts[2]);
  const dt = new Date(y, m - 1, day);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === day;
}

function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function transactionsRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // ── GET /summary (must be before /:id) ──
  app.get('/summary', (c) => {
    const userId = c.get('user').id;
    const from = c.req.query('from');
    const to = c.req.query('to');
    const accountId = c.req.query('accountId');

    const conditions: string[] = [`t.user_id = ?`, 't.deleted_at IS NULL'];
    const params: (string | number)[] = [userId];

    if (from) {
      conditions.push('t.txn_date >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('t.txn_date <= ?');
      params.push(to);
    }
    if (accountId) {
      conditions.push('t.account_id = ?');
      params.push(accountId);
    }

    const spendConditions = [
      ...conditions,
      "t.kind IN ('purchase','fee','interest','instalment_principal','instalment_interest')",
    ];
    const spendWhere = `WHERE ${spendConditions.join(' AND ')}`;

    // Spend: purchase, fee, interest, instalment_principal, instalment_interest
    // payment and credit are EXCLUDED
    const spendRow = db
      .prepare(
        `SELECT COALESCE(SUM(t.amount_minor), 0) AS spend_minor
         FROM transactions t ${spendWhere}`,
      )
      .get(...params) as { spend_minor: number };

    // By category (payments and credits excluded so they don't create empty Uncategorized rows)
    const byCategory = db
      .prepare(
        `SELECT t.category_id AS categoryId,
                COALESCE(c.name, 'Uncategorized') AS name,
                COALESCE(c.color, '#64748b') AS color,
                SUM(t.amount_minor) AS total_minor
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         ${spendWhere}
         GROUP BY t.category_id
         ORDER BY total_minor DESC`,
      )
      .all(...params) as Array<{
        categoryId: string | null;
        name: string;
        color: string;
        total_minor: number;
      }>;

    // By month
    const byMonth = db
      .prepare(
        `SELECT SUBSTR(t.txn_date, 1, 7) AS month,
                SUM(t.amount_minor) AS total_minor
         FROM transactions t ${spendWhere}
         GROUP BY month
         ORDER BY month DESC`,
      )
      .all(...params) as Array<{ month: string; total_minor: number }>;

    // By merchant (top 10)
    const byMerchant = db
      .prepare(
        `SELECT t.merchant,
                SUM(t.amount_minor) AS total_minor,
                COUNT(*) AS cnt
         FROM transactions t ${spendWhere}
         GROUP BY t.merchant
         ORDER BY total_minor DESC
         LIMIT 10`,
      )
      .all(...params) as Array<{ merchant: string; total_minor: number; cnt: number }>;

    return c.json({
      spendMinor: spendRow.spend_minor,
      byCategory: byCategory.map((r) => ({
        categoryId: r.categoryId,
        name: r.name,
        color: r.color,
        totalMinor: r.total_minor,
      })),
      byMonth: byMonth.map((r) => ({ month: r.month, totalMinor: r.total_minor })),
      byMerchant: byMerchant.map((r) => ({
        merchant: r.merchant,
        totalMinor: r.total_minor,
        count: r.cnt,
      })),
    });
  });

  // ── Categories: GET /categories ──
  app.get('/categories', (c) => {
    const userId = c.get('user').id;
    ensureDefaultCategories(db, userId);
    const rows = db
      .prepare('SELECT id, name, color FROM categories WHERE user_id = ? ORDER BY name')
      .all(userId) as Array<{ id: string; name: string; color: string }>;
    return c.json(rows);
  });

  // ── Categories: POST /categories ──
  app.post('/categories', async (c) => {
    const userId = c.get('user').id;
    const body: { name?: string; color?: string } = await c.req.json();

    if (!body.name || body.name.length < 1 || body.name.length > 40) {
      return c.json({ error: 'invalid', field: 'name' }, 400);
    }

    const color = body.color ?? '#64748b';
    if (body.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return c.json({ error: 'invalid', field: 'color' }, 400);
    }

    try {
      const result = db
        .prepare('INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)')
        .run(crypto.randomUUID(), userId, body.name, color);

      return c.json({ id: String(result.lastInsertRowid) }, 201);
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        return c.json({ error: 'exists' }, 409);
      }
      throw err;
    }
  });

  // ── Categories: DELETE /categories/:id ──
  app.delete('/categories/:id', (c) => {
    const userId = c.get('user').id;
    const catId = c.req.param('id');
    const result = db
      .prepare('DELETE FROM categories WHERE id = ? AND user_id = ?')
      .run(catId, userId);
    if (result.changes === 0) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  // ── GET / (list) ──
  app.get('/', (c) => {
    const userId = c.get('user').id;
    const from = c.req.query('from');
    const to = c.req.query('to');
    const accountId = c.req.query('accountId');
    const categoryId = c.req.query('categoryId');
    const q = c.req.query('q');
    const kind = c.req.query('kind');
    const source = c.req.query('source');
    let limit = parseInt(c.req.query('limit') ?? '100', 10);
    let offset = parseInt(c.req.query('offset') ?? '0', 10);
    if (isNaN(limit)) limit = 100;
    if (isNaN(offset)) offset = 0;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    if (limit < 0) limit = 0;
    if (offset < 0) offset = 0;

    const conditions: string[] = [`t.user_id = ?`, 't.deleted_at IS NULL'];
    const params: (string | number)[] = [userId];

    if (from) {
      conditions.push('t.txn_date >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('t.txn_date <= ?');
      params.push(to);
    }
    if (accountId) {
      conditions.push('t.account_id = ?');
      params.push(accountId);
    }
    if (categoryId && categoryId !== 'none') {
      conditions.push('t.category_id = ?');
      params.push(categoryId);
    } else if (categoryId === 'none') {
      conditions.push("t.category_id IS NULL AND t.kind NOT IN ('payment', 'credit')");
    }
    if (q) {
      const escaped = escapeLike(q);
      conditions.push(
        '(LOWER(t.merchant) LIKE LOWER(?) OR LOWER(t.description) LIKE LOWER(?))',
      );
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (kind) {
      const kinds = kind.split(',').map((k) => k.trim());
      const placeholders = kinds.map(() => '?').join(', ');
      conditions.push(`t.kind IN (${placeholders})`);
      params.push(...kinds);
    }
    if (source) {
      conditions.push('t.source = ?');
      params.push(source);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = db
      .prepare(`SELECT COUNT(*) AS cnt FROM transactions t ${where}`)
      .get(...params) as { cnt: number };

    const rows = db
      .prepare(
        `SELECT t.id, t.txn_date AS txnDate, t.description, t.merchant, t.amount_minor AS amountMinor,
                t.kind, t.source,
                t.account_id AS accountId, a.name AS accountName, a.bank, a.last4,
                t.category_id AS categoryId, c.name AS categoryName,
                t.notes, t.payment_method AS paymentMethod,
                t.fx_amount_minor AS fxAmountMinor, t.fx_currency AS fxCurrency,
                t.instalment_seq AS instalmentSeq,
                (SELECT COUNT(*)
                 FROM transactions t2
                 WHERE t2.user_id = t.user_id
                   AND t2.merchant = t.merchant
                   AND t2.deleted_at IS NULL
                   AND t2.kind NOT IN ('payment', 'credit')) AS merchantCount
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         ${where}
         ORDER BY t.txn_date DESC, t.created_at DESC, t.id
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<{
        id: string;
        txnDate: string;
        description: string;
        merchant: string;
        amountMinor: number;
        kind: string;
        source: string;
        accountId: string | null;
        accountName: string | null;
        bank: string | null;
        last4: string | null;
        categoryId: string | null;
        categoryName: string | null;
        notes: string | null;
        paymentMethod: string | null;
        fxAmountMinor: number | null;
        fxCurrency: string | null;
        instalmentSeq: string | null;
        merchantCount: number;
      }>;

    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        txnDate: r.txnDate,
        description: r.description,
        merchant: r.merchant,
        amountMinor: r.amountMinor,
        kind: r.kind,
        source: r.source,
        accountId: r.accountId,
        accountName: r.accountName,
        bank: r.bank,
        last4: r.last4,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        notes: r.notes,
        paymentMethod: r.paymentMethod,
        fxAmountMinor: r.fxAmountMinor,
        fxCurrency: r.fxCurrency,
        instalmentSeq: r.instalmentSeq,
        merchantCount: r.merchantCount,
      })),
      total: total.cnt,
    });
  });

  // ── POST / (manual entry) ──
  app.post('/', async (c) => {
    const userId = c.get('user').id;
    const body: {
      txnDate?: string;
      merchant?: string;
      amountMinor?: number;
      accountId?: string;
      categoryId?: string;
      notes?: string;
      paymentMethod?: string;
    } = await c.req.json();

    // Validate txnDate
    if (!body.txnDate || !isValidDate(body.txnDate)) {
      return c.json({ error: 'invalid', field: 'txnDate' }, 400);
    }

    // Validate merchant
    if (!body.merchant || body.merchant.length < 1 || body.merchant.length > 120) {
      return c.json({ error: 'invalid', field: 'merchant' }, 400);
    }

    // Validate amountMinor
    if (body.amountMinor === undefined || !Number.isInteger(body.amountMinor) || body.amountMinor <= 0) {
      return c.json({ error: 'invalid', field: 'amountMinor' }, 400);
    }

    // Validate accountId (optional, must belong to user)
    if (body.accountId) {
      const acc = db
        .prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?')
        .get(body.accountId, userId);
      if (!acc) {
        return c.json({ error: 'invalid', field: 'accountId' }, 400);
      }
    }

    // Validate categoryId (optional, must belong to user)
    if (body.categoryId) {
      const cat = db
        .prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
        .get(body.categoryId, userId);
      if (!cat) {
        return c.json({ error: 'invalid', field: 'categoryId' }, 400);
      }
    }

    // Validate notes (optional, <=500)
    if (body.notes !== undefined && body.notes.length > 500) {
      return c.json({ error: 'invalid', field: 'notes' }, 400);
    }

    // Validate paymentMethod (optional, <=40)
    if (body.paymentMethod !== undefined && body.paymentMethod.length > 40) {
      return c.json({ error: 'invalid', field: 'paymentMethod' }, 400);
    }

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO transactions (id, user_id, account_id, document_id, source, txn_date, description, merchant,
         amount_minor, kind, occurrence, dedupe_key, category_id, notes, payment_method, deleted_at, created_at)
       VALUES (?, ?, ?, NULL, 'manual', ?, ?, ?, ?, 'purchase', 1, NULL, ?, ?, NULL, NULL, ?)`,
    ).run(
      id,
      userId,
      body.accountId ?? null,
      body.txnDate,
      body.merchant,
      body.merchant, // description = merchant
      body.amountMinor,
      body.categoryId ?? null,
      body.notes ?? null,
      Date.now(),
    );

    return c.json({ id }, 201);
  });

  // ── PATCH /:id ──
  app.patch('/:id', async (c) => {
    const userId = c.get('user').id;
    const txnId = c.req.param('id');
    const body: {
      categoryId?: string | null;
      applyToMerchant?: boolean;
      saveRule?: boolean;
      notes?: string | null;
      paymentMethod?: string | null;
      merchant?: string;
      amountMinor?: number;
      txnDate?: string;
    } = await c.req.json();

    // Check transaction exists and belongs to user
    const txn = db
      .prepare(
        'SELECT id, source, merchant, kind FROM transactions WHERE id = ? AND user_id = ?',
      )
      .get(txnId, userId) as { id: string; source: string; merchant: string; kind: string } | undefined;

    if (!txn) {
      return c.json({ error: 'not_found' }, 404);
    }

    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    // Validate categoryId if provided
    if (body.categoryId !== undefined) {
      if (body.categoryId === null) {
        updates.push('category_id = NULL');
      } else {
        const cat = db
          .prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
          .get(body.categoryId, userId);
        if (!cat) {
          return c.json({ error: 'invalid', field: 'categoryId' }, 400);
        }
        updates.push('category_id = ?');
        params.push(body.categoryId);
      }
    }

    // Validate notes if provided
    if (body.notes !== undefined) {
      if (body.notes === null) {
        updates.push('notes = NULL');
      } else if (body.notes.length > 500) {
        return c.json({ error: 'invalid', field: 'notes' }, 400);
      } else {
        updates.push('notes = ?');
        params.push(body.notes);
      }
    }

    // Validate paymentMethod if provided
    if (body.paymentMethod !== undefined) {
      if (body.paymentMethod === null) {
        updates.push('payment_method = NULL');
      } else if (body.paymentMethod.length > 40) {
        return c.json({ error: 'invalid', field: 'paymentMethod' }, 400);
      } else {
        updates.push('payment_method = ?');
        params.push(body.paymentMethod);
      }
    }

    // merchant: only for manual rows
    if (body.merchant !== undefined) {
      if (txn.source !== 'manual') {
        return c.json({ error: 'invalid', field: 'merchant' }, 400);
      }
      if (body.merchant.length < 1 || body.merchant.length > 120) {
        return c.json({ error: 'invalid', field: 'merchant' }, 400);
      }
      updates.push('merchant = ?', 'description = ?');
      params.push(body.merchant, body.merchant);
    }

    // amountMinor: only for manual rows
    if (body.amountMinor !== undefined) {
      if (txn.source !== 'manual') {
        return c.json({ error: 'invalid', field: 'amountMinor' }, 400);
      }
      if (!Number.isInteger(body.amountMinor) || body.amountMinor <= 0) {
        return c.json({ error: 'invalid', field: 'amountMinor' }, 400);
      }
      updates.push('amount_minor = ?');
      params.push(body.amountMinor);
    }

    // txnDate: only for manual rows
    if (body.txnDate !== undefined) {
      if (txn.source !== 'manual') {
        return c.json({ error: 'invalid', field: 'txnDate' }, 400);
      }
      if (!isValidDate(body.txnDate)) {
        return c.json({ error: 'invalid', field: 'txnDate' }, 400);
      }
      updates.push('txn_date = ?');
      params.push(body.txnDate);
    }

    if (updates.length === 0) {
      return c.json({ ok: true });
    }

    // Apply the category to every other transaction from the same merchant (this user only)
    let updated = 1;
    if (body.applyToMerchant === true && body.categoryId !== undefined) {
      const r = db
        .prepare(
          'UPDATE transactions SET category_id = ? WHERE user_id = ? AND merchant = ? AND deleted_at IS NULL AND id != ? AND kind NOT IN (\'payment\', \'credit\')',
        )
        .run(body.categoryId, userId, txn.merchant, txnId);
      updated += r.changes;
    }

    let ruleSaved = false;
    const isSpendRow = txn.kind !== 'payment' && txn.kind !== 'credit';
    if (body.categoryId !== undefined && isSpendRow) {
      if (body.categoryId !== null && body.saveRule !== false) {
        upsertMerchantRule(db, userId, txn.merchant, body.categoryId);
        ruleSaved = true;
      } else if (body.categoryId === null && (body.applyToMerchant === true || body.saveRule === true)) {
        deleteMerchantRule(db, userId, txn.merchant);
      }
    }

    params.push(txnId, userId);
    db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(
      ...params,
    );

    return c.json({ ok: true, updated, ruleSaved });
  });

  // ── DELETE /:id ──
  app.delete('/:id', (c) => {
    const userId = c.get('user').id;
    const txnId = c.req.param('id');

    const txn = db
      .prepare(
        'SELECT id, source FROM transactions WHERE id = ? AND user_id = ?',
      )
      .get(txnId, userId) as { id: string; source: string } | undefined;

    if (!txn) {
      return c.json({ error: 'not_found' }, 404);
    }

    if (txn.source === 'manual') {
      db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(txnId, userId);
    } else {
      // PDF rows: soft delete
      db.prepare(
        'UPDATE transactions SET deleted_at = ? WHERE id = ? AND user_id = ?',
      ).run(Date.now(), txnId, userId);
    }

    return c.body(null, 204);
  });

  return app;
}
