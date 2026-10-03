import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatPeso } from '@/lib/api';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

/* ── helpers ─────────────────────────────────────────────────────── */

function monthOptions(): { label: string; value: string }[] {
  const now = new Date();
  const months: { label: string; value: string }[] = [
    { label: 'All time', value: 'all' },
  ];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    months.push({ label: `${y}-${m}`, value: `${y}-${m}` });
  }
  return months;
}

function monthToRange(value: string): { from?: string; to?: string } {
  if (value === 'all') return {};
  const [y, m] = value.split('-');
  if (!y || !m) return {};
  const first = `${y}-${m}-01`;
  const lastDay = new Date(Number(y), Number(m), 0).getDate();
  const last = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
  return { from: first, to: last };
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-');
  if (!y || !m) return month;
  const d = new Date(Number(y), Number(m) - 1, 1);
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortYear = String(Number(y)).slice(-2);
  return `${shortMonths[d.getMonth()]} ${shortYear}`;
}

function formatTooltip(value: number): string {
  return formatPeso(value * 100);
}

/* ── component ───────────────────────────────────────────────────── */

export default function Dashboard() {
  const [selectedMonth, setSelectedMonth] = useState('all');

  const range = useMemo(() => monthToRange(selectedMonth), [selectedMonth]);

  const { data, isLoading } = useQuery({
    queryKey: ['summary', selectedMonth],
    queryFn: () => api.summary(range),
  });

  /* ── empty state ───────────────────────────────────────────────── */

  if (!isLoading && data && data.spendMinor === 0 && data.byCategory.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <MonthSelector value={selectedMonth} onValueChange={setSelectedMonth} />
        </div>
        <Card>
          <CardContent className="flex h-40 items-center justify-center text-muted-foreground">
            No data for this period. Upload a statement to get started.
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ── loading state ─────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle><Skeleton className="h-5 w-24" /></CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-40" />
              <Skeleton className="mt-2 h-4 w-48" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle><Skeleton className="h-5 w-20" /></CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[220px] w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle><Skeleton className="h-5 w-28" /></CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[220px] w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle><Skeleton className="h-5 w-32" /></CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  /* ── content ───────────────────────────────────────────────────── */

  const summary = data!;
  const sortedByMonth = useMemo(
    () => [...summary.byMonth].sort((a, b) => a.month.localeCompare(b.month)),
    [summary.byMonth],
  );

  const totalSpend = summary.spendMinor;
  const activeCategories = summary.byCategory.filter((c) => c.totalMinor > 0);
  const topMerchants = [...summary.byMerchant].slice(0, 10);

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <MonthSelector value={selectedMonth} onValueChange={setSelectedMonth} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Total spend */}
        <Card>
          <CardHeader>
            <CardTitle>Total spend</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-3xl font-bold">{formatPeso(totalSpend)}</div>
            <CardDescription>
              {selectedMonth === 'all'
                ? 'All time'
                : `From ${range.from} to ${range.to}`}{' '}
              · Payments are excluded
            </CardDescription>
          </CardContent>
        </Card>

        {/* By month */}
        <Card>
          <CardHeader>
            <CardTitle>By month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sortedByMonth}>
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 12, fill: 'var(--muted-foreground, #6b7280)' }}
                    tickFormatter={(val: string) => formatMonthLabel(val)}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) => formatPeso(Math.round(v * 100))}
                  />
                  <Tooltip formatter={(value) => formatTooltip(Number(value ?? 0))} />
                  <Bar dataKey="totalMinor" fill="var(--foreground, #0f172a)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* By category */}
        <Card>
          <CardHeader>
            <CardTitle>By category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="h-[220px] w-full md:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={activeCategories}
                      dataKey="totalMinor"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {activeCategories.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto md:w-1/2">
                {activeCategories.map((cat) => {
                  const pct =
                    totalSpend > 0
                      ? ((cat.totalMinor / totalSpend) * 100).toFixed(1)
                      : '0.0';
                  return (
                    <div key={cat.categoryId ?? 'none'} className="flex items-center gap-2 text-sm">
                      <span
                        className="inline-block size-3 shrink-0 rounded-sm"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="flex-1 truncate">{cat.name}</span>
                      <span className="tabular-nums">{formatPeso(cat.totalMinor)}</span>
                      <span className="tabular-nums text-muted-foreground">({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top merchants */}
        <Card>
          <CardHeader>
            <CardTitle>Top merchants</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topMerchants.map((m) => (
                <div
                  key={m.merchant}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.merchant}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.count} txn{m.count !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="ml-4 tabular-nums">
                    {formatPeso(m.totalMinor)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ── month selector (reusable) ───────────────────────────────────── */

function MonthSelector({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v ?? 'all')}>
      <SelectTrigger className="w-[140px]">
        <SelectValue placeholder="Month" />
      </SelectTrigger>
      <SelectContent>
        {monthOptions().map((mo) => (
          <SelectItem key={mo.value} value={mo.value}>
            {mo.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
