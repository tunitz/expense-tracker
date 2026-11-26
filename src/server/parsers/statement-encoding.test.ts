import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { decodeCp037 } from './cp037';
import { normalizeStatementEncoding } from './statement-encoding';
import type { Page } from './types';

const encodedStatement = '\xe2\xa3\x81\xa3\x85\x94\x85\x95\xa3';

test('normalizes a whole EBCDIC document without changing rows or item boundaries', () => {
  const pages: Page[] = [
    { rows: [{ y: 3, items: [{ x: 2, s: encodedStatement }, { x: 5, s: '\xc1\xc2' }] }] },
    { rows: [] },
    { rows: [{ y: 1, items: [{ x: 0, s: '' }, { x: 1, s: '\u20c3\ud8c4' }] }] },
  ];
  normalizeStatementEncoding(pages);
  expect(pages).toEqual([
    { rows: [{ y: 3, items: [{ x: 2, s: 'Statement' }, { x: 5, s: 'AB' }] }] },
    { rows: [] },
    { rows: [{ y: 1, items: [{ x: 0, s: '' }, { x: 1, s: 'CD' }] }] },
  ]);
});

test('preserves plain statements and text with no marker in either encoding', () => {
  for (const texts of [['sTaTeMeNt', encodedStatement], ['café', '\xc1\xc2']]) {
    const pages = [{ rows: [{ y: 9, items: texts.map((s, x) => ({ x, s })) }] }];
    const expected = structuredClone(pages);
    normalizeStatementEncoding(pages);
    expect(pages).toEqual(expected);
  }
});

const require = createRequire(import.meta.url);
const path = '../../../rust/statement-cp037/statement_cp037.node';
let addonPath: string | undefined;
try {
  addonPath = require.resolve(path);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error;
}

test.skipIf(!addonPath)('native decoder matches the JS reference for every low byte and raw UTF-16', () => {
  const native = require(addonPath!) as { decodeCp037: typeof decodeCp037 };
  const bytes = Array.from({ length: 256 }, (_, byte) => String.fromCharCode(byte)).join('');
  for (const text of ['', bytes, '\u00ff\u20ac💳\ud800A\udcff\u0000', bytes.repeat(100)]) {
    expect(native.decodeCp037(text)).toBe(decodeCp037(text));
  }
});
