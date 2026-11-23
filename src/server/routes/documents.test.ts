import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { openDb } from '../db';
import { register, login } from '../auth';
import type { AppEnv } from '../app';
import { documentsRoutes } from './documents';
import { statementPdf } from '../../../scripts/profile-statements';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'fixtures', 'private');

function createAppWithUser(db: Database, userId: string) {
  const app = new Hono<AppEnv>();

  // Stub requireUser: set c.set('user', {id, email}) for the given user
  app.use('*', async (c, next) => {
    c.set('user', { id: userId, email: 'test@example.com' });
    await next();
  });

  app.route('/documents', documentsRoutes(db));
  return app;
}

function createTwoUserApp(db: Database) {
  const user1Id = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string };
  const user2Id = db.prepare('SELECT id FROM users WHERE id != ? LIMIT 1').get(user1Id.id) as { id: string };
  return {
    app1: createAppWithUser(db, user1Id.id),
    app2: createAppWithUser(db, user2Id.id),
  };
}

function makeFormData(fileBuffer: Uint8Array, filename: string, password?: string): FormData {
  const form = new FormData();
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  form.set('file', blob, filename);
  if (password !== undefined) {
    form.set('password', password);
  }
  return form;
}

function makeNoFileForm(): FormData {
  const form = new FormData();
  // Don't set 'file' at all
  return form;
}

function makeNonPdfForm(): FormData {
  const form = new FormData();
  const blob = new Blob(['not a pdf'], { type: 'text/plain' });
  form.set('file', blob, 'test.txt');
  return form;
}

