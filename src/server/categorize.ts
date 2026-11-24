import type { Database } from './db';

export const DEFAULT_CATEGORIES: { name: string; color: string }[] = [
  { name: 'Food', color: '#f97316' },
  { name: 'Transport', color: '#0ea5e9' },
  { name: 'Shopping', color: '#a855f7' },
  { name: 'Bills', color: '#eab308' },
  { name: 'Subscriptions', color: '#6366f1' },
  { name: 'Entertainment', color: '#ec4899' },
  { name: 'Health', color: '#10b981' },
  { name: 'Fees & Interest', color: '#ef4444' },
  { name: 'Installments', color: '#14b8a6' },
  { name: 'Others', color: '#78716c' },
];

export const FALLBACK_CATEGORY = 'Others';
export const INSTALLMENTS_CATEGORY = 'Installments';

// First match wins, so more specific entries come before broad ones.
const RULES: { category: string; keywords: string[]; prefixes?: string[] }[] = [
  {
    category: 'Subscriptions',
    keywords: [
      'anthropic', 'claude', 'openai', 'chatgpt', 'deepseek', 'deepseerwea', 'xiaomi mimo',
      'commandcode', 'opencode',
      'digitalocea', 'cloudflare', 'openrouter', 'github', 'netflix', 'spotify', 'youtube', 'google *', 'icloud',
      'apple.com/bill', 'itunes', 'cursor', 'midjourney', 'notion', 'dropbox', 'adobe',
    ],
  },
  { category: 'Bills', keywords: ['pldt', 'meralco', 'globe', 'smart comm', 'converge', 'water district', 'bills payment', 'dito'] },
  { category: 'Entertainment', keywords: ['steam', 'playstation', 'nintendo', 'xbox', 'cinema', 'sm cinema', 'epic games', 'blizzard'] },
  {
    category: 'Transport',
    keywords: [
      'grab', 'move it', 'moveit', 'maxim', 'angkas', 'joyride', 'lalamove',
      'petron', 'shell', 'caltex', 'phoenix',
      'oceanjet', 'cebu pacific', 'cebupacific', 'philippine airlines', 'airasia',
      'beep', 'toll', 'rfid',
    ],
  },
  {
    category: 'Food',
    keywords: [
      'jollibee', 'mcdonald', 'kfc', 'starbucks', 'chowking', 'greenwich', 'mang inasal',
      'kenny rogers', 'buffalobrad', 'buffalo brad', 'burger', 'pizza', 'foodpanda',
      '7-eleven', 'ministop', 'familymart', 'coffee',
      'bakery', 'restaurant', 'resto', 'cafe', 'milk tea', 'yellow cab', 'shakey', 'tokyo tokyo',
      'dunkin', 'ccf ', 'andoks', 'savemore', 'robinsons spmkt', 'supermarket', 'grocery',
    ],
  },
  {
    category: 'Health',
    keywords: ['pharmacy', 'watsons', 'mercury drug', 'southstar', 'south star', 'clinic', 'hospital', 'dental', 'medical', 'drugstore', 'generika'],
    prefixes: ['ssd '],
  },
  {
    category: 'Shopping',
    keywords: [
      'decathlon', 'skechers', 'aquaflask', 'temu', 'shopee', 'lazada', 'amazon', 'power mac', 'powermac', 'abenson',
      'mr diy', 'mr. diy', 'bench', 'uniqlo', 'h&m', 'zara', 'national book', 'sm dept',
      'robinsons', 'ace hardware', 'handyman', 'miniso', 'daiso', 'ikea', 'datablitz', 'western appliances',
    ],
  },
];

export function normalizeMerchantRulePattern(merchant: string): string {
  return merchant.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function categoryForTxn(t: { merchant: string; kind: string }): string | null {
  if (t.kind === 'payment' || t.kind === 'credit') return null;
  if (t.kind === 'instalment_interest' || t.kind === 'interest' || t.kind === 'fee') {
    return 'Fees & Interest';
  }
  const m = t.merchant.toLowerCase().trim();
  for (const rule of RULES) {
    if (rule.keywords.some((k) => m.includes(k))) return rule.category;
    if (rule.prefixes?.some((p) => m.startsWith(p))) return rule.category;
  }
  if (t.kind === 'instalment_principal') return INSTALLMENTS_CATEGORY;
  return FALLBACK_CATEGORY;
}

export function loadUserMerchantRules(db: Database, userId: string): Map<string, string> {
  const rows = db
    .query('SELECT pattern, category_id FROM merchant_rules WHERE user_id = ? ORDER BY priority ASC')
    .all(userId) as { pattern: string; category_id: string }[];
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.pattern, r.category_id);
  }
  return map;
}

