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
  test('accountLast4', () => {
    expect(stmt.accountLast4).toBe('7563');
  });

  test('statementDate', () => {
    expect(stmt.statementDate).toBe('2026-10-02');
  });

  test('dueDate', () => {
    expect(stmt.dueDate).toBe('2026-10-19');
  });

  test('totals.totalDueMinor', () => {
    expect(stmt.totals.totalDueMinor).toBe(6235324);
  });

  test('txns.length > 40', () => {
    expect(stmt.txns.length).toBeGreaterThan(40);
  });

  test('warnings is empty', () => {
    console.log('Warnings:', stmt.warnings);
    console.log('Txn count:', stmt.txns.length);
    expect(stmt.warnings).toEqual([]);
  });

  test('DEEPSEERWEA txns (Sep 26, 13785)', () => {
    const deepseer = stmt.txns.filter(t => t.merchant.startsWith('DEEPSEERWEA') && t.txnDate === '2026-09-26' && t.amountMinor === 13785);
    expect(deepseer.length).toBe(2);
  });

  test('ANTHROPIC txn FX', () => {
    const anthropic = stmt.txns.find(t => t.merchant.startsWith('ANTHROPIC'));
    expect(anthropic).toBeDefined();
    expect(anthropic!.fxCurrency).toBe('USD');
    expect(anthropic!.fxAmountMinor).toBe(2240);
    expect(anthropic!.amountMinor).toBe(145027);
  });

  test('instalment principal txn', () => {
    const inst = stmt.txns.find(t => t.instalmentRef === '9407765' && t.kind === 'instalment_principal');
    expect(inst).toBeDefined();
    expect(inst!.amountMinor).toBe(345599);
  });

  test('credit reversal txn', () => {
    const credit = stmt.txns.find(t => t.description === 'Credit for Transaction Instalment');
    expect(credit).toBeDefined();
    expect(credit!.kind).toBe('credit');
    expect(credit!.amountMinor).toBe(-600500);
  });
});
