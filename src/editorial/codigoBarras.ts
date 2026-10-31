/**
 * Código de barras EAN-13 (+ complemento EAN-2/EAN-5) em geometria vetorial (mm).
 *
 * Especificação GS1 usada:
 *  - 95 módulos: guarda 101 · 6 dígitos (L/G conforme o 1º dígito) · guarda central 01010 ·
 *    6 dígitos (R) · guarda 101.
 *  - Módulo nominal (100%) = 0,330 mm; ampliação permitida 80% a 200%.
 *  - Altura nominal das barras = 22,85 mm (guardas +5 módulos); tamanho nominal do símbolo
 *    com margens de silêncio = 37,29 × 25,93 mm.
 *  - Margem de silêncio: 11 módulos à esquerda, 7 à direita.
 *  - Complemento: separado por 7 a 12 módulos (usado 9), início 1011, separador 01.
 *  - Barras escuras (preto 100%) sobre fundo claro; não truncar a altura.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((p) => [...p].map((b) => (b === '0' ? '1' : '0')).join(''));
const G = R.map((p) => [...p].reverse().join(''));
const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const PARIDADE5 = ['GGLLL', 'GLGLL', 'GLLGL', 'GLLLG', 'LGGLL', 'LLGGL', 'LLLGG', 'LGLGL', 'LGLLG', 'LLGLG'];
const PARIDADE2 = ['LL', 'LG', 'GL', 'GG'];

export const MODULO_MM = 0.33;
export const ALTURA_BARRAS_MM = 22.85;

/** Sequência de 95 módulos (1 = barra) do EAN-13. */
export function modulosEan13(ean: string): string {
  if (!/^\d{13}$/.test(ean)) throw new Error('EAN-13 exige 13 dígitos.');
  const par = PARIDADE[Number(ean[0])]!;
  let s = '101';
  for (let i = 1; i <= 6; i++) { const dg = Number(ean[i]); s += par[i - 1] === 'L' ? L[dg] : G[dg]; }
  s += '01010';
  for (let i = 7; i <= 12; i++) s += R[Number(ean[i])];
  return s + '101';
}

export function modulosComplemento(add: string): string {
  if (!/^\d{2}$|^\d{5}$/.test(add)) throw new Error('Complemento tem 2 ou 5 dígitos.');
  let par: string;
  if (add.length === 5) {
    const ck = (3 * (Number(add[0]) + Number(add[2]) + Number(add[4])) + 9 * (Number(add[1]) + Number(add[3]))) % 10;
    par = PARIDADE5[ck]!;
  } else {
    par = PARIDADE2[Number(add) % 4]!;
  }
  let s = '1011';
  [...add].forEach((c, i) => {
    if (i > 0) s += '01';
    s += par[i] === 'L' ? L[Number(c)] : G[Number(c)];
  });
  return s;
}

export interface Barra { x: number; w: number; h: number; y: number }
export interface TextoCodigo { x: number; y: number; texto: string; tamanho: number; ancora: 'start' | 'middle' | 'end' }
export interface GeometriaCodigo {
  largura: number; altura: number; ampliacao: number; modulo: number;
  barras: Barra[]; textos: TextoCodigo[];
}

/** Geometria completa (inclui margens de silêncio e o rótulo superior), origem no canto superior esquerdo. */
export function geometriaEan13(ean: string, ampliacao = 1, complemento?: string, rotuloSuperior?: string): GeometriaCodigo {
  const m = MODULO_MM * ampliacao;
  const hBarras = ALTURA_BARRAS_MM * ampliacao;
  const hGuarda = 5 * m;
  const fonte = 2.75 * ampliacao; // ~ 8,4 pt OCR-B a 100%
  const topo = rotuloSuperior ? fonte * 1.5 : 0;
  const esq = 11 * m;
  const barras: Barra[] = [];
  const mods = modulosEan13(ean);
  const guarda = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92;
  const empurra = (seq: string, x0: number, y0: number, h: number, guardaFn?: (i: number) => boolean) => {
    let i = 0;
    while (i < seq.length) {
      if (seq[i] === '1') {
        let j = i; while (j < seq.length && seq[j] === '1') j++;
        const ext = guardaFn && guardaFn(i) ? hGuarda : 0;
        barras.push({ x: x0 + i * m, w: (j - i) * m, y: y0, h: h + ext });
        i = j;
      } else i++;
    }
  };
  empurra(mods, esq, topo, hBarras, guarda);
  const textos: TextoCodigo[] = [];
  const yTexto = topo + hBarras + hGuarda * 0.2 + fonte * 0.9;
  textos.push({ x: esq - 2 * m, y: yTexto, texto: ean[0]!, tamanho: fonte, ancora: 'end' });
  textos.push({ x: esq + (3 + 21) * m, y: yTexto, texto: ean.slice(1, 7), tamanho: fonte, ancora: 'middle' });
  textos.push({ x: esq + (50 + 21) * m, y: yTexto, texto: ean.slice(7), tamanho: fonte, ancora: 'middle' });
  let largura = esq + 95 * m + 7 * m;
  if (complemento) {
    const x0 = esq + 95 * m + 9 * m;
    const ma = modulosComplemento(complemento);
    const yAdd = topo + fonte * 1.2;
    empurra(ma, x0, yAdd, hBarras - fonte * 1.2 + hGuarda);
    textos.push({ x: x0 + (ma.length * m) / 2, y: topo + fonte * 0.95, texto: complemento, tamanho: fonte, ancora: 'middle' });
    largura = x0 + ma.length * m + 5 * m;
  }
  if (rotuloSuperior) textos.push({ x: esq + 47.5 * m, y: fonte * 1.05, texto: rotuloSuperior, tamanho: fonte, ancora: 'middle' });
  const altura = topo + hBarras + hGuarda + fonte * 1.3;
  return { largura, altura, ampliacao, modulo: m, barras, textos };
}

/** SVG autônomo (para o designer posicionar na arte). */
export function svgCodigo(g: GeometriaCodigo): string {
  const b = g.barras.map((r) => `<rect x="${r.x.toFixed(4)}" y="${r.y.toFixed(4)}" width="${r.w.toFixed(4)}" height="${r.h.toFixed(4)}"/>`).join('');
  const t = g.textos.map((x) => `<text x="${x.x.toFixed(3)}" y="${x.y.toFixed(3)}" font-size="${x.tamanho.toFixed(3)}" text-anchor="${x.ancora}">${x.texto}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.largura.toFixed(3)}mm" height="${g.altura.toFixed(3)}mm" viewBox="0 0 ${g.largura.toFixed(4)} ${g.altura.toFixed(4)}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${b}</g><g fill="#000" font-family="OCR-B, 'OCR B', monospace">${t}</g></svg>`;
}
