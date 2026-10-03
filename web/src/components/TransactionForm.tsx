"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui/alert";

function getLocalDate(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

const PAYMENT_METHODS = [
  { value: "Cash", label: "Cash" },
  { value: "Card", label: "Card" },
  { value: "GCash", label: "GCash" },
  { value: "Bank transfer", label: "Bank transfer" },
  { value: "Other", label: "Other" },
];

interface FormState {
  txnDate: string;
  merchant: string;
  amountRaw: string;
  categoryId: string | "none";
  paymentMethod: string | "none";
  notes: string;
}

export function TransactionForm({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>({
    txnDate: getLocalDate(),
    merchant: "",
    amountRaw: "",
    categoryId: "none",
    paymentMethod: "none",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  // Reset fields when dialog opens
  useEffect(() => {
    if (open) {
      setForm({
        txnDate: getLocalDate(),
        merchant: "",
        amountRaw: "",
        categoryId: "none",
        paymentMethod: "none",
        notes: "",
      });
      setError(null);
    }
  }, [open]);

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: api.listCategories,
  });

  const createMutation = useMutation({
    mutationFn: (input: {
      txnDate: string;
      merchant: string;
      amountMinor: number;
      categoryId?: string;
      paymentMethod?: string;
      notes?: string;
    }) => api.createTxn(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["txns"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      onSaved();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === "invalid") {
        const field = (err.data as Record<string, unknown>)?.field as
          | string
          | undefined;
        setError(field ? `Invalid ${field}` : "Could not save");
      } else {
        setError("Could not save");
      }
    },
  });

  const handleSave = () => {
    setError(null);

    const trimmed = form.merchant.trim();
    if (!trimmed) {
      setError("Enter a merchant");
      return;
    }

    const amountMinor = Math.round(
      parseFloat(form.amountRaw.replace(/,/g, "")) * 100
    );
    if (isNaN(amountMinor) || amountMinor <= 0) {
      setError("Enter an amount greater than 0");
      return;
    }

    const payload: {
      txnDate: string;
      merchant: string;
      amountMinor: number;
      categoryId?: string;
      paymentMethod?: string;
      notes?: string;
    } = {
      txnDate: form.txnDate,
      merchant: trimmed,
      amountMinor,
    };

    if (form.categoryId !== "none") {
      payload.categoryId = form.categoryId;
    }
    if (form.paymentMethod !== "none") {
      payload.paymentMethod = form.paymentMethod;
    }
    if (form.notes.trim()) {
      payload.notes = form.notes.trim();
    }

    createMutation.mutate(payload);
  };

  const isSubmitting = createMutation.isPending;

  const amountError =
    form.amountRaw !== "" &&
    (isNaN(parseFloat(form.amountRaw.replace(/,/g, ""))) ||
      Math.round(parseFloat(form.amountRaw.replace(/,/g, "")) * 100) <= 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="txnDate">Date</Label>
              <Input
                id="txnDate"
                type="date"
                value={form.txnDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, txnDate: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (₱)</Label>
              <Input
                id="amount"
                type="text"
                inputMode="decimal"
                placeholder="1,234.50"
                value={form.amountRaw}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amountRaw: e.target.value }))
                }
                aria-invalid={amountError}
              />
              {amountError && (
                <p className="text-sm text-destructive">
                  Enter an amount greater than 0
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="merchant">Merchant</Label>
            <Input
              id="merchant"
              type="text"
              required
              maxLength={120}
              placeholder="Merchant name"
              value={form.merchant}
              onChange={(e) =>
                setForm((f) => ({ ...f, merchant: e.target.value }))
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, categoryId: v as string | "none" }))
                }
              >
                <SelectTrigger id="category" className="w-full">
                  <SelectValue placeholder="Select">
                    {(v: string) => (v === "none" ? "Uncategorized" : (categories?.find((c) => c.id === v)?.name ?? v))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uncategorized</SelectItem>
                  {categories?.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Payment method</Label>
              <Select
                value={form.paymentMethod}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, paymentMethod: v as string | "none" }))
                }
              >
                <SelectTrigger id="paymentMethod" className="w-full">
                  <SelectValue placeholder="Select">
                    {(v: string) => (v === "none" ? "None" : (PAYMENT_METHODS.find((pm) => pm.value === v)?.label ?? v))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {PAYMENT_METHODS.map((pm) => (
                    <SelectItem key={pm.value} value={pm.value}>
                      {pm.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              maxLength={500}
              placeholder="Optional notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
