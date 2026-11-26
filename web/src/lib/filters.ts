export type TxnFilterState = {
  month: string;
  category: string;
  source: string;
  search: string;
  page: number;
};

export type TxnFilterQuery = {
  from?: string;
  to?: string;
  q?: string;
  categoryId?: string;
  source?: string;
  limit: number;
  offset: number;
};

function monthToRange(value: string): { from?: string; to?: string } {
  if (value === 'all') return {};
  const [y, m] = value.split('-');
  if (!y || !m) return {};
  const lastDay = new Date(Number(y), Number(m), 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
}

export function buildTxnQuery(s: TxnFilterState): TxnFilterQuery {
  const q: TxnFilterQuery = { ...monthToRange(s.month), limit: 50, offset: s.page * 50 };
  if (s.search) q.q = s.search;
  if (s.category !== 'all') q.categoryId = s.category;
  if (s.source !== 'all') q.source = s.source;
  return q;
}
