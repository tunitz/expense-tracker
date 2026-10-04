import type { Database } from './db';
import type { ParsedStatement } from './parsers/types';
import { categoryForTxn } from './categorize';

export type ImportResult = {
  documentId: string;
  accountId: string;
  status: 'parsed' | 'needs_review';
  version: number;
  added: number;
  skipped: number;
};

export class DuplicateDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateDocumentError';
  }
}

export function importStatement(
  db: Database,
  userId: string,
  st: ParsedStatement,
  meta: { sha256: string; filename: string; storedPath: string | null },
): ImportResult {
  const add = db.transaction(
    (userId: string, st: ParsedStatement, meta: { sha256: string; filename: string; storedPath: string | null }) => {
      // 1. Duplicate document check
      const existing = db
        .query('SELECT id FROM documents WHERE user_id = ? AND sha256 = ?')
        .get(userId, meta.sha256) as { id: string } | undefined;
      if (existing) throw new DuplicateDocumentError('already uploaded');

      // 2. Upsert account
      let acct = db
        .query('SELECT id FROM accounts WHERE user_id = ? AND bank = ? AND account_ref = ?')
        .get(userId, st.bank, st.accountRef) as { id: string } | undefined;
      if (!acct) {
        const id = crypto.randomUUID();
        db.run(
          'INSERT INTO accounts (id, user_id, bank, name, last4, account_ref) VALUES (?, ?, ?, ?, ?, ?)',
          [id, userId, st.bank, st.accountName, st.accountLast4, st.accountRef],
        );
        acct = { id };
      }
      const accountId = acct.id;

      // 3. Insert document
      const maxVersion = db
        .query(
          'SELECT MAX(version) AS maxVersion FROM documents WHERE account_id = ? AND period_end = ? AND user_id = ?',
        )
        .get(accountId, st.periodEnd, userId) as { maxVersion: number | null };
      const version = 1 + (maxVersion?.maxVersion ?? 0);

      const docId = crypto.randomUUID();
      const status: ImportResult['status'] = st.warnings.length ? 'needs_review' : 'parsed';
      db.run(
        'INSERT INTO documents (id, user_id, account_id, sha256, filename, statement_date, period_start, period_end, totals_json, status, version, supersedes_id, stored_path, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [docId, userId, accountId, meta.sha256, meta.filename, st.statementDate, st.periodStart, st.periodEnd, JSON.stringify(st.totals), status, version, null, meta.storedPath, Date.now()],
      );

      // 4. Import transactions
      let added = 0;
      let skipped = 0;

      const seen = new Map<string, number>();
      const insertTxnStmt = db.prepare(
        'INSERT INTO transactions (id, user_id, account_id, document_id, source, txn_date, posted_date, description, merchant, amount_minor, fx_amount_minor, fx_currency, kind, instalment_ref, instalment_seq, sub_account, occurrence, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const relinkTxnStmt = db.prepare('UPDATE transactions SET document_id = ? WHERE id = ?');
      const catIds = new Map(
        (db.query('SELECT id, name FROM categories WHERE user_id = ?').all(userId) as { id: string; name: string }[]).map((c) => [c.name, c.id]),
      );
      const setCatStmt = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');

      for (const t of st.txns) {
        const sub = t.subAccount ?? '';
        const key = [accountId, sub, t.txnDate, t.description, t.amountMinor, t.kind].join('|');
        const count = seen.get(key) ?? 0;
        seen.set(key, count + 1);
        const occurrence = count + 1;

        const hasher = new Bun.CryptoHasher('sha256');
        hasher.update([accountId, sub, t.txnDate, t.description, String(t.amountMinor), t.kind, String(occurrence)].join('|'));
        const dedupeKey = hasher.digest('hex');

        const existingTxn = db
          .query('SELECT id FROM transactions WHERE user_id = ? AND dedupe_key = ?')
          .get(userId, dedupeKey) as { id: string } | undefined;

        if (existingTxn) {
          skipped++;
          relinkTxnStmt.run(docId, existingTxn.id);
        } else {
          const txnId = crypto.randomUUID();
          insertTxnStmt.run(
            txnId,
            userId,
            accountId,
            docId,
            'pdf',
            t.txnDate,
            t.postedDate,
            t.description,
            t.merchant,
            t.amountMinor,
            t.fxAmountMinor,
            t.fxCurrency,
            t.kind,
            t.instalmentRef,
            t.instalmentSeq,
            t.subAccount,
            occurrence,
            dedupeKey,
            Date.now(),
          );
          const catName = categoryForTxn({ merchant: t.merchant, kind: t.kind });
          const catId = catName ? catIds.get(catName) : undefined;
          if (catId) setCatStmt.run(catId, txnId);
          added++;
        }
      }

      return { documentId: docId, accountId, status, version, added, skipped };
    },
  );

  return add(userId, st, meta);
}