export function upsertMerchantRule(
  db: Database,
  userId: string,
  merchant: string,
  categoryId: string,
): void {
  const pattern = normalizeMerchantRulePattern(merchant);
  if (!pattern) return;
  db.prepare(
    `INSERT INTO merchant_rules (id, user_id, pattern, category_id, priority)
     VALUES (?, ?, ?, ?, 10)
     ON CONFLICT(user_id, pattern) DO UPDATE SET
       category_id = excluded.category_id,
       priority = excluded.priority`,
  ).run(crypto.randomUUID(), userId, pattern, categoryId);
}

export function deleteMerchantRule(
  db: Database,
  userId: string,
  merchant: string,
): void {
  const pattern = normalizeMerchantRulePattern(merchant);
  if (!pattern) return;
  db.prepare('DELETE FROM merchant_rules WHERE user_id = ? AND pattern = ?').run(userId, pattern);
}

export function resolveCategoryIdForTxn(
  t: { merchant: string; kind: string },
  catIdsByName: Map<string, string>,
  userRules: Map<string, string>,
): string | null {
  if (t.kind === 'payment' || t.kind === 'credit') return null;
  const pattern = normalizeMerchantRulePattern(t.merchant);
  const userCatId = userRules.get(pattern);
  if (userCatId) return userCatId;
  const name = categoryForTxn(t);
  return (name ? catIdsByName.get(name) : undefined) ?? null;
}

/**
 * Seed the default categories once per user (only when they have none), then
 * backfill their uncategorized transactions. Never re-adds a deleted category.
 */
export function ensureDefaultCategories(db: Database, userId: string): void {
  const run = db.transaction(() => {
    const n = (db.query('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?').get(userId) as { n: number }).n;
    if (n > 0) return;
    const ins = db.prepare('INSERT INTO categories (id, user_id, name, color) VALUES (?, ?, ?, ?)');
    for (const c of DEFAULT_CATEGORIES) ins.run(crypto.randomUUID(), userId, c.name, c.color);
    applyCategoriesToUncategorized(db, userId);
  });
  run();
}

/**
 * Assign a category to uncategorized, fallback (Others), or default Installments
 * non-deleted spend transactions when user rules or built-in rules recognise them.
 * Never overwrites a specific category the user chose.
 */
export function applyCategoriesToUncategorized(db: Database, userId: string, documentId?: string): number {
  const cats = db.query('SELECT id, name FROM categories WHERE user_id = ?').all(userId) as { id: string; name: string }[];
  const byName = new Map(cats.map((c) => [c.name, c.id]));
  const userRules = loadUserMerchantRules(db, userId);

  const recheckIds: string[] = [];
  const othersId = byName.get(FALLBACK_CATEGORY);
  const installmentsId = byName.get(INSTALLMENTS_CATEGORY);
  if (othersId) recheckIds.push(othersId);
  if (installmentsId) recheckIds.push(installmentsId);

  const catClause =
    recheckIds.length > 0
      ? `(category_id IS NULL OR category_id IN (${recheckIds.map(() => '?').join(', ')}))`
      : 'category_id IS NULL';

  const params: string[] = [userId, ...recheckIds];
  let sql = `SELECT id, merchant, kind, category_id FROM transactions
             WHERE user_id = ? AND ${catClause}
               AND deleted_at IS NULL
               AND kind NOT IN ('payment', 'credit')`;
  if (documentId) {
    sql += ' AND document_id = ?';
    params.push(documentId);
  }

  const rows = db.query(sql).all(...params) as {
    id: string;
    merchant: string;
    kind: string;
    category_id: string | null;
  }[];

  const upd = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ? AND user_id = ?');
  let changed = 0;
  for (const r of rows) {
    const nextId = resolveCategoryIdForTxn(r, byName, userRules);
    if (nextId && nextId !== r.category_id) {
      upd.run(nextId, r.id, userId);
      changed++;
    }
  }
  return changed;
}
