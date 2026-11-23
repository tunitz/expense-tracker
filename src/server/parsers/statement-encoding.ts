import { createRequire } from 'node:module';
import { decodeCp037 as decodeInJs } from './cp037.ts';
import type { Page } from './types';

function loadDecoder(): typeof decodeInJs {
  if (process.env.EXPENSE_CP037_MODE === 'js') return decodeInJs;
  try {
    const addon = createRequire(import.meta.url)('../../../rust/statement-cp037/statement_cp037.node') as {
      decodeCp037: typeof decodeInJs;
    };
    return addon.decodeCp037;
  } catch (error) {
    // A plain `bun install` still works without the optional local native build.
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error;
    return decodeInJs;
  }
}

const decode = loadDecoder();
const statement = /statement/i;

export function normalizeStatementEncoding(pages: Page[]): void {
  const parts: string[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      for (const item of row.items) parts.push(item.s);
    }
  }
  const text = parts.join(' ');
  if (statement.test(text)) return;

  // Decode one document per native call. Both implementations emit one UTF-16
  // code unit per input code unit, so we can reuse the decoded item ranges.
  const decoded = decode(text);
  if (!statement.test(decoded)) return;

  let offset = 0;
  for (const page of pages) {
    for (const row of page.rows) {
      for (const item of row.items) {
        const end = offset + item.s.length;
        item.s = decoded.slice(offset, end);
        offset = end + 1; // Skip the decoded join separator.
      }
    }
  }
}
