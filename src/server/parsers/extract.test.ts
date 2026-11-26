import { describe, expect, it, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPages, PdfPasswordError } from './extract';
import { parseUnionBank } from './unionbank';
import { parseBpi } from './bpi';

const UNIONBANK_PATH = join(process.cwd(), 'fixtures/private/unionbank.pdf');
const BPI_PATH = join(process.cwd(), 'fixtures/private/bpi.pdf');

function load(path: string): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return null;
  }
}

const unionbankData = load(UNIONBANK_PATH);
const bpiData = load(BPI_PATH);

const unionbankSkip = unionbankData === null;
const bpiSkip = bpiData === null;

describe('extractPages', () => {
  describe('password errors', () => {
    it('rejects when no password provided for protected PDF', async () => {
      if (unionbankSkip) return;
      try {
        await extractPages(unionbankData);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(PdfPasswordError);
        expect((e as PdfPasswordError).wrong).toBe(false);
      }
    });

    it('rejects with wrong=true for incorrect password', async () => {
      if (unionbankSkip) return;
      try {
        await extractPages(unionbankData, 'wrong');
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(PdfPasswordError);
        expect((e as PdfPasswordError).wrong).toBe(true);
      }
    });
  });

  describe('unionbank.pdf', () => {
    it('extracts 4 pages with correct password', async () => {
      if (unionbankSkip) return;
      const pages = await extractPages(unionbankData, '486911');
      expect(pages.length).toBe(4);
    });

    it('contains "Statement Date: October 02, 2026"', async () => {
      if (unionbankSkip) return;
      const pages = await extractPages(unionbankData, '486911');
      const found = pages
        .flatMap((p) => p.rows.flatMap((r) => r.items.map((i) => i.s)))
        .some((s) => s.includes('Statement Date: October 02, 2026'));
      expect(found).toBe(true);
    });
  });

  describe('bpi.pdf', () => {
    it('extracts 4 pages with correct password', async () => {
      if (bpiSkip) return;
      const pages = await extractPages(bpiData, '19930404');
      expect(pages.length).toBe(4);
    });

    it('contains "SEPTEMBER 14, 2026"', async () => {
      if (bpiSkip) return;
      const pages = await extractPages(bpiData, '19930404');
      const found = pages
        .flatMap((p) => p.rows.flatMap((r) => r.items.map((i) => i.s)))
        .some((s) => s.includes('SEPTEMBER 14, 2026'));
      expect(found).toBe(true);
    });
  });

  describe('integration: unionbank parser', () => {
    it('parseUnionBank(extractPages(...)) yields 91 txns and no warnings', async () => {
      if (unionbankSkip) return;
      const pages = await extractPages(unionbankData, '486911');
      const result = parseUnionBank(pages);
      expect(result.txns.length).toBe(91);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('integration: bpi parser', () => {
    it('parseBpi(extractPages(...)) yields 4 txns and no warnings', async () => {
      if (bpiSkip) return;
      const pages = await extractPages(bpiData, '19930404');
      const result = parseBpi(pages);
      expect(result.txns.length).toBe(4);
      expect(result.warnings).toEqual([]);
    });
  });
});
