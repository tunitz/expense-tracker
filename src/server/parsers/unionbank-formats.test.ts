import { describe, expect, it } from 'bun:test';
import { parseUnionBank } from './unionbank';
import type { Page } from './types';

function makePages(txnRows: { date: string; desc: string; amount: string }[], extraHeaderRows: { y: number; items: { x: number; s: string }[] }[] = []): Page[] {
  const headerRows = [
    { y: 715, items: [{ x: 45, s: 'Statement of Account' }] },
    { y: 695, items: [{ x: 47, s: 'Statement Date: November 03, 2026' }] },
    { y: 585, items: [{ x: 60, s: '* * * * * * * * * * * * 7 5 6 3' }] },
    { y: 576, items: [{ x: 386, s: 'Previous Balance' }] },
    { y: 563, items: [{ x: 60, s: 'N A M E' }] },
    { y: 560, items: [{ x: 386, s: 'PHP 10,000.00' }] },
    ...(extraHeaderRows.length ? extraHeaderRows : [{ y: 547, items: [{ x: 60, s: 'J A N E D O E' }] }]),
    { y: 532, items: [{ x: 386, s: 'Purchases and Advances' }] },
    { y: 516, items: [{ x: 386, s: 'PHP 7,336.65' }] },
    { y: 488, items: [{ x: 386, s: 'Payments & Credits' }] },
    { y: 472, items: [{ x: 386, s: 'PHP -10,000.00' }] },
    { y: 420, items: [{ x: 60, s: 'Due Date' }, { x: 193, s: 'Minimum Amount Due' }, { x: 386, s: 'Total Amount Due' }] },
    { y: 408, items: [{ x: 60, s: 'November 20, 2026' }, { x: 193, s: 'PHP 500.00' }, { x: 386, s: 'PHP 7,336.65' }] },
    { y: 308, items: [{ x: 47, s: 'DATE' }, { x: 132, s: 'DESCRIPTION' }, { x: 451, s: 'AMOUNT' }] },
  ];

  const bodyRows = txnRows.map((t, idx) => ({
    y: 276 - idx * 20,
    items: [
      { x: 47, s: t.date },
      { x: 132, s: t.desc },
      { x: 441, s: t.amount },
    ],
  }));

  return [{ rows: [...headerRows, ...bodyRows] }];
}

describe('parseUnionBank normalization', () => {
  it('normalizes merchant 0% instalments and EasyConvert instalment principals/interests consistently', () => {
    const pages = makePages([
      { date: 'Nov 03, 2026', desc: '(06/24) POWER MAC ROB CEBU', amount: 'PHP 1,053.75' },
      { date: 'Nov 03, 2026', desc: '(02/24) ABENSON-TACLOBAN', amount: 'PHP 2,083.00' },
      { date: 'Nov 03, 2026', desc: 'Instalment Interest (03/12) [9407765]', amount: 'PHP 682.11' },
      { date: 'Nov 03, 2026', desc: 'Instalment Principal (03/12) [9407765]', amount: 'PHP 3,517.79' },
      { date: 'Oct 14, 2026', desc: 'Payment via UB Online UB638652', amount: 'PHP -10,000.00' },
    ]);

    const stmt = parseUnionBank(pages);
    expect(stmt.warnings).toEqual([]);
    expect(stmt.accountName).toBe('JANEDOE');

    const powerMac = stmt.txns[0]!;
    expect(powerMac.kind).toBe('instalment_principal');
    expect(powerMac.instalmentSeq).toBe('06/24');
    expect(powerMac.merchant).toBe('POWER MAC ROB CEBU');

    const abenson = stmt.txns[1]!;
    expect(abenson.kind).toBe('instalment_principal');
    expect(abenson.instalmentSeq).toBe('02/24');
    expect(abenson.merchant).toBe('ABENSON-TACLOBAN');

    const interest = stmt.txns[2]!;
    expect(interest.kind).toBe('instalment_interest');
    expect(interest.instalmentSeq).toBe('03/12');
    expect(interest.instalmentRef).toBe('9407765');
    expect(interest.merchant).toBe('Instalment Interest [9407765]');

    const principal = stmt.txns[3]!;
    expect(principal.kind).toBe('instalment_principal');
    expect(principal.instalmentSeq).toBe('03/12');
    expect(principal.instalmentRef).toBe('9407765');
    expect(principal.merchant).toBe('Instalment Principal [9407765]');

    const payment = stmt.txns[4]!;
    expect(payment.kind).toBe('payment');
    expect(payment.amountMinor).toBe(-1000000);
  });

  it('preserves normal word spacing in accountName and ignores all-caps lines in transaction body', () => {
    const pages = makePages(
      [
        { date: 'Nov 03, 2026', desc: 'SOME STORE', amount: 'PHP 7,336.65' },
        { date: 'Oct 14, 2026', desc: 'Payment via UB Online', amount: 'PHP -10,000.00' },
      ],
      [{ y: 547, items: [{ x: 60, s: 'SAMPLE CUSTOMER' }] }],
    );
    // Append an all-caps continuation line in the body that previously would clobber accountName
    pages[0]!.rows.push({ y: 100, items: [{ x: 132, s: 'ALL CAPS BODY LINE' }] });

    const stmt = parseUnionBank(pages);
    expect(stmt.accountName).toBe('SAMPLE CUSTOMER');
  });
});
