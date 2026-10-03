import type { Page, ParsedStatement, ParsedTxn } from './types';

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04',
  May: '05', Jun: '06', Jul: '07', Aug: '08',
  Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  January: '01', February: '02', March: '03', April: '04',
  June: '06', July: '07', August: '08', September: '09',
  October: '10', November: '11', December: '12',
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function parseMonthDay(dateStr: string, stmtMonth: number, stmtYear: number): string {
  // Full date with year: "SEPTEMBER 14, 2026"
  const m = dateStr.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTH_MAP[titleCase(m[1]!)];
    if (!month) throw new Error(`bpi: unknown month "${m[1]}"`);
    const day = m[2]!.padStart(2, '0');
    return `${m[3]}-${month}-${day}`;
  }
  // Month + day without year: "August 15"
  const m2 = dateStr.match(/^(\w+)\s+(\d{1,2})$/);
  if (m2) {
    const month = MONTH_MAP[titleCase(m2[1]!)];
    if (!month) throw new Error(`bpi: unknown month "${m2[1]}"`);
    const day = m2[2]!.padStart(2, '0');
    const monthNum = parseInt(month, 10);
    const year = monthNum > stmtMonth ? String(stmtYear - 1) : String(stmtYear);
    return `${year}-${month}-${day}`;
  }
  throw new Error(`bpi: invalid date "${dateStr}"`);
}

function parseAmountMinor(str: string): number {
  const cleaned = str.replace(/[^0-9.-]/g, '');
  return Math.round(parseFloat(cleaned) * 100);
}

