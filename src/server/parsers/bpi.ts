import type { Page, ParsedStatement, ParsedTxn } from './types';

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04',
  May: '05', Jun: '06', Jul: '07', Aug: '08',
  Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  January: '01', February: '02', March: '03', April: '04',
  June: '06', July: '07', August: '08', September: '09',
  October: '10', November: '11', December: '12',
};

const AMOUNT_RE = /^-?[\d,]+\.\d{2}$/;
const AMOUNT_GLOBAL_RE = /-?[\d,]+\.\d{2}/g;
const CARDHOLDER_LINE_RE = /^\d{4,6}-\d-\d{2}-\d{5,8}\s*-\s*(.+)$/;
const BOILERPLATE_PREFIXES = [
  'BPICC',
  'SOAALL',
  'Prepared for',
  'Reference No',
  'Statement of Account',
  'Customer Number',
  'BPI Credit Cards',
  'Card Type',
  'Previous',
  'Total',
  'Past Due',
  'Minimum',
  'Unbilled',
  'REWARDS',
  'Please ',
  'All ',
  'To view ',
];
const HEADER_LABELS = new Set([
  'CUSTOMER NUMBER',
  'STATEMENT DATE',
  'PAYMENT DUE DATE',
  'CREDIT LIMIT',
  'TOTAL AMOUNT DUE',
  'MINIMUM AMOUNT DUE',
]);

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function parseFullDate(dateStr: string): { iso: string; month: number; year: number } {
  const m = dateStr.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) throw new Error(`bpi: invalid date "${dateStr}"`);
  const month = MONTH_MAP[titleCase(m[1]!)];
  if (!month) throw new Error(`bpi: unknown month "${m[1]}"`);
  const day = m[2]!.padStart(2, '0');
  const year = parseInt(m[3]!, 10);
  return { iso: `${year}-${month}-${day}`, month: parseInt(month, 10), year };
}

function parseMonthDay(
  dateStr: string,
  stmtMonth: number,
  stmtYear: number,
  futureBias = false,
): string {
  // Full date with year: "SEPTEMBER 14, 2026"
  const m = dateStr.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTH_MAP[titleCase(m[1]!)];
    if (!month) throw new Error(`bpi: unknown month "${m[1]}"`);
    const day = m[2]!.padStart(2, '0');
    return `${m[3]}-${month}-${day}`;
  }
  // Month + day without year: "August 15"
  const m2 = dateStr.trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (m2) {
    const month = MONTH_MAP[titleCase(m2[1]!)];
    if (!month) throw new Error(`bpi: unknown month "${m2[1]}"`);
    const day = m2[2]!.padStart(2, '0');
    const monthNum = parseInt(month, 10);
    const year = futureBias
      ? (monthNum < stmtMonth ? String(stmtYear + 1) : String(stmtYear))
      : (monthNum > stmtMonth ? String(stmtYear - 1) : String(stmtYear));
    return `${year}-${month}-${day}`;
  }
  throw new Error(`bpi: invalid date "${dateStr}"`);
}

function parseAmountMinor(str: string): number {
  const cleaned = str.replace(/[^0-9.-]/g, '');
  return Math.round(parseFloat(cleaned) * 100);
}

type NormalizedRow = {
  pageIndex: number;
  y: number;
  items: { x: number; s: string }[];
};

function normalizeRows(pages: Page[]): NormalizedRow[] {
  const allRows: NormalizedRow[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]!;
    const sorted = [...page.rows].sort((a, b) => b.y - a.y);
    const merged: NormalizedRow[] = [];
    for (const row of sorted) {
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(prev.y - row.y) <= 2) {
        prev.items.push(...row.items);
        prev.items.sort((a, b) => a.x - b.x);
      } else {
        merged.push({
          pageIndex,
          y: row.y,
          items: [...row.items].sort((a, b) => a.x - b.x),
        });
      }
    }
    allRows.push(...merged);
  }
  return allRows;
}

