// Public, deterministic UnionBank-shaped PDF; never reads local statements or databases.
import assert from 'node:assert/strict';
import { extractPages } from '../src/server/parsers/extract.ts';
import { parseUnionBank } from '../src/server/parsers/unionbank.ts';

export function statementPdf(pageCount: number, rowsPerPage: number): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let page = 0; page < pageCount; page++) {
    const text = (x: number, y: number, value: string) => `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${value}) Tj ET\n`;
    let content = '';
    if (page === 0) {
      content += text(60, 760, 'UnionBank') + text(60, 747, 'Statement Date: October 02, 2026');
      content += text(60, 734, '****1234') + text(60, 721, 'SAMPLE CUSTOMER');
      content += text(386, 708, 'Previous Balance') + text(386, 695, 'PHP 0.00');
      content += text(386, 682, 'Purchases and Advances') + text(386, 669, `PHP ${pageCount * rowsPerPage}.00`);
      content += text(386, 656, 'Payments & Credits') + text(386, 643, 'PHP 0.00');
      content += text(60, 630, 'Due Date') + text(193, 630, 'Minimum') + text(386, 630, 'Total');
      content += text(60, 617, 'October 19, 2026') + text(193, 617, 'PHP 1.00') + text(386, 617, `PHP ${pageCount * rowsPerPage}.00`);
    }
    content += text(47, 604, 'DATE');
    for (let row = 0; row < rowsPerPage; row++) {
      const y = 591 - row * 13;
      content += text(47, y, 'Sep 25, 2026') + text(132, y, `SAMPLE COFFEE ${page}-${row}`) + text(450, y, '1.00');
    }
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`);
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

if (import.meta.main) {
  const iterations = Number(process.argv[2] ?? 120);
  const pageCount = Number(process.argv[3] ?? 10);
  const rowsPerPage = 25;
  const pdf = statementPdf(pageCount, rowsPerPage);
  async function run() {
    const statement = parseUnionBank(await extractPages(pdf));
    assert.equal(statement.txns.length, pageCount * rowsPerPage);
    assert.deepEqual(statement.warnings, []);
    return statement;
  }
  for (let i = 0; i < 6; i++) await run();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) await run();
  console.log(`${((performance.now() - start) / iterations).toFixed(2)} ms/statement (${pageCount} pages, ${iterations} iterations)`);
}
