"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import { api, ApiError } from "@/lib/api";
import type { UploadResult } from "@/lib/api";

type Step = "pick" | "uploading" | "password" | "done" | "error";

export function UploadDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (r: UploadResult) => void;
}) {
  const [step, setStep] = React.useState<Step>("pick");
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<UploadResult | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setStep("pick");
      setFile(null);
      setUploading(false);
      setPassword("");
      setError(null);
      setResult(null);
    }
  }, [open]);

  const handleDrop = React.useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const f = e.dataTransfer.files?.[0];
      if (f) setFile(f);
    },
    [],
  );

  const handleDragOver = React.useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
    },
    [],
  );

  const handleFileChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) setFile(f);
    },
    [],
  );

  const doUpload = React.useCallback(
    (pw?: string) => {
      if (!file) return;
      setUploading(true);
      setError(null);
      setStep("uploading");
      api
        .uploadDocument(file, pw)
        .then((r) => {
          setResult(r);
          setUploading(false);
          setStep("done");
        })
        .catch((err: unknown) => {
          setUploading(false);
          if (err instanceof ApiError) {
            if (err.status === 423 && err.code === "password_required") {
              setStep("password");
              if (err.data && (err.data as { wrong?: boolean }).wrong === true) {
                setError("Wrong password, try again");
              }
            } else {
              const msg =
                err.code === "already_uploaded"
                  ? "This statement was already uploaded"
                  : err.code === "not_pdf"
                    ? "That file is not a PDF"
                    : err.code === "too_large"
                      ? "File is over 15 MB"
                      : err.code === "too_many_pages"
                        ? "This PDF has too many pages (limit 50)"
                      : err.code === "unsupported_format"
                        ? "This bank/format is not supported yet"
                        : err.code === "unreadable"
                          ? "Could not read this PDF"
                          : "Upload failed";
              setError(msg);
              setStep("error");
            }
          }
        });
    },
    [file],
  );

  const handlePasswordSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      doUpload(password);
    },
    [password, doUpload],
  );

  const handleDone = React.useCallback(() => {
    onDone(result!);
    onOpenChange(false);
  }, [onDone, onOpenChange, result]);

  const handlePickUpload = React.useCallback(() => {
    doUpload();
  }, [doUpload]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[calc(100%-2rem)]">
        <DialogHeader>
          <DialogTitle>Upload Statement</DialogTitle>
          {step === "password" && (
            <DialogDescription>This PDF is password protected</DialogDescription>
          )}
          {step === "done" && result && (
            <DialogDescription>
              {result.added} new, {result.skipped} duplicates skipped
              <br />
              v{result.version}
              <br />
              {result.bank.toUpperCase()} •••• {result.accountLast4}
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "pick" && (
          <>
            <label
              htmlFor="upload-file-input"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-lg p-8 cursor-pointer hover:border-primary/50 transition-colors"
            >
              <span className="text-sm text-muted-foreground">
                Drag & drop a PDF here, or click to browse
              </span>
              <span className="text-xs text-muted-foreground mt-1">
                {file ? file.name : "Accepted: .pdf files only"}
              </span>
              <input
                ref={fileInputRef}
                id="upload-file-input"
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>
            <DialogFooter>
              <Button
                onClick={handlePickUpload}
                disabled={!file || uploading}
              >
                Upload
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "uploading" && (
          <DialogFooter>
            <Button disabled>Reading statement...</Button>
          </DialogFooter>
        )}

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pdf-password" className="text-sm">
                Password
              </Label>
              <Input
                id="pdf-password"
                name="pdf-password"
                type="password"
                autoComplete="off"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={uploading}>
                {uploading ? "Reading statement..." : "Submit"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "done" && result && (
          <>
            {result.warnings.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <strong>Needs review: totals do not reconcile</strong>
                  <ul className="list-disc list-inside mt-1">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button onClick={handleDone}>Done</Button>
            </DialogFooter>
          </>
        )}

        {step === "error" && (
          <>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button onClick={() => setStep("pick")}>Try again</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
