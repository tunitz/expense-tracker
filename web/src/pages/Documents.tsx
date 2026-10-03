"use client";

import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DocumentRow } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadDialog } from "@/components/UploadDialog";
import { MoreHorizontal, Trash2 } from "lucide-react";

/* ── helpers ─────────────────────────────────────────────────────── */

function formatPeriod(start: string, end: string): string {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const sDate = parse(start);
  const eDate = parse(end);
  return `${sDate.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} – ${eDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}`;
}

function statusBadge(status: string): { label: string; variant: "default" | "destructive" | "secondary" } {
  switch (status) {
    case "needs_review":
      return { label: "Needs review", variant: "destructive" };
    case "superseded":
      return { label: "Superseded", variant: "secondary" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    default:
      return { label: "Parsed", variant: "default" };
  }
}

/* ── component ───────────────────────────────────────────────────── */

export default function Documents() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: api.listDocuments,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["txns"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Statements</h1>
        <Button onClick={() => setDialogOpen(true)}>Upload statement</Button>
      </div>

      {/* table */}
      <div className="relative w-full overflow-x-auto rounded-lg border">
        {isLoading ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank</TableHead>
                <TableHead className="hidden sm:table-cell">Period</TableHead>
                <TableHead className="hidden sm:table-cell">Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transactions</TableHead>
                <TableHead className="w-[48px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-1 h-3 w-24" />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Skeleton className="h-4 w-8" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-10" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-4" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : documents && documents.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            No statements uploaded yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank</TableHead>
                <TableHead className="hidden sm:table-cell">Period</TableHead>
                <TableHead className="hidden sm:table-cell">Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transactions</TableHead>
                <TableHead className="w-[48px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents?.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  onDelete={() => {
                    if (window.confirm("Delete this statement and its imported transactions?")) {
                      deleteMutation.mutate(doc.id);
                    }
                  }}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* upload dialog */}
      <UploadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ["documents"] });
          queryClient.invalidateQueries({ queryKey: ["txns"] });
          queryClient.invalidateQueries({ queryKey: ["summary"] });
        }}
      />
    </div>
  );
}

/* ── row ─────────────────────────────────────────────────────────── */

function DocumentRow({
  doc,
  onDelete,
}: {
  doc: DocumentRow;
  onDelete: () => void;
}) {
  const sb = statusBadge(doc.status);

  return (
    <TableRow>
      {/* Bank */}
      <TableCell>
        <div className="font-medium">
          {doc.bank.toUpperCase()}
          {doc.accountLast4 && ` •••• ${doc.accountLast4}`}
        </div>
        <div className="text-xs text-muted-foreground">{doc.filename}</div>
      </TableCell>

      {/* Period (hidden below sm) */}
      <TableCell className="hidden sm:table-cell whitespace-nowrap">
        {formatPeriod(doc.periodStart, doc.periodEnd)}
      </TableCell>

      {/* Version (hidden below sm) */}
      <TableCell className="hidden sm:table-cell whitespace-nowrap">
        v{doc.version}
      </TableCell>

      {/* Status */}
      <TableCell>
        <Badge variant={sb.variant}>{sb.label}</Badge>
      </TableCell>

      {/* Transactions */}
      <TableCell className="whitespace-nowrap tabular-nums">
        {doc.txnCount}
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
