/**
 * Oráculo de verificação independente (RF-015, CT-001, CT-009).
 *
 * Recebe um layout de caderno JÁ CALCULADO (página + rotação por célula/face) e o
 * "dobra" fisicamente em 3D, usando rotações rígidas de 180° em torno da linha de dobra,
 * com vetores de orientação do conteúdo. Depois lê o caderno como um leitor faria e confere:
 *   1. ordem de leitura (camada L: páginas 2L+1 na face de cima e 2L+2 na de baixo);
 *   2. orientação (cada página aparece em pé para o leitor);
 *   3. lombada física (as camadas 0 e n−1 precisam ser vizinhas na folha plana,
 *      unidas pela borda que vira a lombada).
 *
 * É deliberadamente uma implementação diferente do simulador (3D contínuo, eixos rígidos,
 * detecção de lombada por adjacência física) — um erro comum aos dois é improvável.
 */

import type { Edge } from '../core/geometry.js';
import type { SignatureLayout } from './simulate.js';

type V3 = [number, number, number];

interface Plate {
  c: number; r: number;
  p: V3; // centro
  n: V3; // normal da face F
  // direções "direita" e "baixo" do conteúdo de cada face, em coordenadas 3D
  fRight: V3; fDown: V3; fPage: number;
  bRight: V3; bDown: V3; bPage: number;
}

export interface OracleResult {
  ok: boolean;
  erros: string[];
}

function rot2(rot: number, v: [number, number]): [number, number] {
  // rotação horária em coordenadas de tela
  const k = ((rot / 90) % 4 + 4) % 4;
  let [x, y] = v;
  for (let i = 0; i < k; i++) [x, y] = [-y, x];
  return [x, y];
}

