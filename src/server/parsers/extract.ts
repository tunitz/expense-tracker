import type { Page } from './types';
import { normalizeStatementEncoding } from './statement-encoding.ts';

export const MAX_PDF_PAGES = 50;

export class TooManyPagesError extends Error {
  constructor() {
    super('too_many_pages');
    this.name = 'TooManyPagesError';
  }
}

export class PdfPasswordError extends Error {
  wrong: boolean;
  constructor(message: string, wrong: boolean) {
    super(message);
    this.name = 'PdfPasswordError';
    this.wrong = wrong;
  }
}

export async function extractPages(
  data: Uint8Array,
  password?: string,
): Promise<Page[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  let doc: any;
  try {
    doc = await pdfjs
      .getDocument({
        data: data.slice(),
        password,
        useSystemFonts: false,
      } as any)
      .promise;
  } catch (e: any) {
    if (e?.name === 'PasswordException') {
      const code = e?.code ?? 0;
      throw new PdfPasswordError(e?.message ?? 'Password required', code === 2);
    }
    throw e;
  }

  if (doc.numPages > MAX_PDF_PAGES) {
    await doc.destroy?.();
    throw new TooManyPagesError();
  }

  const pages: Page[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();

    // Group items by y-coordinate
    const yMap = new Map<number, { x: number; s: string }[]>();

    for (const item of tc.items) {
      if ('str' in item === false) continue; // skip TextMarkedContent
      const s = item.str;
      if (s.trim() === '') continue;

      const y = Math.round(item.transform[5]);
      const x = Math.round(item.transform[4]);

      const arr = yMap.get(y) ?? [];
      arr.push({ x, s });
      yMap.set(y, arr);
    }

    // Sort rows by y descending (top first), items within row by x ascending
    const rows = [...yMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, items]) => ({
        y,
        items: items.sort((a, b) => a.x - b.x),
      }));

    pages.push({ rows });
  }

  normalizeStatementEncoding(pages);

  return pages;
}
