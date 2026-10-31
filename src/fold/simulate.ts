/**
 * Simulador de dobra (derivação da imposição de um caderno).
 *
 * Entrada: esquema de dobra (grade de células + sequência de dobras) e a borda de
 * encadernação desejada. Saída: para cada célula da folha plana e cada face (frente/verso),
 * qual página local ela recebe e com qual rotação, além do tipo de cada borda da célula
 * (lombada, cabeça, pé, frente) e da profundidade de aninhamento (para creep).
 *
 * Modelo físico:
 *  - Cada célula é uma placa rígida com face F (frente da folha) e face B (verso).
 *  - Dobrar = refletir a parte móvel sobre a linha de dobra; a parte móvel inverte a ordem
 *    das camadas e vai para cima ('over') ou para baixo ('under') da parte fixa.
 *  - M (Mat2) acumula a transformação de orientação "vista superior da folha plana" →
 *    "vista superior do caderno dobrado".
 *  - Ao final a pilha tem 1 célula de largura; a camada 0 é a do topo.
 *  - A lombada é a borda criada pela última dobra (que precisa dividir a pilha ao meio
 *    para o caderno ser encadernável em códice).
 *  - O caderno é girado no plano até a lombada coincidir com a borda de encadernação.
 *  - Leitura: camada L → face de cima = página 2L+1 (ímpar/recto), face de baixo = 2L+2.
 *
 * Convenção do verso: o verso da folha é descrito em "vista de virada lateral"
 * (a folha virada da esquerda para a direita, eixo vertical) — coordenada x espelhada.
 * A conversão para virada pela pinça (tombo) é feita no layout de máquina.
 */

import {
  type Edge, type Mat2, type Rotation, I, RX, RY, apply, det, edgeFromNormal, EDGE_NORMAL, inv, mul,
  oppositeEdge, rotationBetweenEdges, rotationMat, rotationOf,
} from '../core/geometry.js';
import { type FoldScheme } from './schemes.js';

export type Face = 'F' | 'B';
export type EdgeKind = 'lombada' | 'cabeca' | 'pe' | 'frente' | 'lateral' | 'dobra';

export interface FacePage {
  /** Página local (1-based) dentro do caderno. */
  pagina: number;
  /** Posição da célula na vista dessa face (para B: vista de virada lateral). */
  col: number;
  row: number;
  /** Rotação horária a aplicar no conteúdo da página, na vista da face. */
  rotacao: Rotation;
  /** Borda da página (na vista da face) que fica na lombada, ou null se não houver. */
  bordaLombada: Edge | null;
}

export interface CellResult {
  /** Posição da célula na vista superior da folha plana (frente). */
  col: number;
  row: number;
  /** Camada no caderno dobrado (0 = topo/externa). */
  camada: number;
  /** Profundidade do par na lombada (0 = folha mais externa do caderno). */
  profundidade: number;
  frente: FacePage;
  verso: FacePage;
  /** Tipo físico de cada borda da célula, na vista superior da folha plana. */
  bordas: Record<Edge, EdgeKind>;
}

export interface SignatureLayout {
  esquema: FoldScheme;
  paginas: number;
  cols: number;
  rows: number;
  bordaEncadernacao: Edge;
  /** true quando as células giram 90° (a página fica "deitada" na folha). */
  celulaGirada: boolean;
  celulas: CellResult[];
  /** Encadernável em códice (pilha simétrica na última dobra). */
  codiceValido: boolean;
  motivoInvalido?: string;
}

interface SimCell {
  c: number; r: number; // posição original
  x: number; y: number; // posição atual na grade dobrada
  z: number; // altura (maior = mais acima)
  up: Face; // face voltada para cima
  M: Mat2;
}

export interface FoldOptions {
  /** Borda de encadernação na vista do leitor: esquerda (LTR), direita (RTL), superior (calendário). */
  bordaEncadernacao: Edge;
}

export function simularDobra(esquema: FoldScheme, opts: FoldOptions): SignatureLayout {
  const { cols, rows } = esquema;
  if (cols < 1 || rows < 1) throw new Error('Grade inválida');
  const cells: SimCell[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ c, r, x: c, y: r, z: 0, up: 'F', M: I });

  let W = cols;
  let H = rows;
  let spine: Edge | null = null;
  let codiceValido = true;
  let motivoInvalido: string | undefined;

  esquema.folds.forEach((f, idx) => {
    const dim = f.axis === 'x' ? W : H;
    const k = f.at;
    if (k <= 0 || k >= dim) throw new Error(`${esquema.id}: dobra ${idx + 1} fora da folha (at=${k}, dim=${dim})`);
    const movingSize = f.move === 'high' ? dim - k : k;
    const fixedSize = dim - movingSize;
    if (movingSize > fixedSize) {
      throw new Error(`${esquema.id}: dobra ${idx + 1} — parte móvel (${movingSize}) maior que a fixa (${fixedSize})`);
    }
    const coord = (s: SimCell) => (f.axis === 'x' ? s.x : s.y);
    const isMoving = (s: SimCell) => (f.move === 'high' ? coord(s) >= k : coord(s) < k);
    const moving = cells.filter(isMoving);
    const fixed = cells.filter((s) => !isMoving(s));

    if (idx === esquema.folds.length - 1) {
      // A última dobra forma a lombada: precisa dividir a pilha em duas metades iguais.
      if (moving.length !== fixed.length) {
        codiceValido = false;
        motivoInvalido = 'A última dobra não divide a pilha ao meio; o caderno não forma pares na lombada.';
      }
    }

    const maxF = Math.max(...fixed.map((s) => s.z));
    const minF = Math.min(...fixed.map((s) => s.z));
    const maxM = Math.max(...moving.map((s) => s.z));
    const minM = Math.min(...moving.map((s) => s.z));
    const refl = f.axis === 'x' ? RX : RY;

    for (const s of moving) {
      const v = coord(s);
      const nv = 2 * k - 1 - v;
      if (f.axis === 'x') s.x = nv; else s.y = nv;
      s.z = f.dir === 'over' ? maxF + 1 + (maxM - s.z) : minF - 1 - (s.z - minM);
      s.up = s.up === 'F' ? 'B' : 'F';
      s.M = mul(refl, s.M);
    }
    if (f.move === 'low') {
      for (const s of cells) {
        if (f.axis === 'x') s.x -= k; else s.y -= k;
      }
    }
    if (f.axis === 'x') W = fixedSize; else H = fixedSize;

    if (idx === esquema.folds.length - 1) {
      spine = f.axis === 'x' ? (f.move === 'high' ? 'right' : 'left') : (f.move === 'high' ? 'bottom' : 'top');
    }
  });

  if (W !== 1 || H !== 1) throw new Error(`${esquema.id}: a dobra não termina em uma única célula (${W}×${H})`);

  const candA = finalizar(esquema, cells, spine, opts.bordaEncadernacao, false, codiceValido, motivoInvalido);
  if (esquema.folds.length === 0) return candA;
  const candB = finalizar(esquema, cells, spine, opts.bordaEncadernacao, true, codiceValido, motivoInvalido);
  // Ambas são fisicamente corretas; prefere a que deixa mais páginas sem rotação (convenção de gráfica).
  return pontuacao(candB) > pontuacao(candA) ? candB : candA;
}

