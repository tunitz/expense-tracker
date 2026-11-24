import type { Page, ParsedStatement, ParsedTxn } from './types';

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04',
  May: '05', Jun: '06', Jul: '07', Aug: '08',
  Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  January: '01', February: '02', March: '03', April: '04',
  June: '06', July: '07', August: '08', September: '09',
  October: '10', November: '11', December: '12',
};

function parseDate(str: string): string {
  const match = str.match(/^(\w+)\s+(\d{2}),?\s+(\d{4})$/);
  if (!match) throw new Error(`unionbank: invalid date "${str}"`);
  const monthStr = match[1]!;
  const day = match[2]!;
  const year = match[3]!;
  const month = MONTH_MAP[monthStr];
  if (!month) throw new Error(`unionbank: unknown month "${monthStr}"`);
  return `${year}-${month}-${day}`;
}

function parseAmountMinor(str: string): number {
  const cleaned = str.replace(/[^0-9.-]/g, '');
  return Math.round(parseFloat(cleaned) * 100);
}

function stripFx(desc: string): { merchant: string; fxAmountMinor: number | null; fxCurrency: string | null } {
  const m = desc.match(/^(.+?)\s+\(([A-Z]{3})\s+([\d,.]+)\)\s*$/);
  if (m) {
    const merchant = m[1]!.trim();
    const currency = m[2]!;
    const amountMinor = Math.round(parseFloat(m[3]!.replace(/,/g, '')) * 100);
    return { merchant, fxAmountMinor: amountMinor, fxCurrency: currency };
  }
  return { merchant: desc.trim(), fxAmountMinor: null, fxCurrency: null };
}

function processDescription(txn: ParsedTxn, description: string): void {
  let merchantDesc = description;

  // Strip leading instalment prefix "(NN/NN) "
  const seqMatch = description.match(/^\((\d{2}\/\d{2})\)\s+(.+)$/);
  if (seqMatch) {
    txn.instalmentSeq = seqMatch[1]!;
    txn.kind = 'instalment_principal';
    merchantDesc = seqMatch[2]!;
  }

  // Check for instalment principal
  const principalMatch = merchantDesc.match(/^Instalment Principal\s+\((\d{2}\/\d{2})\)\s*\[(\d+)\]/);
  if (principalMatch) {
    txn.kind = 'instalment_principal';
    txn.instalmentSeq = principalMatch[1]!;
    txn.instalmentRef = principalMatch[2]!;
    txn.merchant = `Instalment Principal [${principalMatch[2]!}]`;
    return;
  }

  // Check for instalment interest
  const interestMatch = merchantDesc.match(/^Instalment Interest\s+\((\d{2}\/\d{2})\)\s*\[(\d+)\]/);
  if (interestMatch) {
    txn.kind = 'instalment_interest';
    txn.instalmentSeq = interestMatch[1]!;
    txn.instalmentRef = interestMatch[2]!;
    txn.merchant = `Instalment Interest [${interestMatch[2]!}]`;
    return;
  }

  // Check for instalment processing fee
  if (merchantDesc.match(/^Instalment Processing Fee/)) {
    txn.kind = 'fee';
    txn.merchant = merchantDesc;
    return;
  }

  // Strip FX
  const fxResult = stripFx(merchantDesc);
  txn.merchant = fxResult.merchant;
  txn.fxAmountMinor = fxResult.fxAmountMinor;
  txn.fxCurrency = fxResult.fxCurrency;
}

function hasDateItem(items: readonly { x: number; s: string }[]): boolean {
  return items.some(it => Math.abs(it.x - 47) < 10 && it.s !== 'DATE');
}

function hasAmountItem(items: readonly { x: number; s: string }[]): boolean {
  return items.some(it => it.x > 400);
}

function findDateItem(items: readonly { x: number; s: string }[]): { x: number; s: string } | undefined {
  return items.find(it => Math.abs(it.x - 47) < 10 && it.s !== 'DATE');
}

function findAmountItem(items: readonly { x: number; s: string }[]): { x: number; s: string } | undefined {
  return items.find(it => it.x > 400);
}

function findDescItem(items: readonly { x: number; s: string }[]): { x: number; s: string } | undefined {
  return items.find(it => Math.abs(it.x - 132) < 20);
}