describe('documents routes', () => {
  let db: Database;
  let user1Id: string;
  let user2Id: string;

  beforeEach(async () => {
    db = openDb(':memory:');
    // Create two users
    const u1 = await register(db, 'user1@test.com', 'password123');
    const u2 = await register(db, 'user2@test.com', 'password456');
    user1Id = u1.id;
    user2Id = u2.id;
  });

  afterAll(() => {
    db.close();
  });

  describe('POST /documents', () => {
    it('uploads a synthetic multi-page statement and rejects a duplicate', async () => {
      const app = createAppWithUser(db, user1Id);
      const pdf = statementPdf(2, 8);
      const upload = () => app.request('/documents', {
        method: 'POST',
        body: makeFormData(pdf, 'synthetic.pdf'),
      });
      const response = await upload();
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ bank: 'unionbank', added: 16, warnings: [] });
      expect((await upload()).status).toBe(409);
    });

    it('rejects upload without file => 400', async () => {
      const app = createAppWithUser(db, user1Id);
      const form = makeNoFileForm();
      const res = await app.request('/documents', { method: 'POST', body: form });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('no_file');
    });

    it('rejects non-PDF file => 415', async () => {
      const app = createAppWithUser(db, user1Id);
      const form = makeNonPdfForm();
      const res = await app.request('/documents', { method: 'POST', body: form });
      expect(res.status).toBe(415);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('not_pdf');
    });

    it('rejects unionbank without password => 423 wrong:false', async () => {
      const pdfBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'unionbank.pdf'));
      const app = createAppWithUser(db, user1Id);
      const form = makeFormData(pdfBytes, 'unionbank.pdf');
      const res = await app.request('/documents', { method: 'POST', body: form });
      expect(res.status).toBe(423);
      const body = await res.json() as { error: string; wrong: boolean };
      expect(body.error).toBe('password_required');
      expect(body.wrong).toBe(false);
    });

    it('rejects unionbank with wrong password => 423 wrong:true', async () => {
      const pdfBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'unionbank.pdf'));
      const app = createAppWithUser(db, user1Id);
      const form = makeFormData(pdfBytes, 'unionbank.pdf', 'wrongpassword');
      const res = await app.request('/documents', { method: 'POST', body: form });
      expect(res.status).toBe(423);
      const body = await res.json() as { error: string; wrong: boolean };
      expect(body.error).toBe('password_required');
      expect(body.wrong).toBe(true);
    });

    it('accepts unionbank with correct password => 201, added 91', async () => {
      const pdfBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'unionbank.pdf'));
      const app = createAppWithUser(db, user1Id);
      const form = makeFormData(pdfBytes, 'unionbank.pdf', '486911');
      const res = await app.request('/documents', { method: 'POST', body: form });
      expect(res.status).toBe(201);
      const body = await res.json() as {
        documentId: string; bank: string; accountLast4: string;
        status: string; version: number; added: number; skipped: number; warnings: string[];
      };
      expect(body.documentId).toBeDefined();
      expect(body.bank).toBe('unionbank');
      expect(body.added).toBe(91);
      expect(body.warnings).toEqual([]);
    });

    it('rejects duplicate unionbank => 409', async () => {
      const pdfBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'unionbank.pdf'));
      const app = createAppWithUser(db, user1Id);
      const form1 = makeFormData(pdfBytes, 'unionbank.pdf', '486911');
      await app.request('/documents', { method: 'POST', body: form1 });
      const form2 = makeFormData(pdfBytes, 'unionbank.pdf', '486911');
      const res = await app.request('/documents', { method: 'POST', body: form2 });
      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('already_uploaded');
    });

    it('accepts bpi with correct password => 201, added 4', async () => {
      const pdfBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'bpi.pdf'));
      const app = createAppWithUser(db, user1Id);
      const form = makeFormData(pdfBytes, 'bpi.pdf', '19930404');
      const res = await app.request('/documents', { method: 'POST', body: form });
      expect(res.status).toBe(201);
      const body = await res.json() as {
        documentId: string; bank: string; added: number;
      };
      expect(body.bank).toBe('bpi');
      expect(body.added).toBe(4);
    });
  });

  describe('GET /documents', () => {
    it('lists documents with txnCount', async () => {
      const app = createAppWithUser(db, user1Id);

      // Upload unionbank
      const ubBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'unionbank.pdf'));
      await app.request('/documents', {
        method: 'POST',
        body: makeFormData(ubBytes, 'unionbank.pdf', '486911'),
      });

      // Upload bpi
      const bpiBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'bpi.pdf'));
      await app.request('/documents', {
        method: 'POST',
        body: makeFormData(bpiBytes, 'bpi.pdf', '19930404'),
      });

      const res = await app.request('/documents');
      expect(res.status).toBe(200);
      const docs = await res.json() as Array<{
        id: string; bank: string; accountLast4: string;
        txnCount: number; filename: string;
      }>;
      expect(docs.length).toBe(2);
      // txnCount should be 91 for unionbank and 4 for bpi
      const txnCounts = docs.map((d) => d.txnCount).sort((a, b) => b - a);
      expect(txnCounts).toEqual([91, 4]);
    });
  });

  describe('DELETE /documents/:id', () => {
    it('removes document and its transactions', async () => {
      const app = createAppWithUser(db, user1Id);

      // Upload unionbank
      const ubBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'unionbank.pdf'));
      const uploadRes = await app.request('/documents', {
        method: 'POST',
        body: makeFormData(ubBytes, 'unionbank.pdf', '486911'),
      });
      const { documentId } = await uploadRes.json() as { documentId: string };

      // Verify transactions exist
      const txnCount = db.prepare(
        'SELECT COUNT(*) AS cnt FROM transactions WHERE document_id = ? AND source = ?',
      ).get(documentId, 'pdf') as { cnt: number };
      expect(txnCount.cnt).toBeGreaterThan(0);

      // Delete
      const delRes = await app.request(`/documents/${documentId}`, { method: 'DELETE' });
      expect(delRes.status).toBe(204);

      // Verify transactions deleted
      const txnCountAfter = db.prepare(
        'SELECT COUNT(*) AS cnt FROM transactions WHERE document_id = ? AND source = ?',
      ).get(documentId, 'pdf') as { cnt: number };
      expect(txnCountAfter.cnt).toBe(0);
    });

    it('returns 404 for another user\'s document', async () => {
      const { app1, app2 } = createTwoUserApp(db);

      // User1 uploads
      const ubBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'unionbank.pdf'));
      const uploadRes = await app1.request('/documents', {
        method: 'POST',
        body: makeFormData(ubBytes, 'unionbank.pdf', '486911'),
      });
      const { documentId } = await uploadRes.json() as { documentId: string };

      // User2 tries to delete
      const delRes = await app2.request(`/documents/${documentId}`, { method: 'DELETE' });
      expect(delRes.status).toBe(404);
    });
  });

  describe('cross-user isolation', () => {
    it('user2 cannot see user1\'s documents', async () => {
      const { app1, app2 } = createTwoUserApp(db);

      // User1 uploads
      const ubBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'unionbank.pdf'));
      await app1.request('/documents', {
        method: 'POST',
        body: makeFormData(ubBytes, 'unionbank.pdf', '486911'),
      });

      // User2 list should be empty
      const res = await app2.request('/documents');
      expect(res.status).toBe(200);
      const docs = await res.json() as Array<unknown>;
      expect(docs.length).toBe(0);
    });

    it('user2 cannot delete user1\'s document', async () => {
      const { app1, app2 } = createTwoUserApp(db);

      // User1 uploads
      const ubBytes = fs.readFileSync(path.join(FIXTURE_DIR, 'unionbank.pdf'));
      const uploadRes = await app1.request('/documents', {
        method: 'POST',
        body: makeFormData(ubBytes, 'unionbank.pdf', '486911'),
      });
      const { documentId } = await uploadRes.json() as { documentId: string };

      // User2 tries to delete
      const delRes = await app2.request(`/documents/${documentId}`, { method: 'DELETE' });
      expect(delRes.status).toBe(404);
    });
  });
});
