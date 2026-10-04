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
];

// First match wins, so more specific entries come before broad ones.
const RULES: { category: string; keywords: string[] }[] = [
  {
    category: 'Subscriptions',
    keywords: [
      'anthropic', 'claude', 'openai', 'chatgpt', 'deepseek', 'deepseerwea', 'xiaomi mimo',
      'digitalocea', 'cloudflare', 'openrouter', 'github', 'netflix', 'spotify', 'youtube', 'google *', 'icloud',
      'apple.com/bill', 'itunes', 'cursor', 'midjourney', 'notion', 'dropbox', 'adobe',
    ],
  },
  { category: 'Bills', keywords: ['pldt', 'meralco', 'globe', 'smart comm', 'converge', 'water district', 'bills payment', 'dito'] },
  { category: 'Entertainment', keywords: ['steam', 'playstation', 'nintendo', 'xbox', 'cinema', 'sm cinema', 'epic games', 'blizzard'] },
  { category: 'Transport', keywords: ['grab', 'angkas', 'joyride', 'lalamove', 'petron', 'shell', 'caltex', 'phoenix', 'cebu pacific', 'cebupacific', 'philippine airlines', 'airasia', 'beep', 'toll', 'rfid'] },
  {
    category: 'Food',
    keywords: [
      'jollibee', 'mcdonald', 'kfc', 'starbucks', 'chowking', 'greenwich', 'mang inasal',
      'burger king', 'pizza', 'foodpanda', '7-eleven', 'ministop', 'familymart', 'coffee',
      'bakery', 'restaurant', 'resto', 'cafe', 'milk tea', 'yellow cab', 'shakey', 'tokyo tokyo',
      'dunkin', 'ccf ', 'andoks', 'savemore', 'supermarket', 'grocery',
    ],
  },
  { category: 'Health', keywords: ['pharmacy', 'watsons', 'mercury drug', 'southstar', 'clinic', 'hospital', 'dental', 'medical', 'drugstore', 'generika'] },
  {
    category: 'Shopping',
    keywords: [
      'decathlon', 'skechers', 'aquaflask', 'temu', 'shopee', 'lazada', 'amazon', 'power mac', 'powermac', 'abenson',
      'mr diy', 'mr. diy', 'bench', 'uniqlo', 'h&m', 'zara', 'national book', 'sm dept',
      'robinsons', 'ace hardware', 'handyman', 'miniso', 'daiso', 'ikea', 'datablitz', 'western appliances',
    ],
  },
];

export function categoryForTxn(t: { merchant: string; kind: string }): string | null {
  if (t.kind === 'payment' || t.kind === 'credit') return null;
  if (t.kind === 'instalment_interest' || t.kind === 'interest' || t.kind === 'fee') {
    return 'Fees & Interest';
  }
  const m = t.merchant.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((k) => m.includes(k))) return rule.category;
  }
  return null;
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

/** Assign a category to every uncategorized, non-deleted transaction the rules recognise. */
export function applyCategoriesToUncategorized(db: Database, userId: string, documentId?: string): number {
  const cats = db.query('SELECT id, name FROM categories WHERE user_id = ?').all(userId) as { id: string; name: string }[];
  const byName = new Map(cats.map((c) => [c.name, c.id]));
  const rows = db
    .query(
      `SELECT id, merchant, kind FROM transactions WHERE user_id = ? AND category_id IS NULL AND deleted_at IS NULL${documentId ? ' AND document_id = ?' : ''}`,
    )
    .all(...(documentId ? [userId, documentId] : [userId])) as { id: string; merchant: string; kind: string }[];
  const upd = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ? AND user_id = ?');
  let changed = 0;
  for (const r of rows) {
    const name = categoryForTxn(r);
    const id = name ? byName.get(name) : undefined;
    if (id) {
      upd.run(id, r.id, userId);
      changed++;
    }
  }
  return changed;
}
