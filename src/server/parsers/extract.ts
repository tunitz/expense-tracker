import type { Page } from './types';

// EBCDIC cp037 → Unicode mapping table (256 chars)
// Generated: bytes(range(256)).decode('cp037')
const CP037: string = "\u0000\u0001\u0002\u0003\u009c\t\u0086\u007f\u0097\u008d\u008e\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u009d\u0085\b\u0087\u0018\u0019\u0092\u008f\u001c\u001d\u001e\u001f\u0080\u0081\u0082\u0083\u0084\n\u0017\u001b\u0088\u0089\u008a\u008b\u008c\u0005\u0006\u0007\u0090\u0091\u0016\u0093\u0094\u0095\u0096\u0004\u0098\u0099\u009a\u009b\u0014\u0015\u009e\u001a \u00a0\u00e2\u00e4\u00e0\u00e1\u00e3\u00e5\u00e7\u00f1\u00a2.<(+|&\u00e9\u00ea\u00eb\u00e8\u00ed\u00ee\u00ef\u00ec\u00df!$*);\u00ac-/\u00c2\u00c4\u00c0\u00c1\u00c3\u00c5\u00c7\u00d1\u00a6,%_>?\u00f8\u00c9\u00ca\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc`:#@'=\"\u00d8abcdefghi\u00ab\u00bb\u00f0\u00fd\u00fe\u00b1\u00b0jklmnopqr\u00aa\u00ba\u00e6\u00b8\u00c6\u00a4\u00b5~stuvwxyz\u00a1\u00bf\u00d0\u00dd\u00de\u00ae^\u00a3\u00a5\u00b7\u00a9\u00a7\u00b6\u00bc\u00bd\u00be[]\u00af\u00a8\u00b4\u00d7{ABCDEFGHI\u00ad\u00f4\u00f6\u00f2\u00f3\u00f5}JKLMNOPQR\u00b9\u00fb\u00fc\u00f9\u00fa\u00ff\\\u00f7STUVWXYZ\u00b2\u00d4\u00d6\u00d2\u00d3\u00d50123456789\u00b3\u00db\u00dc\u00d9\u00da\u009f";

function decodeCp037(str: string): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += CP037[str.charCodeAt(i) & 0xff];
  }
  return out;
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

  // EBCDIC fallback detection (per document)
  const allText = pages
    .flatMap((p) => p.rows.flatMap((r) => r.items.map((i) => i.s)))
    .join(' ');

  // Check if text contains "statement" normally
  const hasPlainStatement = /statement/i.test(allText);

  // Check if decoded text contains "statement"
  const decodedText = decodeCp037(allText);
  const hasDecodedStatement = /statement/i.test(decodedText);

  if (!hasPlainStatement && hasDecodedStatement) {
    // Every item string in every page is EBCDIC-encoded
    for (const page of pages) {
      for (const row of page.rows) {
        for (const item of row.items) {
          item.s = decodeCp037(item.s);
        }
      }
    }
  }

  return pages;
}
