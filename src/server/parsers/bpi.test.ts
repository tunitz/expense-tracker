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
  test('accountLast4', () => {
    expect(stmt.accountLast4).toBe('2118');
  });

  test('statementDate', () => {
    expect(stmt.statementDate).toBe('2026-09-14');
  });

  test('dueDate', () => {
    expect(stmt.dueDate).toBe('2026-10-05');
  });

  test('totals.totalDueMinor', () => {
    expect(stmt.totals.totalDueMinor).toBe(306167);
  });

  test('totals.paymentsMinor', () => {
    expect(stmt.totals.paymentsMinor).toBe(-306578);
  });

  test('txns.length', () => {
    expect(stmt.txns.length).toBe(4);
  });

  test('warnings is empty', () => {
    expect(stmt.warnings).toEqual([]);
  });

  test('payment txn 1 (-306167, rewards, 2026-08-15)', () => {
    const p = stmt.txns.find(t => t.amountMinor === -306167 && t.subAccount === 'rewards');
    expect(p).toBeDefined();
    expect(p!.txnDate).toBe('2026-08-15');
    expect(p!.postedDate).toBe('2026-08-17');
    expect(p!.kind).toBe('payment');
  });

  test('payment txn 2 (-411, ecredit)', () => {
    const p = stmt.txns.find(t => t.amountMinor === -411 && t.subAccount === 'ecredit');
    expect(p).toBeDefined();
    expect(p!.kind).toBe('payment');
  });

  test('instalment_principal 60417 (seq 11/24)', () => {
    const i = stmt.txns.find(t => t.kind === 'instalment_principal' && t.amountMinor === 60417 && t.instalmentSeq === '11/24');
    expect(i).toBeDefined();
  });

  test('instalment_principal 245750 (seq 11/12)', () => {
    const i = stmt.txns.find(t => t.kind === 'instalment_principal' && t.amountMinor === 245750 && t.instalmentSeq === '11/12');
    expect(i).toBeDefined();
  });
});
