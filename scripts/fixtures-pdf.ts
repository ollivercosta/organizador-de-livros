/** PDFs de teste: páginas duplas, livreto impresso (pares de impressão) e arquivo grande. */
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mmToPt } from '../src/core/evidence.js';

const dir = process.argv[2] ?? 'out';
async function spreadsPdf(pares: Array<[number | null, number | null]>, w: number, h: number, s: number) {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const [a, b] of pares) {
    const dupla = a !== null && b !== null;
    const W = (dupla ? 2 * w : w) + 2 * s, H = h + 2 * s;
    const p = doc.addPage([mmToPt(W), mmToPt(H)]);
    p.setTrimBox(mmToPt(s), mmToPt(s), mmToPt(dupla ? 2 * w : w), mmToPt(h));
    p.setBleedBox(0, 0, mmToPt(W), mmToPt(H));
    const num = (n: number, x0: number) => {
      p.drawRectangle({ x: mmToPt(x0), y: 0, width: mmToPt(w + s), height: mmToPt(H), color: n % 2 ? rgb(1, 0.95, 0.9) : rgb(0.9, 0.96, 1) });
      p.drawText(String(n), { x: mmToPt(x0 + w / 2 - 15), y: mmToPt(H / 2), size: 90, font: f, color: rgb(0.1, 0.1, 0.1) });
    };
    if (dupla) { num(a!, 0); num(b!, s + w); } else num((a ?? b)!, 0);
  }
  return doc.save();
}
// 32 pp em duplas de leitura: 1 · 2|3 … 30|31 · 32
const leitura: Array<[number | null, number | null]> = [[1, null]];
for (let p = 2; p < 32; p += 2) leitura.push([p, p + 1]);
leitura.push([32, null]);
writeFileSync(`${dir}/teste-duplas-32pp.pdf`, await spreadsPdf(leitura, 160, 230, 3));
// livreto impresso (grampo canoa, 32 pp): 32|1, 2|31, 30|3, 4|29 …
const livreto: Array<[number, number]> = [];
for (let j = 0; j < 8; j++) { livreto.push([32 - 2 * j, 1 + 2 * j]); livreto.push([2 + 2 * j, 31 - 2 * j]); }
writeFileSync(`${dir}/teste-livreto-32pp.pdf`, await spreadsPdf(livreto, 160, 230, 3));
// grande: 300 páginas simples
const { pdfAmostra } = await import('../src/pdf/amostra.js');
writeFileSync(`${dir}/teste-300pp.pdf`, await pdfAmostra(300, 140, 210, 3));
console.log('ok');
