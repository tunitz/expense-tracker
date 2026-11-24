import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { AppEnv } from '../app';
import { applyCategoriesToUncategorized, ensureDefaultCategories } from '../categorize';
import { extractPages, PdfPasswordError, TooManyPagesError } from '../parsers/extract';
import { parseUnionBank } from '../parsers/unionbank';
import { parseBpi } from '../parsers/bpi';
import type { ParsedStatement } from '../parsers/types';
import { importStatement, DuplicateDocumentError } from '../import';

const MAX_SIZE = 15 * 1024 * 1024;

function detectBank(statement: ParsedStatement): 'unionbank' | 'bpi' {
  return statement.bank;
}

export function documentsRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // POST / — upload
  app.post('/', async (c) => {
    const userId = c.get('user').id;
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof Blob) || (file as File).size === 0) {
      return c.json({ error: 'no_file' }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    if (bytes.length > MAX_SIZE) {
      return c.json({ error: 'too_large' }, 413);
    }

    if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      return c.json({ error: 'not_pdf' }, 415);
    }

    const password = form.get('password');
    const pwd = typeof password === 'string' ? password : undefined;

    let pages;
    try {
      pages = await extractPages(bytes, pwd);
    } catch (err) {
      if (err instanceof TooManyPagesError) {
        return c.json({ error: 'too_many_pages' }, 413);
      }
      if (err instanceof PdfPasswordError) {
        return c.json({ error: 'password_required', wrong: err.wrong }, 423);
      }
      return c.json({ error: 'unreadable' }, 422);
    }

    // Join all page text for bank detection
    const allText = pages
      .flatMap((p) => p.rows.flatMap((r) => r.items.map((i) => i.s)))
      .join(' ');

    // Detect bank from pages text
    const isUnionBank =
      allText.includes('UnionBank') ||
      allText.includes('UNIONBANK') ||
      allText.includes('Rewards Platinum Visa') ||
      (allText.includes('Statement of Account') && allText.includes('Go Rewards'));

    let statement: ParsedStatement | null = null;
    if (isUnionBank) {
      try {
        statement = parseUnionBank(pages);
      } catch {
        // fall through to BPI
      }
    }
    if (!statement) {
      try {
        statement = parseBpi(pages);
      } catch (err) {
        console.error('Failed to parse statement:', err instanceof Error ? err.message : err);
        return c.json({ error: 'unsupported_format' }, 422);
      }
    }
    if (!statement) {
      return c.json({ error: 'unsupported_format' }, 422);
    }

    // SHA-256
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(bytes);
    const sha256 = hasher.digest('hex');

    try {
      const result = importStatement(db, userId, statement, {
        sha256,
        filename: file.name,
        storedPath: null,
      });
      return c.json(
        {
          documentId: result.documentId,
          bank: statement.bank,
          accountLast4: statement.accountLast4,
          status: result.status,
          version: result.version,
          added: result.added,
          skipped: result.skipped,
          warnings: statement.warnings,
        },
        201,
      );
    } catch (err) {
      if (err instanceof DuplicateDocumentError) {
        return c.json({ error: 'already_uploaded' }, 409);
      }
      throw err;
    }
  });

  // GET / — list
  app.get('/', (c) => {
    const userId = c.get('user').id;
    const rows = db
      .query(
        `SELECT d.id, a.bank, a.last4 AS accountLast4, d.statement_date AS statementDate,
                d.period_start AS periodStart, d.period_end AS periodEnd,
                d.status, d.version, d.uploaded_at AS uploadedAt, d.filename,
                (SELECT COUNT(*) FROM transactions t WHERE t.document_id = d.id AND t.deleted_at IS NULL) AS txnCount
         FROM documents d
         JOIN accounts a ON a.id = d.account_id
         WHERE d.user_id = ?
         ORDER BY d.uploaded_at DESC`,
      )
      .all(userId) as Array<{
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
      }>;
    return c.json(rows);
  });

  // DELETE /:id
  // POST /:id/recategorize — apply the current rules to this statement's uncategorized rows
  app.post('/:id/recategorize', (c) => {
    const userId = c.get('user').id;
    const docId = c.req.param('id');
    const doc = db.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ?').get(docId, userId);
    if (!doc) return c.json({ error: 'not_found' }, 404);
    const countOpen = () =>
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND document_id = ? AND category_id IS NULL AND deleted_at IS NULL AND kind NOT IN ('payment','credit')",
          )
          .get(userId, docId) as { n: number }
      ).n;
    const before = countOpen();
    ensureDefaultCategories(db, userId); // also backfills when it seeds
    applyCategoriesToUncategorized(db, userId, docId);
    const remaining = countOpen();
    return c.json({ updated: before - remaining, remaining });
  });

  app.delete('/:id', (c) => {
    const userId = c.get('user').id;
    const docId = c.req.param('id');

    // Delete transactions for this document owned by this user
    db.prepare(
      'DELETE FROM transactions WHERE document_id = ? AND user_id = ? AND source = ?',
    ).run(docId, userId, 'pdf');

    // Delete the document
    const result = db
      .prepare('DELETE FROM documents WHERE id = ? AND user_id = ?')
      .run(docId, userId);

    if (result.changes === 0) {
      return c.json({ error: 'not_found' }, 404);
    }

    return c.body(null, 204);
  });

  return app;
}
