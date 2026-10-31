/** Gera um PDF de amostra (páginas numeradas, com TrimBox/BleedBox e indicação de cabeça). */
import { PDFDocument, StandardFonts, cmyk, rgb } from 'pdf-lib';
import { mmToPt } from '../core/evidence.js';

export async function pdfAmostra(n: number, w: number, h: number, sangria: number, rotulos: (i: number) => string = (i) => `Página ${i + 1}`): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontR = await doc.embedFont(StandardFonts.Helvetica);
  const W = w + 2 * sangria, H = h + 2 * sangria;
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([mmToPt(W), mmToPt(H)]);
    p.setTrimBox(mmToPt(sangria), mmToPt(sangria), mmToPt(w), mmToPt(h));
    p.setBleedBox(0, 0, mmToPt(W), mmToPt(H));
    // fundo com sangria (cor alterna par/ímpar)
    p.drawRectangle({ x: 0, y: 0, width: mmToPt(W), height: mmToPt(H), color: i % 2 ? cmyk(0.08, 0, 0, 0) : cmyk(0, 0.06, 0.1, 0) });
    // moldura de segurança
    p.drawRectangle({ x: mmToPt(sangria + 8), y: mmToPt(sangria + 8), width: mmToPt(w - 16), height: mmToPt(h - 16), borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
    const t = String(i + 1);
    const size = Math.min(w, h) * 1.2;
    const tw = font.widthOfTextAtSize(t, mmToPt(size) / 2.2);
    p.drawText(t, { x: mmToPt(W / 2) - tw / 2, y: mmToPt(H / 2) - mmToPt(size) / 6, size: mmToPt(size) / 2.2, font, color: rgb(0.1, 0.1, 0.1) });
    p.drawText('▲ cabeça'.replace('▲', '^'), { x: mmToPt(sangria + 12), y: mmToPt(H - sangria - 16), size: 12, font: fontR, color: rgb(0.8, 0.1, 0.1) });
    p.drawText(rotulos(i), { x: mmToPt(sangria + 12), y: mmToPt(sangria + 12), size: 11, font: fontR, color: rgb(0.2, 0.2, 0.2) });
    // indicação da borda de lombada esperada (par = direita, ímpar = esquerda em LTR)
    const lomb = (i + 1) % 2 === 1 ? 'lombada →'.replace('→', '<') : 'lombada >';
    p.drawText(lomb, { x: (i + 1) % 2 === 1 ? mmToPt(sangria + 2) : mmToPt(sangria + w - 22), y: mmToPt(H / 2), size: 8, font: fontR, color: rgb(0.1, 0.3, 0.8) });
  }
  return doc.save();
}
