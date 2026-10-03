"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { api, formatPeso } from "@/lib/api";
import type { Txn, TxnQuery, Category } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TransactionForm } from "@/components/TransactionForm";
import { MoreHorizontal, Trash2 } from "lucide-react";

/* ── helpers ─────────────────────────────────────────────────────── */

function monthOptions(): { label: string; value: string }[] {
  const now = new Date();
  const months: { label: string; value: string }[] = [
    { label: "All time", value: "all" },
  ];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    months.push({ label: `${y}-${m}`, value: `${y}-${m}` });
  }
  return months;
}

function monthToRange(value: string): { from?: string; to?: string } {
  if (value === "all") return {};
  const [y, m] = value.split("-");
  if (!y || !m) return {};
  const first = `${y}-${m}-01`;
  const lastDay = new Date(Number(y), Number(m), 0).getDate();
  const last = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
  return { from: first, to: last };
}

/* ── component ───────────────────────────────────────────────────── */

export default function Transactions() {
  const queryClient = useQueryClient();

  /* filter state */
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSource, setSelectedSource] = useState("all");

  /* pagination */
  const [page, setPage] = useState(0);

  /* dialog */
  const [formOpen, setFormOpen] = useState(false);

  /* categories list */
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: api.listCategories,
  });

  /* debounce search */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  /* reset page when filters change */
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, selectedMonth, selectedCategory, selectedSource]);

  /* derived query params */
  const filters = useMemo<TxnQuery>(() => {
    const range = monthToRange(selectedMonth);
    const q: TxnQuery = {
      ...range,
      limit: 50,
      offset: page * 50,
    };
    if (debouncedSearch) q.q = debouncedSearch;
    if (selectedCategory !== "all")
      q.categoryId = selectedCategory === "none" ? "" : selectedCategory;
    if (selectedSource !== "all") q.source = selectedSource;
    return q;
  }, [debouncedSearch, selectedMonth, selectedCategory, selectedSource, page]);

  /* transactions query */
  const { data, isLoading } = useQuery({
    queryKey: ["txns", filters, page],
    queryFn: () => api.listTxns(filters),
    placeholderData: keepPreviousData,
  });

  /* delete mutation */
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteTxn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["txns"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  /* inline category update */
  const categoryMutation = useMutation({
    mutationFn: ({
      id,
      categoryId,
    }: {
      id: string;
      categoryId: string | null;
    }) => api.patchTxn(id, { categoryId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["txns"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  /* ── render ────────────────────────────────────────────────────── */

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
        <Button onClick={() => setFormOpen(true)}>Add expense</Button>
      </div>

      {/* filter bar */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search merchant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[180px] flex-1 sm:flex-none sm:max-w-[280px]"
        />

        <Select
          value={selectedMonth}
          onValueChange={(v) => setSelectedMonth(v ?? "all")}
        >
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

        <Select
          value={selectedCategory}
          onValueChange={(v) => setSelectedCategory(v ?? "all")}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="none">Uncategorized</SelectItem>
            {categories?.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedSource}
          onValueChange={(v) => setSelectedSource(v ?? "all")}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pdf">Statement</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* table */}
      <div className="relative w-full overflow-x-auto rounded-lg border">
        {isLoading && page === 0 ? (
          /* skeleton rows */
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead className="hidden sm:table-cell">Category</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="w-[48px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-4" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : data?.items.length === 0 ? (
          /* empty state */
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            No transactions yet. Upload a statement or add an expense.
          </div>
        ) : (
          <Table>
            <TableCaption>
              {data && `Total: ${data.total} transaction${data.total !== 1 ? "s" : ""}`}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead className="hidden sm:table-cell">Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-[48px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((txn) => (
                <TransactionRow
                  key={txn.id}
                  txn={txn}
                  categories={categories ?? []}
                  onCategoryChange={(categoryId: string | null) =>
                    categoryMutation.mutate({ id: txn.id, categoryId })
                  }
                  onDelete={() => {
                    if (window.confirm("Delete this transaction?")) {
                      deleteMutation.mutate(txn.id);
                    }
                  }}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* pagination footer */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing{" "}
            {page * 50 + 1}–{Math.min((page + 1) * 50, data.total)} of{" "}
            {data.total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * 50 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* add-expense dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add expense</DialogTitle>
          </DialogHeader>
          <TransactionForm
            open={formOpen}
            onOpenChange={setFormOpen}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["txns"] });
              queryClient.invalidateQueries({ queryKey: ["summary"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── row ─────────────────────────────────────────────────────────── */

function TransactionRow({
  txn,
  categories,
  onCategoryChange,
  onDelete,
}: {
  txn: Txn;
  categories: Category[];
  onCategoryChange: (categoryId: string | null) => void;
  onDelete: () => void;
}) {
  const isPaymentOrCredit = txn.kind === "payment" || txn.kind === "credit";
  const isNegative = txn.amountMinor < 0;
  const showGreen = isPaymentOrCredit || isNegative;

  const instalmentLabel = txn.instalmentSeq
    ? `Inst ${txn.instalmentSeq}`
    : null;

  /* inline category select value */
  const catValue =
    txn.categoryId ?? "none";

  return (
    <TableRow>
      {/* Date */}
      <TableCell className="whitespace-nowrap">
        {new Date(txn.txnDate + "T00:00:00").toLocaleDateString("en-PH", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </TableCell>

      {/* Merchant */}
      <TableCell>
        <div className="font-medium">{txn.merchant || txn.description}</div>
        <div className="text-xs text-muted-foreground">
          {txn.bank && (
            <>
              {txn.bank.toUpperCase()}
              {txn.last4 && ` •••• ${txn.last4}`}
            </>
          )}
          {txn.fxCurrency && txn.fxAmountMinor != null && txn.bank && (
            <span className="ml-1">
              {txn.fxCurrency}{" "}
              {formatPeso(txn.fxAmountMinor).replace("PHP", "").trim()}
            </span>
          )}
          {!txn.bank && txn.fxCurrency && txn.fxAmountMinor != null && (
            <span>
              {txn.fxCurrency}{" "}
              {formatPeso(txn.fxAmountMinor).replace("PHP", "").trim()}
            </span>
          )}
          {instalmentLabel && (
            <Badge variant="outline" className="ml-1 text-[10px] h-4">
              {instalmentLabel}
            </Badge>
          )}
        </div>
      </TableCell>

      {/* Category (hidden on narrow) */}
      <TableCell className="hidden sm:table-cell">
        <Select
          value={catValue}
          onValueChange={(v: string | null) => {
            onCategoryChange(v === "none" ? null : v);
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Uncategorized</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Amount */}
      <TableCell className="text-right tabular-nums whitespace-nowrap">
        <div
          className={
            showGreen
              ? "text-green-600 dark:text-green-400"
              : ""
          }
        >
          {formatPeso(Math.abs(txn.amountMinor))}
          {showGreen && (
            <Badge variant="outline" className="ml-1.5 text-[10px] h-4">
              {txn.kind}
            </Badge>
          )}
        </div>
      </TableCell>

      {/* Actions */}
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="ghost" size="icon-sm">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