function pontuacao(l: SignatureLayout): number {
  let p = 0;
  for (const c of l.celulas) {
    if (c.frente.rotacao === 0) p++;
    if (c.verso.rotacao === 0) p++;
  }
  return p;
}

function finalizar(
  esquema: FoldScheme,
  simCells: readonly SimCell[],
  spine: Edge | null,
  target: Edge,
  virar: boolean,
  codiceValido: boolean,
  motivoInvalido: string | undefined,
): SignatureLayout {
  const { cols, rows } = esquema;
  // "Virar" o caderno inteiro (eixo vertical): inverte a pilha, troca a face de cima e espelha x.
  const cells: SimCell[] = simCells.map((s) =>
    virar ? { ...s, z: -s.z, up: s.up === 'F' ? 'B' : 'F', M: mul(RX, s.M) } : { ...s },
  );
  let spineEdge: Edge = spine ?? target; // folha solta: a borda de encadernação é a própria lombada
  if (virar && spine) spineEdge = spine === 'left' ? 'right' : spine === 'right' ? 'left' : spine;

  const G = rotationMat(rotationBetweenEdges(spineEdge, target));
  const celulaGirada = G[0] === 0; // rotação de 90/270

  const ordered = [...cells].sort((a, b) => b.z - a.z);
  const n = ordered.length;
  const layerOf = new Map<SimCell, number>();
  ordered.forEach((s, i) => layerOf.set(s, i));

  const vBottom: Mat2 = target === 'left' || target === 'right' ? RX : RY;
  const fore = oppositeEdge(target);
  const kindOf = (finalEdge: Edge): EdgeKind => {
    if (finalEdge === target) return 'lombada';
    if (finalEdge === fore) return 'frente';
    if (target === 'left' || target === 'right') return finalEdge === 'top' ? 'cabeca' : 'pe';
    return 'lateral';
  };

  const celulas: CellResult[] = cells.map((s) => {
    const Mf = mul(G, s.M);
    const L = layerOf.get(s)!;
    const topFace: Face = s.up;

    const bordas = {} as Record<Edge, EdgeKind>;
    for (const e of ['left', 'top', 'right', 'bottom'] as const) {
      bordas[e] = kindOf(edgeFromNormal(apply(Mf, EDGE_NORMAL[e])));
    }
    const spinePhysical = (Object.keys(bordas) as Edge[]).find((e) => bordas[e] === 'lombada') ?? null;

    const facePage = (face: Face): FacePage => {
      const isTop = face === topFace;
      const pagina = isTop ? 2 * L + 1 : 2 * L + 2;
      const V = isTop ? I : vBottom;
      const S = face === 'F' ? I : RX;
      const P = mul(mul(V, Mf), inv(S)); // vista da face -> vista do leitor
      if (det(P) !== 1) throw new Error(`${esquema.id}: orientação inconsistente (célula ${s.c},${s.r} face ${face})`);
      let bordaLombada: Edge | null = spinePhysical;
      if (spinePhysical && face === 'B') {
        bordaLombada = spinePhysical === 'left' ? 'right' : spinePhysical === 'right' ? 'left' : spinePhysical;
      }
      return {
        pagina,
        col: face === 'F' ? s.c : cols - 1 - s.c,
        row: s.r,
        rotacao: rotationOf(inv(P)),
        bordaLombada,
      };
    };

    return {
      col: s.c,
      row: s.r,
      camada: L,
      profundidade: Math.min(L, n - 1 - L),
      frente: facePage('F'),
      verso: facePage('B'),
      bordas,
    };
  });

  return {
    esquema,
    paginas: 2 * n,
    cols,
    rows,
    bordaEncadernacao: target,
    celulaGirada,
    celulas,
    codiceValido: esquema.folds.length === 0 ? true : codiceValido,
    motivoInvalido,
  };
}

/** Converte a borda de encadernação do produto (vista do leitor) em Edge. */
export function bordaDeEncadernacao(direcao: 'ltr' | 'rtl', superior = false): Edge {
  if (superior) return 'top';
  return direcao === 'ltr' ? 'left' : 'right';
}