export function verificarCaderno(layout: SignatureLayout): OracleResult {
  const erros: string[] = [];
  const { cols, rows } = layout;
  const plates: Plate[] = layout.celulas.map((cell) => {
    // Conteúdo da frente: direções na vista superior.
    const fr = rot2(cell.frente.rotacao, [1, 0]);
    const fd = rot2(cell.frente.rotacao, [0, 1]);
    // Conteúdo do verso: definido na vista de virada lateral → converter para vista superior (espelha x).
    const br = rot2(cell.verso.rotacao, [1, 0]);
    const bd = rot2(cell.verso.rotacao, [0, 1]);
    return {
      c: cell.col, r: cell.row,
      p: [cell.col + 0.5, cell.row + 0.5, 0],
      n: [0, 0, 1],
      fRight: [fr[0], fr[1], 0], fDown: [fd[0], fd[1], 0], fPage: cell.frente.pagina,
      bRight: [-br[0], br[1], 0], bDown: [-bd[0], bd[1], 0], bPage: cell.verso.pagina,
    };
  });

  // Executa as dobras com rotação rígida de 180° em torno de um eixo no plano.
  const bounds = { x0: 0, x1: cols, y0: 0, y1: rows };
  for (const f of layout.esquema.folds) {
    const line = f.axis === 'x' ? bounds.x0 + f.at : bounds.y0 + f.at;
    const coord = (pl: Plate) => (f.axis === 'x' ? pl.p[0] : pl.p[1]);
    const moving = plates.filter((pl) => (f.move === 'high' ? coord(pl) > line : coord(pl) < line));
    const zs = plates.map((pl) => pl.p[2]);
    const zAxis = f.dir === 'over' ? Math.max(...zs) + 0.5 : Math.min(...zs) - 0.5;
    const rotVec = (v: V3): V3 => (f.axis === 'x' ? [-v[0], v[1], -v[2]] : [v[0], -v[1], -v[2]]);
    for (const pl of moving) {
      if (f.axis === 'x') pl.p = [2 * line - pl.p[0], pl.p[1], 2 * zAxis - pl.p[2]];
      else pl.p = [pl.p[0], 2 * line - pl.p[1], 2 * zAxis - pl.p[2]];
      pl.n = rotVec(pl.n);
      pl.fRight = rotVec(pl.fRight); pl.fDown = rotVec(pl.fDown);
      pl.bRight = rotVec(pl.bRight); pl.bDown = rotVec(pl.bDown);
    }
    // Atualiza limites da folha dobrada.
    if (f.axis === 'x') {
      if (f.move === 'high') bounds.x1 = line; else bounds.x0 = line;
    } else {
      if (f.move === 'high') bounds.y1 = line; else bounds.y0 = line;
    }
  }

  const cx = plates[0]!.p[0];
  const cy = plates[0]!.p[1];
  if (!plates.every((pl) => Math.abs(pl.p[0] - cx) < 1e-9 && Math.abs(pl.p[1] - cy) < 1e-9)) {
    return { ok: false, erros: ['Oráculo: a dobra não resulta em pilha única.'] };
  }
  // Lombada física: borda do caderno onde as camadas externas (0 e n−1) estão unidas.
  const stack0 = [...plates].sort((a, b) => b.p[2] - a.p[2]);
  const n = stack0.length;
  let spine0: Edge = layout.bordaEncadernacao;
  if (layout.esquema.folds.length > 0) {
    const a = stack0[0]!;
    const b = stack0[n - 1]!;
    if (Math.abs(a.c - b.c) + Math.abs(a.r - b.r) !== 1) {
      return { ok: false, erros: ['Oráculo: camadas externas não são vizinhas na folha plana — sem lombada física.'] };
    }
    const mid: V3 = [(a.c + b.c) / 2 + 0.5, (a.r + b.r) / 2 + 0.5, 0];
    const pt = dobrarPonto(layout, mid);
    const dx = pt[0] - cx;
    const dy = pt[1] - cy;
    spine0 = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
  }

  // O leitor pode segurar o caderno pelos dois lados: como saiu da dobra, ou virado (eixo vertical).
  const flipV = (v: V3): V3 => [-v[0], v[1], -v[2]];
  const virado = stack0.map((pl) => ({ ...pl, n: flipV(pl.n), fRight: flipV(pl.fRight), fDown: flipV(pl.fDown), bRight: flipV(pl.bRight), bDown: flipV(pl.bDown) })).reverse();
  const spineVirado: Edge = spine0 === 'left' ? 'right' : spine0 === 'right' ? 'left' : spine0;

  const ler = (stack: Plate[], spineFinal: Edge): string[] => {
    const errs: string[] = [];
    const order: Edge[] = ['left', 'top', 'right', 'bottom'];
    const steps = (order.indexOf(layout.bordaEncadernacao) - order.indexOf(spineFinal) + 4) % 4;
    const view = (v: V3): [number, number] => rot2(steps * 90, [v[0], v[1]]);
    const target = layout.bordaEncadernacao;
    const turnLeaf = (v: [number, number]): [number, number] =>
      target === 'left' || target === 'right' ? [-v[0], v[1]] : [v[0], -v[1]];
    stack.forEach((pl, L) => {
      const fUp = pl.n[2] > 0;
      const topPage = fUp ? pl.fPage : pl.bPage;
      const botPage = fUp ? pl.bPage : pl.fPage;
      if (topPage !== 2 * L + 1) errs.push(`Camada ${L}: face de cima deveria ser p.${2 * L + 1}, encontrada p.${topPage}`);
      if (botPage !== 2 * L + 2) errs.push(`Camada ${L}: face de baixo deveria ser p.${2 * L + 2}, encontrada p.${botPage}`);
      const topR = view(fUp ? pl.fRight : pl.bRight);
      const topD = view(fUp ? pl.fDown : pl.bDown);
      const botR = turnLeaf(view(fUp ? pl.bRight : pl.fRight));
      const botD = turnLeaf(view(fUp ? pl.bDown : pl.fDown));
      const upright = (r: [number, number], d: [number, number]) => r[0] === 1 && r[1] === 0 && d[0] === 0 && d[1] === 1;
      if (!upright(topR, topD)) errs.push(`p.${topPage}: não fica em pé para o leitor`);
      if (!upright(botR, botD)) errs.push(`p.${botPage}: não fica em pé para o leitor`);
    });
    return errs;
  };

  const e1 = ler(stack0, spine0);
  if (e1.length === 0) return { ok: true, erros: [] };
  if (layout.esquema.folds.length === 0) return { ok: false, erros: e1 };
  const e2 = ler(virado, spineVirado);
  if (e2.length === 0) return { ok: true, erros: [] };
  erros.push(...(e2.length < e1.length ? e2 : e1));
  return { ok: false, erros };
}

function dobrarPonto(layout: SignatureLayout, p0: V3): V3 {
  // Repete as mesmas dobras rígidas para um ponto na superfície da folha.
  // A altura do eixo não altera x/y, então basta refletir no plano.
  let p: V3 = [...p0];
  const bounds = { x0: 0, x1: layout.cols, y0: 0, y1: layout.rows };
  for (const f of layout.esquema.folds) {
    const line = f.axis === 'x' ? bounds.x0 + f.at : bounds.y0 + f.at;
    const v = f.axis === 'x' ? p[0] : p[1];
    const moves = f.move === 'high' ? v > line + 1e-9 : v < line - 1e-9;
    if (moves) p = f.axis === 'x' ? [2 * line - p[0], p[1], 0] : [p[0], 2 * line - p[1], 0];
    if (f.axis === 'x') { if (f.move === 'high') bounds.x1 = line; else bounds.x0 = line; }
    else { if (f.move === 'high') bounds.y1 = line; else bounds.y0 = line; }
  }
  return p;
}