export function parseUnionBank(pages: Page[]): ParsedStatement {
  // Flatten all pages (rows already sorted top-to-bottom)
  const allRows: { y: number; items: readonly { x: number; s: string }[] }[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      allRows.push(row);
    }
  }

  // --- Parse header info ---
  let statementDate: string | null = null;
  let cardLast4: string | null = null;
  let accountName: string | null = null;
  let previousBalanceMinor: number | null = null;
  let purchasesMinor: number | null = null;
  let paymentsMinor: number | null = null;
  let dueDate: string | null = null;
  let minDueMinor: number | null = null;
  let totalDueMinor: number | null = null;

  const knownLabelPatterns = new Set(['NAME', 'CARD', 'NUMBER', 'CREDIT', 'LIMIT', 'PHP', 'SUMMARY']);

  // Statement date
  for (const row of allRows) {
    for (const item of row.items) {
      if (item.s.startsWith('Statement Date:')) {
        statementDate = parseDate(item.s.replace('Statement Date:', '').trim());
      }
    }
  }
  if (!statementDate) throw new Error('unionbank: missing statementDate');

  // Card number: single item at x~60 with * and digits
  for (const row of allRows) {
    const items = row.items;
    if (items.length === 1) {
      const s = items[0]!.s;
      const x = items[0]!.x;
      if (Math.abs(x - 60) < 10) {
        if (s.includes('*') && /\d/.test(s)) {
          const digits = s.replace(/[^0-9]/g, '');
          if (digits.length >= 4) cardLast4 = digits.slice(-4);
        }
      }
    }
  }
  if (!cardLast4) throw new Error('unionbank: missing cardLast4');

  // Account name: single item in header at x~60, all uppercase letters/spaces, not a known label
  for (const row of allRows) {
    const items = row.items;
    if (items.some(it => Math.abs(it.x - 47) < 10 && it.s === 'DATE')) break;
    if (items.length === 1 && Math.abs(items[0]!.x - 60) < 10) {
      const s = items[0]!.s.trim();
      const noSpaces = s.replace(/\s+/g, '');
      if (/^[A-Z\s]+$/.test(s) && !knownLabelPatterns.has(noSpaces)) {
        const isLetterSpaced = /^[A-Z](?:\s[A-Z])+$/.test(s);
        accountName = isLetterSpaced ? noSpaces : s.replace(/\s+/g, ' ');
      }
    }
  }
  if (!accountName) throw new Error('unionbank: missing accountName');

  // Summary labels at x=386 → value in next row at x=386
  const summaryLabels = new Set(['Previous Balance', 'Purchases and Advances', 'Payments & Credits']);
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i]!;
    const labelItem = row.items.find(it => Math.abs(it.x - 386) < 10);
    if (labelItem && summaryLabels.has(labelItem.s.trim())) {
      const label = labelItem.s.trim();
      for (let j = i + 1; j < allRows.length; j++) {
        const nextRow = allRows[j]!;
        const valItem = nextRow.items.find(it => Math.abs(it.x - 386) < 10);
        if (valItem && valItem.s.startsWith('PHP')) {
          const minor = parseAmountMinor(valItem.s);
          if (label === 'Previous Balance') previousBalanceMinor = minor;
          else if (label === 'Purchases and Advances') purchasesMinor = minor;
          else if (label === 'Payments & Credits') paymentsMinor = minor;
          break;
        }
        // Stop if we hit another label at x=386
        if (nextRow.items.find(it => Math.abs(it.x - 386) < 10 && !it.s.startsWith('PHP'))) break;
      }
    }
  }
  if (previousBalanceMinor === null) throw new Error('unionbank: missing previousBalanceMinor');
  if (purchasesMinor === null) throw new Error('unionbank: missing purchasesMinor');
  if (paymentsMinor === null) throw new Error('unionbank: missing paymentsMinor');

  // Due Date row: items at x=60,193,386 with "Due", "Total", then values in next row
  for (let i = 0; i < allRows.length - 1; i++) {
    const row = allRows[i]!;
    const nextRow = allRows[i + 1]!;
    const hasDueLabel = row.items.some(it => Math.abs(it.x - 60) < 10 && it.s.includes('Due'));
    const hasTotalLabel = row.items.some(it => Math.abs(it.x - 386) < 10 && it.s.includes('Total'));
    const hasMinLabel = row.items.some(it => Math.abs(it.x - 193) < 10);
    if (hasDueLabel && hasTotalLabel && hasMinLabel) {
      const ni = nextRow.items;
      const dueItem = ni.find(it => Math.abs(it.x - 60) < 10);
      const minItem = ni.find(it => Math.abs(it.x - 193) < 10);
      const totalItem = ni.find(it => Math.abs(it.x - 386) < 10);
      if (dueItem) dueDate = parseDate(dueItem.s.trim());
      if (minItem && minItem.s.startsWith('PHP')) minDueMinor = parseAmountMinor(minItem.s);
      if (totalItem && totalItem.s.startsWith('PHP')) totalDueMinor = parseAmountMinor(totalItem.s);
    }
  }
  if (dueDate === null) throw new Error('unionbank: missing dueDate');
  if (totalDueMinor === null) throw new Error('unionbank: missing totalDueMinor');

  // --- Parse transactions ---
  const txns: ParsedTxn[] = [];
  let inTransactions = false;
  let currentTxn: ParsedTxn | null = null;

  for (const row of allRows) {
    const items = row.items;

    // Transaction header
    const headerDate = items.find(it => Math.abs(it.x - 47) < 10 && it.s === 'DATE');
    if (headerDate) { inTransactions = true; continue; }
    if (!inTransactions) continue;

    // Transaction row: date at x~47 + amount at x>400
    if (hasDateItem(items) && hasAmountItem(items)) {
      if (currentTxn) txns.push(currentTxn);
      const descItem = findDescItem(items);
      const description = descItem?.s ?? '';
      const dateItem = findDateItem(items);
      const amountItem = findAmountItem(items);
      if (!dateItem || !amountItem) continue;
      currentTxn = {
        txnDate: parseDate(dateItem.s.trim()),
        postedDate: null,
        description,
        merchant: '',
        amountMinor: parseAmountMinor(amountItem.s),
        fxAmountMinor: null,
        fxCurrency: null,
        kind: 'purchase',
        instalmentRef: null,
        instalmentSeq: null,
        subAccount: null,
      };
      processDescription(currentTxn, description);
      // Negative amounts are payments or credits
      if (currentTxn.amountMinor < 0) {
        currentTxn.kind = /payment/i.test(currentTxn.description) ? 'payment' : 'credit';
      }
    } else if (!hasDateItem(items) && currentTxn) {
      // Continuation line: append to description, re-process for FX
      const contItem = findDescItem(items);
      if (contItem) {
        currentTxn.description += ' ' + contItem.s;
        processDescription(currentTxn, currentTxn.description);
      }
    }
    // No date + no current txn → skip (non-transaction row)
  }

  if (currentTxn) txns.push(currentTxn);

  // periodStart = earliest txnDate
  const periodStart = txns.length > 0 ? txns.map(t => t.txnDate).sort()[0]! : statementDate;

  // Reconciliation warnings
  const warnings: string[] = [];
  const sumPositive = txns.filter(t => t.amountMinor > 0).reduce((s, t) => s + t.amountMinor, 0);
  const sumNegative = txns.filter(t => t.amountMinor < 0).reduce((s, t) => s + t.amountMinor, 0);
  if (sumPositive !== purchasesMinor) warnings.push(`purchases mismatch: ${sumPositive} != ${purchasesMinor}`);
  if (sumNegative !== paymentsMinor) warnings.push(`payments mismatch: ${sumNegative} != ${paymentsMinor}`);
  if (previousBalanceMinor + purchasesMinor + paymentsMinor !== totalDueMinor)
    warnings.push(`total due mismatch: ${previousBalanceMinor + purchasesMinor + paymentsMinor} != ${totalDueMinor}`);

  return {
    bank: 'unionbank',
    accountRef: cardLast4,
    accountLast4: cardLast4,
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
      minDueMinor: minDueMinor ?? 0,
    },
    txns,
    warnings,
  };
}