function joinItems(items: readonly { x: number; s: string }[]): string {
  return items
    .map(it => it.s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBoilerplateName(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed || trimmed.length < 2) return true;
  if (/^[*0-9]/.test(trimmed)) return true;
  if (HEADER_LABELS.has(trimmed.toUpperCase())) return true;
  for (const prefix of BOILERPLATE_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return true;
  }
  return false;
}

export function parseBpi(pages: Page[]): ParsedStatement {
  const allRows = normalizeRows(pages);

  // --- Parse header info ---
  let customerNumber: string | null = null;
  let statementDate: string | null = null;
  let dueDateRaw: string | null = null;
  let totalDueMinor: number | null = null;
  let minDueMinor: number | null = null;

  let stmtMonth: number | null = null;
  let stmtYear: number | null = null;

  for (const row of allRows) {
    const rightItems = row.items.filter(it => it.x >= 250);
    const candidates = rightItems.length > 0
      ? [joinItems(rightItems), joinItems(row.items)]
      : [joinItems(row.items)];

    for (const text of candidates) {
      if (!customerNumber) {
        const m = text.match(/\bCUSTOMER\s+NUMBER\s*:?\s*([0-9][0-9A-Z-]{5,})/i);
        if (m) customerNumber = m[1]!.trim();
      }
      if (!statementDate) {
        const m = text.match(/\bSTATEMENT\s+DATE\s*:?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
        if (m) {
          const parsed = parseFullDate(m[1]!);
          statementDate = parsed.iso;
          stmtMonth = parsed.month;
          stmtYear = parsed.year;
        }
      }
      if (!dueDateRaw) {
        const m = text.match(/\bPAYMENT\s+DUE\s+DATE\s*:?\s*([A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?)/i);
        if (m) dueDateRaw = m[1]!.trim();
      }
      if (totalDueMinor === null) {
        const m = text.match(/\bTOTAL\s+AMOUNT\s+DUE\s*:?\s*(-?[\d,]+\.\d{2})/i);
        if (m) totalDueMinor = parseAmountMinor(m[1]!);
      }
      if (minDueMinor === null) {
        const m = text.match(/\bMINIMUM\s+AMOUNT\s+DUE\s*:?\s*(-?[\d,]+\.\d{2})/i);
        if (m) minDueMinor = parseAmountMinor(m[1]!);
      }
    }
  }

  // --- Parse account / cardholder name ---
  let accountName: string | null = null;

  // 1. Check page 1 left-side address block (before the summary table)
  let sawPreparedHeader = false;
  for (const row of allRows) {
    if (row.pageIndex !== 0) break;
    const fullText = joinItems(row.items);
    if (/\bCard\s+Type\b/i.test(fullText) || /\bPrevious\s+Balance\b/i.test(fullText)) break;

    const leftItems = row.items.filter(it => it.x < 250);
    if (leftItems.length === 0) continue;

    for (const it of leftItems) {
      const s = it.s.trim();
      if (/^(Prepared for|Reference No)/i.test(s)) {
        sawPreparedHeader = true;
        continue;
      }
      if (isBoilerplateName(s)) continue;
      if (sawPreparedHeader || (it.x >= 20 && it.x <= 80)) {
        if (/[A-Za-z]{2,}/.test(s)) {
          accountName = s;
          break;
        }
      }
    }
    if (accountName) break;
  }

  // 2. Fallback: cardholder line on transaction pages ("548809-3-70-7335902 - LIPTON D ABILLAR")
  if (!accountName) {
    for (const row of allRows) {
      const text = joinItems(row.items);
      const m = text.match(CARDHOLDER_LINE_RE);
      if (m && m[1]!.trim()) {
        accountName = m[1]!.trim();
        break;
      }
    }
  }

  // 3. Fallback: card type label or generic BPI Credit Card
  if (!accountName) {
    for (const row of allRows) {
      const leftText = joinItems(row.items.filter(it => it.x < 200));
      if (/\bBPI\b/i.test(leftText) && !/BPI Credit Cards/i.test(leftText) && !/BPI Points/i.test(leftText)) {
        accountName = leftText;
        break;
      }
    }
  }
  if (!accountName) accountName = 'BPI Credit Card';

  if (!customerNumber) throw new Error('bpi: missing customer number');
  if (!statementDate) throw new Error('bpi: missing statementDate');
  if (stmtMonth === null) throw new Error('bpi: missing statementMonth');
  if (stmtYear === null) throw new Error('bpi: missing statementYear');
  if (!dueDateRaw) throw new Error('bpi: missing dueDate');
  const dueDate = parseMonthDay(dueDateRaw, stmtMonth, stmtYear, true);
  if (totalDueMinor === null) throw new Error('bpi: missing totalDueMinor');
  if (minDueMinor === null) throw new Error('bpi: missing minDueMinor');

  // --- Parse summary table ---
  let previousBalanceMinor: number | null = null;
  let paymentsMinor: number | null = null;
  let purchasesMinor: number | null = null;

  for (const row of allRows) {
    const labelItem = row.items.find(it => it.x < 120 && /^total\b/i.test(it.s.trim()));
    if (!labelItem) continue;
    // Skip "Total Outstanding Balance" or "Total Amount Due"
    if (/^total\s+[a-z]/i.test(labelItem.s.trim())) continue;

    const afterItems = row.items.filter(it => it.x >= labelItem.x);
    const rowText = joinItems(afterItems);
    const afterTotal = rowText.replace(/^total\b/i, '').trim();
    const amounts = [...afterTotal.matchAll(AMOUNT_GLOBAL_RE)].map(m => m[0]);
    if (amounts.length >= 3) {
      previousBalanceMinor = parseAmountMinor(amounts[0]!);
      const payAbs = Math.abs(parseAmountMinor(amounts[1]!));
      paymentsMinor = payAbs === 0 ? 0 : -payAbs;
      purchasesMinor = parseAmountMinor(amounts[2]!);
      break;
    }
  }

  if (previousBalanceMinor === null) throw new Error('bpi: missing previousBalanceMinor');
  if (paymentsMinor === null) throw new Error('bpi: missing paymentsMinor');
  if (purchasesMinor === null) throw new Error('bpi: missing purchasesMinor');

  // --- Parse transactions ---
  const txns: ParsedTxn[] = [];
  let subAccount: string | null = null;
  let inInstallmentPurchase = false;
  let afterInstallmentAmortization = false;

  // Dynamic column anchors (learned from the Transaction / Post Date / Description / Amount header)
  let postDateColX = 144;
  let descColX = 220;
  let amountColX = 500;

  for (const row of allRows) {
    const items = row.items;
    const rowText = joinItems(items);

    // Sub-account headers (e.g. "BPI REWARDS CARD", "BPI ECREDIT CARD")
    const leftUpperItems = items.filter(it => it.x < 150);
    const leftText = joinItems(leftUpperItems);
    if (leftText.includes('REWARDS') || leftText.includes('ECREDIT')) {
      if (leftText.includes('REWARDS')) subAccount = 'rewards';
      else if (leftText.includes('ECREDIT')) subAccount = 'ecredit';
      inInstallmentPurchase = false;
      afterInstallmentAmortization = false;
      continue;
    }

    // Column header rows (capture column positions and skip)
    if (items.some(it => /\bTransaction\b/.test(it.s)) && items.some(it => /\bAmount\b/.test(it.s))) {
      const postHdr = items.find(it => /Post/i.test(it.s));
      const descHdr = items.find(it => /Description/i.test(it.s));
      const amtHdr = items.find(it => /Amount/i.test(it.s));
      if (postHdr) postDateColX = postHdr.x;
      if (descHdr) descColX = descHdr.x;
      if (amtHdr) amountColX = amtHdr.x;
      inInstallmentPurchase = false;
      afterInstallmentAmortization = false;
      continue;
    }
    if (items.some(it => it.s.trim() === 'Date' && it.x < 120)) continue;

    // Stop at 'Installment Balance Summary'
    if (rowText.includes('Installment Balance Summary')) break;

    // Cardholder separator resets installment section flags
    if (CARDHOLDER_LINE_RE.test(rowText)) {
      inInstallmentPurchase = false;
      afterInstallmentAmortization = false;
      continue;
    }

    // 'Installment Purchase:' marker (informational only; total is not billed this cycle)
    if (/\bInstallment\s+Purchase:/i.test(rowText)) {
      inInstallmentPurchase = true;
      afterInstallmentAmortization = false;
      continue;
    }

    // 'Installment Amortization:' marker (monthly installment billed this cycle)
    if (/\bInstallment\s+Amortization:/i.test(rowText)) {
      inInstallmentPurchase = false;
      afterInstallmentAmortization = true;
      continue;
    }

    if (inInstallmentPurchase) continue;

    const postMinX = postDateColX - 20;
    const descMinX = descColX - 25;
    const amountMinX = amountColX - 55;

    // Transaction date on the left side
    const dateItems = items.filter(it => it.x < postMinX);
    if (dateItems.length === 0) continue;
    const dateStr = joinItems(dateItems);
    if (/^\d{6}$/.test(dateStr)) continue;

    const dateParts = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2})\b/);
    if (!dateParts) continue;

    const month = MONTH_MAP[titleCase(dateParts[1]!)];
    if (!month) continue;

    // Amount in the right-hand Amount column
    const amountItems = items.filter(it => it.x >= amountMinX);
    const amountItem = [...amountItems].reverse().find(it => AMOUNT_RE.test(it.s.trim()));
    if (!amountItem) continue;

    const amount = parseAmountMinor(amountItem.s);
    const day = dateParts[2]!.padStart(2, '0');
    const monthNum = parseInt(month, 10);
    const year = monthNum > stmtMonth ? String(stmtYear - 1) : String(stmtYear);
    const txnDate = `${year}-${month}-${day}`;

    // Posted date
    const postedItems = items.filter(it => it.x >= postMinX && it.x < descMinX);
    let postedDate: string | null = null;
    if (postedItems.length > 0) {
      const pp = joinItems(postedItems).match(/^([A-Za-z]+)\s+(\d{1,2})\b/);
      if (pp) {
        const pm = MONTH_MAP[titleCase(pp[1]!)];
        if (pm) {
          const pMonthNum = parseInt(pm, 10);
          const pYear = pMonthNum > stmtMonth ? String(stmtYear - 1) : String(stmtYear);
          postedDate = `${pYear}-${pm}-${pp[2]!.padStart(2, '0')}`;
        }
      }
    }

    // Description (everything between posted date column and amount item)
    const descItems = items.filter(
      it => it.x >= descMinX && it !== amountItem && it.x < amountItem.x - 2,
    );
    const description = joinItems(descItems);

    // Determine kind
    let kind: ParsedTxn['kind'] = 'purchase';
    let instalmentSeq: string | null = null;
    let merchant = description;

    if (afterInstallmentAmortization && amount > 0) {
      kind = 'instalment_principal';
      const seqMatch = description.match(/:\s*(\d{1,2}\/\d{1,2})$/);
      if (seqMatch) {
        instalmentSeq = seqMatch[1]!;
        merchant = description.replace(/:\s*\d{1,2}\/\d{1,2}$/, '').trim();
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
  const expected = totalDueMinor - previousBalanceMinor;
  if (sumTxnAmounts !== expected) warnings.push(`txn sum ${sumTxnAmounts} != expected ${expected}`);

  return {
    bank: 'bpi',
    accountRef: customerNumber,
    accountLast4: customerNumber.slice(-4),
    accountName,
    statementDate,
    periodStart,
    periodEnd: statementDate,
    dueDate,
    totals: {
      previousBalanceMinor,
      purchasesMinor,
      paymentsMinor,
      totalDueMinor,
      minDueMinor,
    },
    txns,
    warnings,
  };
}
