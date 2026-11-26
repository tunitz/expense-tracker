import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPages, PdfPasswordError } from './extract';
import { parseUnionBank } from './unionbank';
import { parseBpi } from './bpi';

const UNIONBANK_PATH = join(process.cwd(), 'fixtures/private/unionbank.pdf');
const BPI_PATH = join(process.cwd(), 'fixtures/private/bpi.pdf');
const UNIONBANK_PASSWORD = process.env.PRIVATE_UNIONBANK_PDF_PASSWORD;
const BPI_PASSWORD = process.env.PRIVATE_BPI_PDF_PASSWORD;

function load(path: string): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return null;
  }
}

const unionbankData = load(UNIONBANK_PATH);
const bpiData = load(BPI_PATH);

const unionbankMissingFile = unionbankData === null;
const unionbankSkip = unionbankData === null || !UNIONBANK_PASSWORD;
const bpiSkip = bpiData === null || !BPI_PASSWORD;

describe('extractPages', () => {
  describe('password errors', () => {
    it.skipIf(unionbankMissingFile)('rejects when no password provided for protected PDF', async () => {
      try {
        await extractPages(unionbankData!);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(PdfPasswordError);
        expect((e as PdfPasswordError).wrong).toBe(false);
      }
    });

    it.skipIf(unionbankMissingFile)('rejects with wrong=true for incorrect password', async () => {
      try {
        await extractPages(unionbankData!, 'wrong');
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(PdfPasswordError);
        expect((e as PdfPasswordError).wrong).toBe(true);
      }
    });
  });

  describe('unionbank.pdf', () => {
    it.skipIf(unionbankSkip)('extracts pages with correct password', async () => {
      const pages = await extractPages(unionbankData!, UNIONBANK_PASSWORD);
      expect(pages.length).toBeGreaterThan(0);
    });

    it.skipIf(unionbankSkip)('contains Statement Date header', async () => {
      const pages = await extractPages(unionbankData!, UNIONBANK_PASSWORD);
      const found = pages
        .flatMap((p) => p.rows.flatMap((r) => r.items.map((i) => i.s)))
        .some((s) => s.includes('Statement Date:'));
      expect(found).toBe(true);
    });
  });

  describe('bpi.pdf', () => {
    it.skipIf(bpiSkip)('extracts pages with correct password', async () => {
      const pages = await extractPages(bpiData!, BPI_PASSWORD);
      expect(pages.length).toBeGreaterThan(0);
    });

    it.skipIf(bpiSkip)('contains Statement of Account text', async () => {
      const pages = await extractPages(bpiData!, BPI_PASSWORD);
      const found = pages
        .flatMap((p) => p.rows.flatMap((r) => r.items.map((i) => i.s)))
        .some((s) => s.includes('Statement of Account'));
      expect(found).toBe(true);
    });
  });

  describe('integration: unionbank parser', () => {
    it.skipIf(unionbankSkip)('parseUnionBank(extractPages(...)) yields txns and no warnings', async () => {
      const pages = await extractPages(unionbankData!, UNIONBANK_PASSWORD);
      const result = parseUnionBank(pages);
      expect(result.txns.length).toBeGreaterThan(0);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('integration: bpi parser', () => {
    it.skipIf(bpiSkip)('parseBpi(extractPages(...)) yields txns and no warnings', async () => {
      const pages = await extractPages(bpiData!, BPI_PASSWORD);
      const result = parseBpi(pages);
      expect(result.txns.length).toBeGreaterThan(0);
      expect(result.warnings).toEqual([]);
    });
  });
});
