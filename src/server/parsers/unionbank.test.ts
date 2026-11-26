import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseUnionBank } from './unionbank';
import type { Page } from './types';

const fixturePath = join(process.cwd(), 'fixtures/private/unionbank.rows.json');
const hasFixture = existsSync(fixturePath);
const stmt = hasFixture
  ? parseUnionBank(JSON.parse(readFileSync(fixturePath, 'utf-8')) as Page[])
  : (undefined as unknown as ReturnType<typeof parseUnionBank>);

describe.skipIf(!hasFixture)('parseUnionBank', () => {
  test('accountLast4 is 4 digits', () => {
    expect(stmt.accountLast4).toMatch(/^\d{4}$/);
  });

  test('statementDate and dueDate are ISO dates', () => {
    expect(stmt.statementDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stmt.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('totals.totalDueMinor is an integer', () => {
    expect(Number.isInteger(stmt.totals.totalDueMinor)).toBe(true);
  });

  test('parses transactions with no reconciliation warnings', () => {
    expect(stmt.txns.length).toBeGreaterThan(0);
    expect(stmt.warnings).toEqual([]);
  });
});
