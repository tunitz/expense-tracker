import type { Page, Row } from './types';
import { normalizeStatementEncoding } from './statement-encoding.ts';

export const MAX_PDF_PAGES = 50;

const FULL_LETTER_SPACED_RE = /^\S(?: \S){2,}$/;
const PARTIAL_LETTER_SPACED_RE = /(?:^| )\S(?: \S){3,}(?: |$)/;

type Matrix = [number, number, number, number, number, number];
const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

function mulMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function toMatrix(raw: ArrayLike<number>): Matrix {
  return [raw[0]!, raw[1]!, raw[2]!, raw[3]!, raw[4]!, raw[5]!];
}

function groupRows(yMap: Map<number, { x: number; s: string }[]>): Row[] {
  return [...yMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, items]) => ({
      y,
      items: items.sort((a, b) => a.x - b.x),
    }));
}

function isLetterSpacedItem(s: string): boolean {
  return FULL_LETTER_SPACED_RE.test(s) || PARTIAL_LETTER_SPACED_RE.test(s);
}

/**
 * pdf.js's getTextContent() injects fake spaces between every character when a PDF uses
 * large character spacing (Tc >= 0.102 * fontSize) and merges adjacent words with the
 * same single space, destroying word boundaries. Detect that artifact on a page so we
 * can recover exact per-run text from the page's operator list instead.
 */
function hasLetterSpacingArtifact(rows: Row[]): boolean {
  let eligibleCount = 0;
  let eligibleChars = 0;
  let spacedCount = 0;
  let spacedChars = 0;

  for (const row of rows) {
    for (const item of row.items) {
      const trimmed = item.s.trim();
      if (trimmed.length < 3) continue;
      eligibleCount++;
      eligibleChars += trimmed.length;
      if (isLetterSpacedItem(trimmed)) {
        spacedCount++;
        spacedChars += trimmed.length;
      }
    }
  }

  if (spacedCount < 2 || eligibleCount === 0) return false;
  return spacedCount / eligibleCount >= 0.4 || spacedChars / eligibleChars >= 0.4;
}

type SavedGraphicsState = {
  ctm: Matrix;
  charSpacing: number;
  wordSpacing: number;
  textHScale: number;
  leading: number;
  fontSize: number;
};

async function extractRowsFromOperatorList(page: any, OPS: Record<string, number>): Promise<Row[]> {
  const ops = await page.getOperatorList();
  const yMap = new Map<number, { x: number; s: string }[]>();

  let ctm: Matrix = [...IDENTITY_MATRIX];
  let textMatrix: Matrix = [...IDENTITY_MATRIX];
  let x = 0;
  let y = 0;
  let lineX = 0;
  let lineY = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let textHScale = 1;
  let leading = 0;
  let fontSize = 0;
  const stateStack: SavedGraphicsState[] = [];

  const pushState = () => {
    stateStack.push({
      ctm: [...ctm],
      charSpacing,
      wordSpacing,
      textHScale,
      leading,
      fontSize,
    });
  };

  const popState = () => {
    const saved = stateStack.pop();
    if (!saved) return;
    ctm = saved.ctm;
    charSpacing = saved.charSpacing;
    wordSpacing = saved.wordSpacing;
    textHScale = saved.textHScale;
    leading = saved.leading;
    fontSize = saved.fontSize;
  };

  const emitGlyphs = (glyphs: unknown) => {
    if (!Array.isArray(glyphs)) return;
    const pos = mulMatrix(ctm, mulMatrix(textMatrix, [1, 0, 0, 1, x, y]));
    let text = '';
    let advance = 0;
    for (const glyph of glyphs) {
      if (typeof glyph === 'number') {
        if (glyph <= -180 && text.length > 0 && !text.endsWith(' ')) {
          text += ' ';
        }
        advance += (-glyph / 1000) * fontSize * textHScale;
        continue;
      }
      if (glyph && typeof glyph === 'object') {
        const g = glyph as { unicode?: string; width?: number; originalCharCode?: number };
        if (typeof g.unicode === 'string') text += g.unicode;
        const width = typeof g.width === 'number' ? g.width : 0;
        let spacing = charSpacing;
        if (g.originalCharCode === 0x20) spacing += wordSpacing;
        advance += ((width / 1000) * fontSize + spacing) * textHScale;
      }
    }
    x += advance;
    if (text.trim() === '') return;

    const ry = Math.round(pos[5]);
    const rx = Math.round(pos[4]);
    const arr = yMap.get(ry) ?? [];
    arr.push({ x: rx, s: text });
    yMap.set(ry, arr);
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];

    switch (fn) {
      case OPS.save:
        pushState();
        break;
      case OPS.restore:
        popState();
        break;
      case OPS.transform:
        if (args && args.length >= 6) ctm = mulMatrix(ctm, toMatrix(args));
        break;
      case OPS.paintFormXObjectBegin:
        pushState();
        if (args?.[0] && args[0].length >= 6) ctm = mulMatrix(ctm, toMatrix(args[0]));
        break;
      case OPS.paintFormXObjectEnd:
        popState();
        break;
      case OPS.beginText:
        textMatrix = [...IDENTITY_MATRIX];
        x = lineX = 0;
        y = lineY = 0;
        break;
      case OPS.setCharSpacing:
        charSpacing = args[0] ?? 0;
        break;
      case OPS.setWordSpacing:
        wordSpacing = args[0] ?? 0;
        break;
      case OPS.setHScale:
        textHScale = (args[0] ?? 100) / 100;
        break;
      case OPS.setLeading:
        leading = -(args[0] ?? 0);
        break;
      case OPS.setFont:
        fontSize = Math.abs(args[1] ?? 0);
        break;
      case OPS.moveText:
        x = lineX += args[0] ?? 0;
        y = lineY += args[1] ?? 0;
        break;
      case OPS.setLeadingMoveText:
        leading = args[1] ?? 0;
        x = lineX += args[0] ?? 0;
        y = lineY += args[1] ?? 0;
        break;
      case OPS.setTextMatrix: {
        const raw = args?.length === 6 ? args : args?.[0];
        if (raw && raw.length >= 6) {
          textMatrix = toMatrix(raw);
          x = lineX = 0;
          y = lineY = 0;
        }
        break;
      }
      case OPS.nextLine:
        x = lineX;
        y = lineY += leading;
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        emitGlyphs(args?.[0]);
        break;
      case OPS.nextLineShowText:
        x = lineX;
        y = lineY += leading;
        emitGlyphs(args?.[0]);
        break;
      case OPS.nextLineSetSpacingShowText:
        wordSpacing = args[0] ?? 0;
        charSpacing = args[1] ?? 0;
        x = lineX;
        y = lineY += leading;
        emitGlyphs(args?.[2]);
        break;
    }
  }

  return groupRows(yMap);
}

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
    let rows = groupRows(yMap);

    if (hasLetterSpacingArtifact(rows)) {
      const opRows = await extractRowsFromOperatorList(page, pdfjs.OPS);
      if (opRows.length > 0) rows = opRows;
    }

    pages.push({ rows });
  }

  normalizeStatementEncoding(pages);

  return pages;
}
