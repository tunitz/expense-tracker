import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { openDb } from '../db';
import { register } from '../auth';
import type { AppEnv } from '../app';
import { documentsRoutes } from '../routes/documents';
import { extractPages } from './extract';
import { parseBpi } from './bpi';
import type { Page } from './types';

function makeBpiPdf(pagesContent: string[]): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pagesContent.length} /Kids [${pagesContent.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const content of pagesContent) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((value, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${value}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function pdfText(x: number, y: number, value: string, fontSize = 8, charSpacing = 0): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const tc = charSpacing !== 0 ? `${charSpacing} Tc ` : '';
  const resetTc = charSpacing !== 0 ? ' 0 Tc' : '';
  return `BT /F1 ${fontSize} Tf 1 0 0 1 ${x} ${y} Tm ${tc}(${escaped}) Tj${resetTc} ET\n`;
}

// Mirrors the Nov 15, 2026 BPI SOAALL statement layout (with Prepared for, Reference No.,
// rotated left-margin spool ID, non-36 x-offset, Installment Purchase + Amortization, etc.)
function nov2026BpiPages(opts?: {
  nameX?: number;
  summaryShiftX?: number;
  yJitter?: boolean;
  splitHeaderItems?: boolean;
}): Page[] {
  const nameX = opts?.nameX ?? 38;
  const shift = opts?.summaryShiftX ?? 0;
  const jitter = opts?.yJitter ? 1 : 0;

  const headerRows = opts?.splitHeaderItems
    ? [
        { y: 642, items: [{ x: 323, s: 'CUSTOMER' }, { x: 368, s: 'NUMBER' }] },
        { y: 642 + jitter, items: [{ x: 468, s: '020100-4-10-6902118' }] },
        { y: 628, items: [{ x: 323, s: 'STATEMENT' }, { x: 372, s: 'DATE' }, { x: 468, s: 'NOVEMBER' }, { x: 520, s: '15, 2026' }] },
        { y: 621, items: [{ x: 24, s: 'SOAALL_NOV1326_A 44337' }, { x: nameX, s: 'LIPTON D ABILLAR' }] },
        { y: 614, items: [{ x: nameX, s: '* 611 Real St Pob Zone 1' }, { x: 323, s: 'PAYMENT DUE DATE' }, { x: 472, s: 'DECEMBER 7, 2026' }] },
        { y: 600, items: [{ x: nameX + 14, s: 'Capoocan' }, { x: 323, s: 'CREDIT LIMIT' }, { x: 520, s: '180,000.00' }] },
        { y: 586, items: [{ x: nameX + 14, s: '6530 Leyte' }, { x: 323, s: 'TOTAL AMOUNT DUE' }] },
        { y: 586 + jitter, items: [{ x: 526, s: '2,672.22' }] },
        { y: 572, items: [{ x: 323, s: 'MINIMUM AMOUNT DUE' }, { x: 537, s: '850.00' }] },
      ]
    : [
        { y: 642, items: [{ x: 323, s: 'CUSTOMER NUMBER' }, { x: 468, s: '020100-4-10-6902118' }] },
        { y: 628, items: [{ x: 323, s: 'STATEMENT DATE' }, { x: 468, s: 'NOVEMBER 15, 2026' }] },
        { y: 621, items: [{ x: 24, s: 'SOAALL_NOV1326_A 44337' }, { x: nameX, s: 'LIPTON D ABILLAR' }] },
        { y: 614, items: [{ x: nameX, s: '* 611 Real St Pob Zone 1' }, { x: 323, s: 'PAYMENT DUE DATE' }, { x: 472, s: 'DECEMBER 7, 2026' }] },
        { y: 600, items: [{ x: nameX + 14, s: 'Capoocan' }, { x: 323, s: 'CREDIT LIMIT' }, { x: 520, s: '180,000.00' }] },
        { y: 586, items: [{ x: nameX + 14, s: '6530 Leyte' }, { x: 323, s: 'TOTAL AMOUNT DUE' }, { x: 526, s: '2,672.22' }] },
        { y: 572, items: [{ x: 323, s: 'MINIMUM AMOUNT DUE' }, { x: 537, s: '850.00' }] },
      ];

  return [
    {
      rows: [
        { y: 660, items: [{ x: nameX, s: 'Prepared for' }] },
        { y: 652, items: [{ x: nameX, s: 'Reference No. 118A6902-4' }] },
        ...headerRows,
        {
          y: 510,
          items: [
            { x: 42, s: 'Card Type' },
            { x: 120, s: 'Previous Balance' },
          ],
        },
        {
          y: 480,
          items: [
            { x: 42, s: 'BPI Rewards' },
            { x: 138 + shift, s: '3,061.67' },
            { x: 203 + shift, s: '3,061.67' },
            { x: 283 + shift, s: '0.00' },
            { x: 335 + shift, s: '2,672.22' },
            { x: 410 + shift, s: '0.00' },
            { x: 470 + shift, s: '0.00' },
            { x: 535 + shift, s: '2,672.22' },
          ],
        },
        {
          y: 360,
          items: [
            { x: 42, s: 'Total' },
            { x: 138 + shift, s: '3,061.67' },
            { x: 203 + shift, s: '3,061.67' },
            { x: 283 + shift, s: '0.00' },
            { x: 335 + shift, s: '2,672.22' },
            { x: 410 + shift, s: '0.00' },
            { x: 470 + shift, s: '0.00' },
            { x: 535 + shift, s: '2,672.22' },
          ],
        },
        { y: 345, items: [{ x: 42, s: 'Past Due Amount' }, { x: 550, s: '0.00' }] },
        { y: 335, items: [{ x: 42, s: 'Minimum Amount Due' }, { x: 540, s: '850.00' }] },
        { y: 325, items: [{ x: 42, s: 'Unbilled Installment Amount' }, { x: 532, s: '10,781.90' }] },
        { y: 315, items: [{ x: 42, s: 'Total Outstanding Balance' }, { x: 532, s: '13,454.12' }] },
        { y: 290, items: [{ x: 270, s: 'REWARDS' }] },
      ],
    },
    { rows: [] },
    {
      rows: [
        { y: 710, items: [{ x: 36, s: 'Statement of Account' }] },
        { y: 700, items: [{ x: 36, s: 'Customer Number 020100-4-10-6902118' }] },
      ],
    },
    {
      rows: [
        { y: 710, items: [{ x: 36, s: 'Statement of Account' }] },
        { y: 700, items: [{ x: 36, s: 'Customer Number 020100-4-10-6902118' }] },
        { y: 620, items: [{ x: 54, s: 'BPI REWARDS CARD' }] },
        {
          y: 585,
          items: [
            { x: 54, s: 'Transaction' },
            { x: 144, s: 'Post Date' },
            { x: 220, s: 'Description' },
            { x: 500, s: 'Amount' },
          ],
        },
        { y: 575, items: [{ x: 54, s: 'Date' }] },
        {
          y: 555,
          items: [
            { x: 54, s: 'October 29' },
            { x: 144, s: 'October 29' },
            { x: 220, s: 'Payment - Thank You' },
            { x: 495, s: '-3,061.67' },
          ],
        },
        { y: 543, items: [{ x: 220, s: 'Finance Charge' }, { x: 512, s: '0.00' }] },
        { y: 525, items: [{ x: 220, s: 'Previous Balance' }, { x: 498, s: '3,061.67' }] },
        { y: 515, items: [{ x: 220, s: 'Past Due' }, { x: 512, s: '0.00' }] },
        { y: 505, items: [{ x: 220, s: 'Ending Balance' }, { x: 498, s: '2,672.22' }] },
        { y: 495, items: [{ x: 220, s: 'Unbilled Installment Amount' }, { x: 493, s: '10,781.90' }] },
        { y: 452, items: [{ x: 54, s: '548809-3-70-7335902 - LIPTON D ABILLAR' }] },
        { y: 432, items: [{ x: 220, s: 'Installment Purchase:' }] },
        {
          y: 420,
          items: [
            { x: 54, s: 'November 11' },
            { x: 144, s: 'November 13' },
            { x: 228, s: 'Lazada Ph_O-Ecipp 3m Z Bo: (3 Mos.)' },
            { x: 417, s: '6,204.16' },
          ],
        },
        { y: 408, items: [{ x: 220, s: 'Installment Amortization:' }] },
        {
          y: 396,
          items: [
            { x: 54, s: 'November 13' },
            { x: 144, s: 'November 13' },
            { x: 228, s: 'Powermac-Robinson Ormo Le: 13/24' },
            { x: 505, s: '604.17' },
          ],
        },
        {
          y: 384,
          items: [
            { x: 54, s: 'November 13' },
            { x: 144, s: 'November 13' },
            { x: 228, s: 'Lazada Ph_O-Ecipp 3m Z Bo: 01/03' },
            { x: 499, s: '2,068.05' },
          ],
        },
        { y: 350, items: [{ x: 54, s: 'Installment Balance Summary' }] },
        {
          y: 300,
          items: [
            { x: 54, s: '111025' },
            { x: 126, s: '101427' },
            { x: 204, s: 'Powermac-Robinson Ormo Le' },
            { x: 410, s: '14,500.00' },
            { x: 495, s: '6,645.79' },
          ],
        },
        { y: 276, items: [{ x: 325, s: 'Total' }, { x: 493, s: '10,781.90' }] },
      ],
    },
  ];
}

describe('parseBpi format variations', () => {
  test('parses Nov 2026 SOAALL statement with Prepared for, non-36 x, and rotated margin ID', () => {
    const stmt = parseBpi(nov2026BpiPages());
    expect(stmt.bank).toBe('bpi');
    expect(stmt.accountRef).toBe('020100-4-10-6902118');
    expect(stmt.accountLast4).toBe('2118');
    expect(stmt.accountName).toBe('LIPTON D ABILLAR');
    expect(stmt.statementDate).toBe('2026-11-15');
    expect(stmt.dueDate).toBe('2026-12-07');
    expect(stmt.totals).toEqual({
      previousBalanceMinor: 306167,
      purchasesMinor: 0,
      paymentsMinor: -306167,
      totalDueMinor: 267222,
      minDueMinor: 85000,
    });
    expect(stmt.txns.length).toBe(3);
    expect(stmt.warnings).toEqual([]);

    expect(stmt.txns[0]).toMatchObject({
      txnDate: '2026-10-29',
      postedDate: '2026-10-29',
      merchant: 'Payment - Thank You',
      amountMinor: -306167,
      kind: 'payment',
      subAccount: 'rewards',
    });
    expect(stmt.txns[1]).toMatchObject({
      txnDate: '2026-11-13',
      postedDate: '2026-11-13',
      merchant: 'Powermac-Robinson Ormo Le',
      amountMinor: 60417,
      kind: 'instalment_principal',
      instalmentSeq: '13/24',
      subAccount: 'rewards',
    });
    expect(stmt.txns[2]).toMatchObject({
      txnDate: '2026-11-13',
      postedDate: '2026-11-13',
      merchant: 'Lazada Ph_O-Ecipp 3m Z Bo',
      amountMinor: 206805,
      kind: 'instalment_principal',
      instalmentSeq: '01/03',
      subAccount: 'rewards',
    });
  });

  test('handles shifted summary columns, split header items, and 1pt y-jitter', () => {
    const stmt = parseBpi(
      nov2026BpiPages({
        nameX: 42,
        summaryShiftX: 25,
        yJitter: true,
        splitHeaderItems: true,
      }),
    );
    expect(stmt.accountName).toBe('LIPTON D ABILLAR');
    expect(stmt.statementDate).toBe('2026-11-15');
    expect(stmt.dueDate).toBe('2026-12-07');
    expect(stmt.totals.previousBalanceMinor).toBe(306167);
    expect(stmt.totals.paymentsMinor).toBe(-306167);
    expect(stmt.totals.purchasesMinor).toBe(0);
    expect(stmt.txns.length).toBe(3);
    expect(stmt.warnings).toEqual([]);
  });

  test('handles single-digit days, zero/large summary balances, and multiple sub-accounts', () => {
    const pages: Page[] = [
      {
        rows: [
          { y: 660, items: [{ x: 36, s: 'BPICC_202612' }] },
          { y: 645, items: [{ x: 36, s: 'JANE DOE' }] },
          { y: 640, items: [{ x: 320, s: 'CUSTOMER NUMBER 020100-4-10-1234567' }] },
          { y: 625, items: [{ x: 320, s: 'STATEMENT DATE' }, { x: 460, s: 'DECEMBER 15, 2026' }] },
          { y: 610, items: [{ x: 320, s: 'PAYMENT DUE DATE' }, { x: 460, s: 'JANUARY 5' }] },
          { y: 595, items: [{ x: 320, s: 'TOTAL AMOUNT DUE' }, { x: 510, s: '124,060.95' }] },
          { y: 580, items: [{ x: 320, s: 'MINIMUM AMOUNT DUE' }, { x: 520, s: '3,500.00' }] },
          // Previous balance = 0.00 (shifted far right), Purchases = 123,456.78 (shifted far left)
          {
            y: 450,
            items: [
              { x: 42, s: 'Total' },
              { x: 158, s: '0.00' },
              { x: 222, s: '0.00' },
              { x: 260, s: '123,456.78' },
              { x: 340, s: '604.17' },
              { x: 410, s: '0.00' },
              { x: 470, s: '0.00' },
              { x: 525, s: '124,060.95' },
            ],
          },
        ],
      },
      {
        rows: [
          { y: 700, items: [{ x: 54, s: 'BPI REWARDS CARD' }] },
          {
            y: 680,
            items: [
              { x: 54, s: 'Transaction' },
              { x: 144, s: 'Post Date' },
              { x: 220, s: 'Description' },
              { x: 500, s: 'Amount' },
            ],
          },
          { y: 660, items: [{ x: 220, s: 'Installment Amortization:' }] },
          {
            y: 645,
            items: [
              { x: 54, s: 'December 5' },
              { x: 144, s: 'December 6' },
              { x: 228, s: 'Powermac: 14/24' },
              { x: 505, s: '604.17' },
            ],
          },
          { y: 610, items: [{ x: 54, s: 'BPI ECREDIT CARD' }] },
          {
            y: 590,
            items: [
              { x: 54, s: 'December 8' },
              { x: 144, s: 'December 9' },
              { x: 220, s: 'BIG ONLINE PURCHASE' },
              { x: 474, s: '123,456.78' },
            ],
          },
        ],
      },
    ];

    const stmt = parseBpi(pages);
    expect(stmt.accountName).toBe('JANE DOE');
    expect(stmt.dueDate).toBe('2027-01-05');
    expect(stmt.totals).toEqual({
      previousBalanceMinor: 0,
      purchasesMinor: 12345678,
      paymentsMinor: 0,
      totalDueMinor: 12406095,
      minDueMinor: 350000,
    });
    expect(stmt.txns.length).toBe(2);
    expect(stmt.txns[0]).toMatchObject({
      txnDate: '2026-12-05',
      postedDate: '2026-12-06',
      kind: 'instalment_principal',
      instalmentSeq: '14/24',
      subAccount: 'rewards',
    });
    // ECREDIT purchase after REWARDS Installment Amortization must be 'purchase', not instalment
    expect(stmt.txns[1]).toMatchObject({
      txnDate: '2026-12-08',
      postedDate: '2026-12-09',
      kind: 'purchase',
      amountMinor: 12345678,
      subAccount: 'ecredit',
    });
    expect(stmt.warnings).toEqual([]);
  });

  test('end-to-end PDF upload via POST /documents accepts Nov 2026 BPI statement', async () => {
    const page1 =
      pdfText(38, 660, 'Prepared for') +
      pdfText(38, 652, 'Reference No. 118A6902-4') +
      pdfText(323, 642, 'CUSTOMER NUMBER') + pdfText(468, 642, '020100-4-10-6902118') +
      pdfText(323, 628, 'STATEMENT DATE') + pdfText(468, 628, 'NOVEMBER 15, 2026') +
      pdfText(38, 621, 'LIPTON D ABILLAR') +
      pdfText(38, 614, '* 611 Real St Pob Zone 1') + pdfText(323, 614, 'PAYMENT DUE DATE') + pdfText(472, 614, 'DECEMBER 7, 2026') +
      pdfText(52, 600, 'Capoocan') + pdfText(323, 600, 'CREDIT LIMIT') + pdfText(520, 600, '180,000.00') +
      pdfText(52, 586, '6530 Leyte') + pdfText(323, 586, 'TOTAL AMOUNT DUE') + pdfText(526, 586, '2,672.22') +
      pdfText(323, 572, 'MINIMUM AMOUNT DUE') + pdfText(537, 572, '850.00') +
      pdfText(42, 480, 'BPI Rewards') + pdfText(138, 480, '3,061.67') + pdfText(203, 480, '3,061.67') + pdfText(283, 480, '0.00') + pdfText(335, 480, '2,672.22') + pdfText(410, 480, '0.00') + pdfText(470, 480, '0.00') + pdfText(535, 480, '2,672.22') +
      pdfText(42, 360, 'Total') + pdfText(138, 360, '3,061.67') + pdfText(203, 360, '3,061.67') + pdfText(283, 360, '0.00') + pdfText(335, 360, '2,672.22') + pdfText(410, 360, '0.00') + pdfText(470, 360, '0.00') + pdfText(535, 360, '2,672.22');

    const page4 =
      pdfText(36, 710, 'Statement of Account') +
      pdfText(36, 700, 'Customer Number 020100-4-10-6902118') +
      pdfText(54, 620, 'BPI REWARDS CARD') +
      pdfText(54, 585, 'Transaction') + pdfText(144, 585, 'Post Date') + pdfText(220, 585, 'Description') + pdfText(500, 585, 'Amount') +
      pdfText(54, 575, 'Date') +
      pdfText(54, 555, 'October 29') + pdfText(144, 555, 'October 29') + pdfText(220, 555, 'Payment - Thank You') + pdfText(495, 555, '-3,061.67') +
      pdfText(54, 452, '548809-3-70-7335902 - LIPTON D ABILLAR') +
      pdfText(220, 432, 'Installment Purchase:') +
      pdfText(54, 420, 'November 11') + pdfText(144, 420, 'November 13') + pdfText(228, 420, 'Lazada Ph_O-Ecipp 3m Z Bo: (3 Mos.)') + pdfText(417, 420, '6,204.16') +
      pdfText(220, 408, 'Installment Amortization:') +
      pdfText(54, 396, 'November 13') + pdfText(144, 396, 'November 13') + pdfText(228, 396, 'Powermac-Robinson Ormo Le: 13/24') + pdfText(505, 396, '604.17') +
      pdfText(54, 384, 'November 13') + pdfText(144, 384, 'November 13') + pdfText(228, 384, 'Lazada Ph_O-Ecipp 3m Z Bo: 01/03') + pdfText(499, 384, '2,068.05') +
      pdfText(54, 350, 'Installment Balance Summary') +
      pdfText(325, 276, 'Total') + pdfText(493, 276, '10,781.90');

    const pdfBytes = makeBpiPdf([page1, '', '', page4]);
    const pages = await extractPages(pdfBytes);
    const parsed = parseBpi(pages);
    expect(parsed.txns.length).toBe(3);
    expect(parsed.warnings).toEqual([]);

    const db = openDb(':memory:');
    const user = await register(db, 'bpi@test.com', 'password123');
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('user', { id: user.id, email: user.email });
      await next();
    });
    app.route('/documents', documentsRoutes(db));

    const form = new FormData();
    form.set('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'bpi-nov-2026.pdf');
    const res = await app.request('/documents', { method: 'POST', body: form });
    expect(res.status).toBe(201);
    const body = await res.json() as { bank: string; accountLast4: string; added: number; warnings: string[] };
    expect(body).toMatchObject({
      bank: 'bpi',
      accountLast4: '2118',
      added: 3,
      warnings: [],
    });
    db.close();
  });

  test('extracts and uploads letter-spaced (high Tc) BPI SOAALL PDF with accurate format and categories', async () => {
    // Reproduces real BPI BE*.pdf streams where every word uses large PDF charSpacing (Tc >= 0.102 * fontSize),
    // which causes pdf.js getTextContent() to inject spaces between every character and merge adjacent words.
    const w = (x: number, y: number, s: string, sz = 6.25, tc = 1.5) => pdfText(x, y, s, sz, tc);

    const page1 =
      w(36, 659, 'Prepared', 5.11, 1.3) + w(70, 659, 'for', 5.11, 1.05) +
      w(36, 650, 'Reference', 5.11, 1.33) + w(74, 650, 'No.', 5.11, 1.35) + w(88, 650, '118A6902-4', 5.11, 1.46) +
      w(324, 641, 'CUSTOMER', 6.85, 2.3) + w(384, 641, 'NUMBER', 6.85, 2.29) + w(469, 641, '020100-4-10-6902118', 6.85, 1.61) +
      w(324, 627, 'STATEMENT', 6.85, 2.19) + w(388, 627, 'DATE', 6.85, 2.15) + w(468, 627, 'NOVEMBER', 6.85, 2.3) + w(528, 627, '15,', 6.85, 1.47) + w(545, 627, '2026', 6.85, 1.71) +
      pdfText(26, 626, 'SOAALL_NOV1326_A 44337', 4.79, 0.3) +
      w(36, 619, 'LIPTON', 8.93, 1.34) + w(79, 619, 'D', 8.93, 1.47) + w(91, 619, 'ABILLAR', 8.93, 1.47) +
      w(36, 606, '*', 9.03, 6.57) + w(50, 606, '611', 7.62, 2) + w(72, 606, 'Real', 7.62, 1.78) +
      w(324, 613, 'PAYMENT', 6.85, 2.23) + w(376, 613, 'DUE', 6.85, 2.22) + w(400, 613, 'DATE', 6.85, 2.15) + w(474, 613, 'DECEMBER', 6.85, 2.26) + w(534, 613, '7,', 6.85, 1.34) + w(545, 613, '2026', 6.85, 1.71) +
      w(324, 598, 'CREDIT', 6.85, 1.99) + w(364, 598, 'LIMIT', 6.85, 1.68) + w(518, 598, '180,000.00', 6.85, 1.56) +
      w(324, 584, 'TOTAL', 6.85, 2.11) + w(360, 584, 'AMOUNT', 6.85, 2.33) + w(406, 584, 'DUE', 6.85, 2.22) + w(529, 584, '2,672.22', 6.85, 1.53) +
      w(324, 570, 'MINIMUM', 6.85, 2.08) + w(372, 570, 'AMOUNT', 6.85, 2.33) + w(419, 570, 'DUE', 6.85, 2.22) + w(537, 570, '850.00', 6.85, 1.59) +
      w(43, 479, 'BPI', 5.11, 1.49) + w(58, 479, 'Rewards', 5.11, 1.47) + w(137, 479, '3,061.67', 5.11, 1.29) + w(203, 479, '3,061.67', 5.11, 1.29) + w(283, 479, '0.00', 5.11, 1.29) + w(331, 479, '2,672.22', 5.11, 1.29) + w(406, 479, '0.00', 5.11, 1.29) + w(483, 479, '0.00', 5.11, 1.29) + w(539, 479, '2,672.22', 5.11, 1.29) +
      w(43, 360, 'Total', 5.11, 1.13) + w(138, 360, '3,061.67', 5.11, 1.29) + w(203, 360, '3,061.67', 5.11, 1.29) + w(283, 360, '0.00', 5.11, 1.29) + w(331, 360, '2,672.22', 5.11, 1.29) + w(406, 360, '0.00', 5.11, 1.29) + w(483, 360, '0.00', 5.11, 1.29) + w(539, 360, '2,672.22', 5.11, 1.29) +
      w(43, 319, 'Total', 5.11, 1.13) + w(62, 319, 'Outstanding', 5.11, 1.31) + w(107, 319, 'Balance', 5.11, 1.3) + w(534, 319, '13,454.12', 5.11, 1.31);

    const page3 =
      pdfText(36, 706, 'Statement of Account', 12.03, 0) +
      w(36, 695, 'Customer', 6.25, 1.56) + w(78, 695, 'Number', 6.25, 1.7) + w(113, 695, '020100-4-10-6902118', 6.25, 1.48);

    const page4 =
      pdfText(36, 659, 'Statement of Account', 12.03, 0) +
      w(36, 648, 'Customer', 6.25, 1.56) + w(78, 648, 'Number', 6.25, 1.7) + w(113, 648, '020100-4-10-6902118', 6.25, 1.48) +
      w(54, 616, 'BPI', 7.4, 1.06) + w(72, 616, 'REWARDS', 7.4, 1.21) + w(121, 616, 'CARD', 7.4, 1.24) +
      w(54, 583, 'Transaction', 7.4, 1.18) + w(144, 583, 'Post', 7.4, 1.22) + w(166, 583, 'Date', 7.4, 1.01) + w(220, 583, 'Description', 7.4, 1.2) + w(504, 583, 'Amount', 7.4, 1.51) +
      w(54, 572, 'Date', 7.4, 1.01) +
      w(54, 551, 'October', 6.25, 1.45) + w(89, 551, '29', 6.25, 1.56) + w(144, 551, 'October', 6.25, 1.45) + w(179, 551, '29', 6.25, 1.56) +
        w(220, 551, 'Payment', 6.25, 1.62) + w(259, 551, '-', 6.25, 1.04) + w(265, 551, 'Thank', 6.25, 1.57) + w(292, 551, 'You', 6.25, 1.65) + w(493, 551, '-3,061.67', 6.25, 1.36) +
      w(54, 450, '548809-3-70-7335902', 7.4, 0.88) + w(147, 450, '-', 7.4, 0.66) + w(152, 450, 'LIPTON', 7.4, 1.1) + w(188, 450, 'D', 7.4, 1.14) + w(198, 450, 'ABILLAR', 7.4, 1.31) +
      w(220, 428, 'Installment', 7.4, 1.18) + w(272, 428, 'Purchase:', 7.4, 1.18) +
      w(54, 417, 'November', 6.25, 1.62) + w(98, 417, '11', 6.25, 1.56) + w(144, 417, 'November', 6.25, 1.62) + w(188, 417, '13', 6.25, 1.56) +
        w(228, 417, 'Lazada', 6.25, 1.5) + w(260, 417, 'Ph_O-Ecipp', 6.25, 1.96) + w(316, 417, '3m', 6.25, 2.14) + w(332, 417, 'Z', 6.25, 1.7) + w(340, 417, 'Bo:', 6.25, 1.43) + w(362, 417, '(3', 6.25, 1.3) + w(373, 417, 'Mos.)', 6.25, 1.43) + w(418, 417, '6,204.16', 6.25, 1.4) +
      w(220, 407, 'Installment', 7.4, 1.18) + w(272, 407, 'Amortization:', 7.4, 1.22) +
      w(54, 396, 'November', 6.25, 1.62) + w(98, 396, '13', 6.25, 1.56) + w(144, 396, 'November', 6.25, 1.62) + w(188, 396, '13', 6.25, 1.56) +
        w(228, 396, 'Powermac-Robinson', 6.25, 1.56) + w(315, 396, 'Ormo', 6.25, 1.91) + w(341, 396, 'Le:', 6.25, 1.26) + w(357, 396, '13/24', 6.25, 1.43) + w(503, 396, '604.17', 6.25, 1.45) +
      w(54, 386, 'November', 6.25, 1.62) + w(98, 386, '13', 6.25, 1.56) + w(144, 386, 'November', 6.25, 1.62) + w(188, 386, '13', 6.25, 1.56) +
        w(228, 386, 'Lazada', 6.25, 1.5) + w(260, 386, 'Ph_O-Ecipp', 6.25, 1.96) + w(316, 386, '3m', 6.25, 2.14) + w(332, 386, 'Z', 6.25, 1.7) + w(340, 386, 'Bo:', 6.25, 1.43) + w(357, 386, '01/03', 6.25, 1.43) + w(496, 386, '2,068.05', 6.25, 1.4) +
      w(58, 353, 'Installment', 7.4, 1.18) + w(109, 353, 'Balance', 7.4, 1.15) + w(146, 353, 'Summary', 7.4, 1.44);

    const pdfBytes = makeBpiPdf([page1, '', page3, page4]);
    const pages = await extractPages(pdfBytes);
    const parsed = parseBpi(pages);

    expect(parsed.accountName).toBe('LIPTON D ABILLAR');
    expect(parsed.accountRef).toBe('020100-4-10-6902118');
    expect(parsed.accountLast4).toBe('2118');
    expect(parsed.statementDate).toBe('2026-11-15');
    expect(parsed.dueDate).toBe('2026-12-07');
    expect(parsed.totals).toEqual({
      previousBalanceMinor: 306167,
      purchasesMinor: 0,
      paymentsMinor: -306167,
      totalDueMinor: 267222,
      minDueMinor: 85000,
    });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.txns).toHaveLength(3);
    expect(parsed.txns[0]).toMatchObject({
      txnDate: '2026-10-29',
      postedDate: '2026-10-29',
      merchant: 'Payment - Thank You',
      amountMinor: -306167,
      kind: 'payment',
      subAccount: 'rewards',
    });
    expect(parsed.txns[1]).toMatchObject({
      txnDate: '2026-11-13',
      postedDate: '2026-11-13',
      merchant: 'Powermac-Robinson Ormo Le',
      amountMinor: 60417,
      kind: 'instalment_principal',
      instalmentSeq: '13/24',
      subAccount: 'rewards',
    });
    expect(parsed.txns[2]).toMatchObject({
      txnDate: '2026-11-13',
      postedDate: '2026-11-13',
      merchant: 'Lazada Ph_O-Ecipp 3m Z Bo',
      amountMinor: 206805,
      kind: 'instalment_principal',
      instalmentSeq: '01/03',
      subAccount: 'rewards',
    });

    const db = openDb(':memory:');
    const user = await register(db, 'bpi-tc@test.com', 'password123');
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('user', { id: user.id, email: user.email });
      await next();
    });
    app.route('/documents', documentsRoutes(db));

    const form = new FormData();
    form.set('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'BE20261114.pdf');
    const res = await app.request('/documents', { method: 'POST', body: form });
    expect(res.status).toBe(201);
    const body = await res.json() as { bank: string; accountLast4: string; status: string; added: number; warnings: string[] };
    expect(body).toMatchObject({
      bank: 'bpi',
      accountLast4: '2118',
      status: 'parsed',
      added: 3,
      warnings: [],
    });

    const rows = db
      .query(
        `SELECT t.merchant, t.kind, t.instalment_seq AS instalmentSeq, t.amount_minor AS amountMinor, c.name AS category
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.user_id = ?
         ORDER BY t.txn_date ASC, t.amount_minor ASC`,
      )
      .all(user.id) as { merchant: string; kind: string; instalmentSeq: string | null; amountMinor: number; category: string | null }[];
    expect(rows).toEqual([
      { merchant: 'Payment - Thank You', kind: 'payment', instalmentSeq: null, amountMinor: -306167, category: null },
      { merchant: 'Powermac-Robinson Ormo Le', kind: 'instalment_principal', instalmentSeq: '13/24', amountMinor: 60417, category: 'Shopping' },
      { merchant: 'Lazada Ph_O-Ecipp 3m Z Bo', kind: 'instalment_principal', instalmentSeq: '01/03', amountMinor: 206805, category: 'Shopping' },
    ]);
    db.close();
  });

  test('still rejects non-BPI PDFs as unsupported_format', () => {
    expect(() => parseBpi([{ rows: [{ y: 700, items: [{ x: 36, s: 'Random Document' }] }] }])).toThrow();
  });
});