export function parseBpi(pages: Page[]): ParsedStatement {
  // Flatten all pages (rows already sorted top-to-bottom)
  const allRows: { y: number; items: readonly { x: number; s: string }[] }[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      allRows.push(row);
    }
  }

  // --- Parse header info ---
  let customerNumber: string | null = null;
  let statementDate: string | null = null;
  let accountName: string | null = null;
  let dueDate: string | null = null;
  let totalDueMinor: number | null = null;
  let minDueMinor: number | null = null;

  let stmtMonth: number | null = null;
  let stmtYear: number | null = null;

  for (const row of allRows) {
    const labelItem = row.items.find(it => it.x >= 300 && it.x < 400);
    if (!labelItem) continue;
    const label = labelItem.s.trim();

    if (label === 'CUSTOMER NUMBER') {
      const valItem = row.items.find(it => it.x > 400);
      if (valItem) customerNumber = valItem.s.trim();
    } else if (label === 'STATEMENT DATE') {
      const valItem = row.items.find(it => it.x > 400);
      if (valItem) {
        const parts = valItem.s.trim().split(/\s+/);
        const month = MONTH_MAP[titleCase(parts[0]!)];
        const year = parseInt(parts[2]!, 10);
        const day = parts[1]!.replace(',', '').padStart(2, '0');
        if (!month) throw new Error(`bpi: unknown month "${parts[0]}"`);
        statementDate = `${year}-${month}-${day}`;
        stmtMonth = parseInt(month, 10);
        stmtYear = year;
      }
    } else if (label === 'PAYMENT DUE DATE') {
      const valItem = row.items.find(it => it.x > 400);
      if (valItem) dueDate = parseMonthDay(valItem.s.trim(), stmtMonth ?? 9, stmtYear ?? 2026);
    } else if (label === 'TOTAL AMOUNT DUE') {
      const valItem = row.items.find(it => it.x > 400);
      if (valItem) totalDueMinor = parseAmountMinor(valItem.s);
    } else if (label === 'MINIMUM AMOUNT DUE') {
      const valItem = row.items.find(it => it.x > 400);
      if (valItem) minDueMinor = parseAmountMinor(valItem.s);
    }
  }

  // Account name: single item at x=36, not starting with 'BPICC'
  for (const row of allRows) {
    if (row.items.length === 1 && row.items[0]!.x === 36) {
      const s = row.items[0]!.s;
      if (!s.startsWith('BPICC')) {
        accountName = s;
        break;
      }
    }
  }

  if (!customerNumber) throw new Error('bpi: missing customer number');
  if (!statementDate) throw new Error('bpi: missing statementDate');
  if (!accountName) throw new Error('bpi: missing accountName');
  if (!dueDate) throw new Error('bpi: missing dueDate');
  if (totalDueMinor === null) throw new Error('bpi: missing totalDueMinor');
  if (minDueMinor === null) throw new Error('bpi: missing minDueMinor');
  if (stmtMonth === null) throw new Error('bpi: missing statementMonth');
  if (stmtYear === null) throw new Error('bpi: missing statementYear');

  // --- Parse summary table ---
  let previousBalanceMinor: number | null = null;
  let paymentsMinor: number | null = null;
  let purchasesMinor: number | null = null;

  for (const row of allRows) {
    const labelItem = row.items.find(it => it.x >= 30 && it.x < 60 && it.s.trim() === 'Total');
    if (labelItem) {
      const items = row.items;
      const prevItem = items.find(it => Math.abs(it.x - 138) < 10);
      const payItem = items.find(it => Math.abs(it.x - 203) < 10);
      const purchItem = items.find(it => Math.abs(it.x - 283) < 10);
      if (prevItem) previousBalanceMinor = parseAmountMinor(prevItem.s);
      if (payItem) paymentsMinor = -parseAmountMinor(payItem.s);
      if (purchItem) purchasesMinor = parseAmountMinor(purchItem.s);
      break;
    }
  }

  if (previousBalanceMinor === null) throw new Error('bpi: missing previousBalanceMinor');
  if (paymentsMinor === null) throw new Error('bpi: missing paymentsMinor');
  if (purchasesMinor === null) throw new Error('bpi: missing purchasesMinor');

  // --- Parse transactions ---
  const txns: ParsedTxn[] = [];
  let subAccount: string | null = null;
  let afterInstallmentAmortization = false;

  for (const row of allRows) {
    const items = row.items;

    // Sub-account headers
    const subAccItem = items.find(it => it.x >= 40 && it.x < 70 &&
      (it.s.includes('REWARDS') || it.s.includes('ECREDIT')));
    if (subAccItem) {
      if (subAccItem.s.includes('REWARDS')) subAccount = 'rewards';
      else if (subAccItem.s.includes('ECREDIT')) subAccount = 'ecredit';
      continue;
    }

    // Column header rows (skip)
    if (items.some(it => it.s === 'Transaction') && items.some(it => it.s === 'Amount')) continue;
    if (items.some(it => it.s === 'Date')) continue;

    // Stop at 'Installment Balance Summary'
    if (items.some(it => it.s.includes('Installment Balance Summary'))) break;

    // 'Installment Amortization:' marker
    if (items.some(it => it.s.trim() === 'Installment Amortization:')) {
      afterInstallmentAmortization = true;
      continue;
    }

    // Skip rows without date item (x in range 40-70, not a label)
    const dateItem = items.find(it =>
      it.x >= 40 && it.x < 70 && !it.s.includes('Transaction') && !it.s.includes('Date'));
    if (!dateItem) continue;

    // Skip rows without amount item (x >= 480)
    const amountItem = items.find(it => it.x >= 480);
    if (!amountItem) continue;

    // Skip numeric-only dates (like '073025' in instalment balance table)
    if (/^\d{6}$/.test(dateItem.s.trim())) continue;

    const amount = parseAmountMinor(amountItem.s);
    const dateStr = dateItem.s.trim();
    const dateParts = dateStr.match(/^(\w+)\s+(\d{2})/);
    if (!dateParts) continue;

    const month = MONTH_MAP[titleCase(dateParts[1]!)];
    if (!month) continue;

    const day = dateParts[2]!;
    const monthNum = parseInt(month, 10);
    const year = monthNum > stmtMonth! ? String(stmtYear! - 1) : String(stmtYear!);
    const txnDate = `${year}-${month}-${day}`;

    // Posted date (second date item at x~144)
    const postedItem = items.find(it => it.x >= 130 && it.x < 160);
    let postedDate: string | null = null;
    if (postedItem) {
      const pp = postedItem.s.trim().match(/^(\w+)\s+(\d{2})/);
      if (pp) {
        const pm = MONTH_MAP[titleCase(pp[1]!)];
        if (pm) {
          const pMonthNum = parseInt(pm, 10);
          const pYear = pMonthNum > stmtMonth! ? String(stmtYear! - 1) : String(stmtYear!);
          postedDate = `${pYear}-${pm}-${pp[2]!}`;
        }
      }
    }

    // Description
    const descItem = items.find(it => it.x >= 200 && it.x < 260);
    const description = descItem?.s.trim() ?? '';

    // Determine kind
    let kind: ParsedTxn['kind'] = 'purchase';
    let instalmentSeq: string | null = null;
    let merchant = description;

    if (afterInstallmentAmortization && amount > 0) {
      kind = 'instalment_principal';
      const seqMatch = description.match(/:\s*(\d{2}\/\d{2})$/);
      if (seqMatch) {
        instalmentSeq = seqMatch[1]!;
        merchant = description.replace(/:\s*\d{2}\/\d{2}$/, '').trim();
      }
    } else if (amount < 0) {
      kind = /payment/i.test(description) ? 'payment' : 'credit';
    }

    txns.push({
      txnDate,
      postedDate,
      description,
      merchant,
      amountMinor: amount,
      fxAmountMinor: null,
      fxCurrency: null,
      kind,
      instalmentRef: null,
      instalmentSeq,
      subAccount,
    });
  }

  const periodStart = txns.length > 0 ? txns.map(t => t.txnDate).sort()[0]! : statementDate;

  // Reconciliation warnings
  const warnings: string[] = [];
  const sumTxnAmounts = txns.reduce((s, t) => s + t.amountMinor, 0);
  const expected = totalDueMinor! - previousBalanceMinor;
  if (sumTxnAmounts !== expected) warnings.push(`txn sum ${sumTxnAmounts} != expected ${expected}`);

  return {
    bank: 'bpi',
    accountRef: customerNumber!,
    accountLast4: customerNumber!.slice(-4),
    accountName: accountName!,
    statementDate,
    periodStart,
    periodEnd: statementDate,
    dueDate,
    totals: {
      previousBalanceMinor,
      purchasesMinor,
      paymentsMinor,
      totalDueMinor: totalDueMinor!,
      minDueMinor: minDueMinor!,
    },
    txns,
    warnings,
  };
}
