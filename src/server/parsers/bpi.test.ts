import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseBpi } from './bpi';
import type { Page } from './types';

const fixturePath = join(process.cwd(), 'fixtures/private/bpi.rows.json');
const hasFixture = existsSync(fixturePath);
const stmt = hasFixture
  ? parseBpi(JSON.parse(readFileSync(fixturePath, 'utf-8')) as Page[])
  : (undefined as unknown as ReturnType<typeof parseBpi>);

describe.skipIf(!hasFixture)('parseBpi', () => {
  test('accountLast4 is 4 digits', () => {
    expect(stmt.accountLast4).toMatch(/^\d{4}$/);
  });

  test('statementDate and dueDate are ISO dates', () => {
    expect(stmt.statementDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stmt.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('totals are integer minor units', () => {
    expect(Number.isInteger(stmt.totals.totalDueMinor)).toBe(true);
    expect(Number.isInteger(stmt.totals.paymentsMinor)).toBe(true);
  });

  test('parses transactions with no reconciliation warnings', () => {
    expect(stmt.txns.length).toBeGreaterThan(0);
    expect(stmt.warnings).toEqual([]);
  });

  test('includes payments and instalment entries when present', () => {
    const payments = stmt.txns.filter((t) => t.kind === 'payment');
    expect(payments.length).toBeGreaterThan(0);
    for (const p of payments) {
      expect(p.amountMinor).toBeLessThan(0);
      expect(p.txnDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
