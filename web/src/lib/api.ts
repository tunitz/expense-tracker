export class ApiError extends Error {
  status: number;
  code: string;
  data: unknown;

  constructor(status: number, code: string, data: unknown, message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

type JsonBody = Record<string, unknown> | undefined;

async function request<T>(
  method: string,
  path: string,
  body?: JsonBody,
): Promise<T> {
  const opts: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const raw: Record<string, unknown> = await res.json().catch(() => ({}));
    const code =
      typeof raw.error === 'string'
        ? raw.error
        : `http_${res.status}`;
    throw new ApiError(res.status, code, raw);
  }
  return res.json() as T;
}

// ── Types ──────────────────────────────────────────────────────────

export type User = {
  id: string;
  email: string;
};

export type Txn = {
  id: string;
  txnDate: string;
  description: string;
  merchant: string;
  amountMinor: number;
  kind: string;
  source: 'pdf' | 'manual';
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
  merchantCount?: number;
};

export type Category = {
  id: string;
  name: string;
  color: string;
};

export type DocumentRow = {
  id: string;
  bank: string;
  accountLast4: string;
  statementDate: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  version: number;
  uploadedAt: number;
  filename: string;
  txnCount: number;
};

export type Summary = {
  spendMinor: number;
  byCategory: {
    categoryId: string | null;
    name: string;
    color: string;
    totalMinor: number;
  }[];
  byMonth: { month: string; totalMinor: number }[];
  byMerchant: {
    merchant: string;
    totalMinor: number;
    count: number;
  }[];
};

export type TxnQuery = {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  q?: string;
  kind?: string;
  source?: string;
  limit?: number;
  offset?: number;
};

export type UploadResult = {
  documentId: string;
  bank: string;
  accountLast4: string;
  status: string;
  version: number;
  added: number;
  skipped: number;
  warnings: string[];
};

// ── API object ─────────────────────────────────────────────────────

export const api = {
  async me(): Promise<User> {
    return request<User>('GET', '/api/me');
  },

  async register(email: string, password: string) {
    return request<void>('POST', '/api/auth/register', { email, password });
  },

  async login(email: string, password: string) {
    return request<void>('POST', '/api/auth/login', { email, password });
  },

  async logout() {
    return request<void>('POST', '/api/auth/logout');
  },

  async listTxns(q: TxnQuery): Promise<{ items: Txn[]; total: number }> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(q)) {
      if (value !== undefined && value !== '') {
        params.append(key, String(value));
      }
    }
    return request<{ items: Txn[]; total: number }>(
      'GET',
      `/api/private/transactions?${params}`,
    );
  },

  async createTxn(input: {
    txnDate: string;
    merchant: string;
    amountMinor: number;
    accountId?: string;
    categoryId?: string;
    notes?: string;
    paymentMethod?: string;
  }): Promise<{ id: string }> {
    return request<{ id: string }>('POST', '/api/private/transactions', input);
  },

  async patchTxn(
    id: string,
    patch: Partial<{
      categoryId: string | null;
      applyToMerchant: boolean;
      saveRule: boolean;
      notes: string | null;
      paymentMethod: string | null;
      merchant: string;
      amountMinor: number;
      txnDate: string;
    }>,
  ) {
    return request<{ ok: boolean; updated?: number; ruleSaved?: boolean }>(
      `PATCH`,
      `/api/private/transactions/${id}`,
      patch,
    );
  },

  async deleteTxn(id: string) {
    return request<void>(`DELETE`, `/api/private/transactions/${id}`);
  },

  async summary(q: { from?: string; to?: string; accountId?: string }): Promise<Summary> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(q)) {
      if (value !== undefined && value !== '') {
        params.append(key, String(value));
      }
    }
    return request<Summary>(`GET`, `/api/private/transactions/summary?${params}`);
  },

  async listCategories(): Promise<Category[]> {
    return request<Category[]>(`GET`, '/api/private/transactions/categories');
  },

  async createCategory(name: string, color?: string) {
    return request<void>(
      `POST`,
      '/api/private/transactions/categories',
      { name, color },
    );
  },

  async deleteCategory(id: string) {
    return request<void>(`DELETE`, `/api/private/transactions/categories/${id}`);
  },

  async listDocuments(): Promise<DocumentRow[]> {
    return request<DocumentRow[]>(`GET`, '/api/private/documents');
  },

  async deleteDocument(id: string) {
    return request<void>(`DELETE`, `/api/private/documents/${id}`);
  },

  async recategorizeDocument(id: string) {
    return request<{ updated: number; remaining: number }>(`POST`, `/api/private/documents/${id}/recategorize`);
  },

  async uploadDocument(
    file: File,
    password?: string,
  ): Promise<UploadResult> {
    const fd = new FormData();
    fd.append('file', file);
    if (password !== undefined) {
      fd.append('password', password);
    }
    const res = await fetch('/api/private/documents', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    if (!res.ok) {
      const raw: Record<string, unknown> = await res.json().catch(() => ({}));
      const code =
        typeof raw.error === 'string'
          ? raw.error
          : `http_${res.status}`;
      throw new ApiError(res.status, code, raw);
    }
    return res.json() as Promise<UploadResult>;
  },
};

// ── Helpers ────────────────────────────────────────────────────────

export function formatPeso(minor: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(minor / 100);
}

export function formatFx(minor: number, currency: string): string {
  const amount = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
  return `${currency} ${amount}`;
}
