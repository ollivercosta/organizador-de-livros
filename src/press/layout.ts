/**
 * Layout de máquina: posiciona formas (cadernos/folhas) na folha de impressão, em mm.
 *
 * Coordenadas internas: vista superior do lado A, origem no canto superior esquerdo, y para baixo.
 * Cada lado é exportado na SUA vista (como a chapa vê a folha):
 *   - virada lateral (work-and-turn / sheetwise lateral): lado B = espelho em x;
 *   - virada pela pinça (tumble): lado B = espelho em y (a pinça muda de borda!).
 *
 * Modos:
 *   'frente_verso'  — duas chapas (frente e verso), uma cópia da forma por posição;
 *   'virada_lateral' (work-and-turn) — uma chapa com frente e verso lado a lado; 2 cópias por posição;
 *   'virada_pinca'  (work-and-tumble) — uma chapa com frente acima e verso abaixo; 2 cópias por posição;
 *   'perfecting'    — impressão simultânea frente/verso; geometria do verso conforme a virada da máquina.
 */

import type { Edge, Rotation } from '../core/geometry.js';
import { addRot } from '../core/geometry.js';
import type { EdgeKind, SignatureLayout } from '../fold/simulate.js';

export type ModoImpressao = 'frente_verso' | 'virada_lateral' | 'virada_pinca' | 'perfecting';
export type Virada = 'lateral' | 'pinca';

export interface Sangrias {
  lombada: number; cabeca: number; pe: number; frente: number; lateral: number; dobra: number;
}

export interface ParametrosMaquina {
  folha: { largura: number; altura: number };
  /** Borda da folha onde a pinça pega (vista do lado A). */
  bordaPinca: Edge;
  pinca: number;
  cauda: number;
  margemLateral: number;
  /** Espaço reservado em volta de cada forma para marcas de corte/dobra. */
  areaMarcas: number;
  modo: ModoImpressao;
  /** Virada do verso para 'frente_verso' e 'perfecting'. */
  viradaVerso: Virada;
  /** 'auto' maximiza o aproveitamento; número fixa as posições por folha. */
  posicoes: 'auto' | number;
  rotacaoForma: 'auto' | 0 | 90;
  /** Fibra do papel: paralela ao lado maior ('longa') ou ao menor ('curta') da folha. */
  fibra?: 'longa' | 'curta';
}

export interface Retangulo { x: number; y: number; w: number; h: number }
export interface Lados { l: number; t: number; r: number; b: number }

export interface Posicionamento {
  pagina: number; // global (do componente)
  unidade: number;
  posicao: number; // slot na folha
  /** Caixa de corte (trim) na vista do lado. */
  corte: Retangulo;
  /** Sangria por lado (na vista do lado). */
  sangria: Lados;
  /** Rotação horária do conteúdo, na vista do lado. */
  rotacao: Rotation;
  /** Deslocamento de creep do conteúdo (mm), na vista do lado. */
  creep: { dx: number; dy: number };
  /** Página fisicamente na face A ou B da célula. */
  face: 'F' | 'B';
}

export interface MarcaLinha { x1: number; y1: number; x2: number; y2: number; tipo: 'corte' | 'dobra' | 'colacao' }

export interface Forma {
  id: string;
  unidades: number[];
  folha: { largura: number; altura: number };
  modo: ModoImpressao;
  viradaVerso: Virada;
  rotacaoForma: 0 | 90;
  posicoes: Array<{ unidade: number; area: Retangulo }>;
  /** Cópias de cada unidade obtidas por folha impressa. */
  copiasPorFolha: Record<number, number>;
  ladoA: Posicionamento[];
  ladoB: Posicionamento[];
  /** Na virada lateral/pinça a mesma chapa imprime os dois lados. */
  mesmaChapa: boolean;
  marcasA: MarcaLinha[];
  areaImprimivel: Retangulo;
  /** Direção da lombada na folha (para checar fibra). */
  lombadaNaFolha: 'vertical' | 'horizontal' | 'nenhuma';
  avisos: string[];
}

interface FormaLocal {
  w: number; h: number;
  itens: Array<{ pagina: number; face: 'F' | 'B'; rect: Retangulo; sangria: Lados; rotF: Rotation; rotBTurn: Rotation; creepTop: { dx: number; dy: number } }>;
  linhasCorte: { xs: number[]; ys: number[] };
  linhasDobra: { xs: number[]; ys: number[] };
  colacao: Retangulo | null;
  colacaoFace: 'F' | 'B';
  lombada: 'vertical' | 'horizontal' | 'nenhuma';
}

/**
 * Geometria de uma forma (caderno desdobrado) em mm, vista superior, origem no canto da sangria externa.
 * `creepMm(cell)` devolve o deslocamento (mm) do conteúdo daquela célula em direção à lombada.
 */
export function geometriaForma(
  layout: SignatureLayout,
  mapa: readonly number[],
  formato: { largura: number; altura: number },
  sangrias: Sangrias,
  creepMm: (profundidade: number) => number,
  indiceColacao: number | null,
): FormaLocal {
  const cw = layout.celulaGirada ? formato.altura : formato.largura;
  const ch = layout.celulaGirada ? formato.largura : formato.altura;
  const { cols, rows } = layout;
  const cell = (c: number, r: number) => layout.celulas.find((x) => x.col === c && x.row === r)!;
  const s = (k: EdgeKind) => sangrias[k];

  // Folga em cada linha da grade = soma das sangrias dos dois lados (máximo ao longo da linha).
  const gapX: number[] = [];
  for (let j = 0; j < cols - 1; j++) {
    let g = 0;
    for (let r = 0; r < rows; r++) g = Math.max(g, s(cell(j, r).bordas.right) + s(cell(j + 1, r).bordas.left));
    gapX.push(g);
  }
  const gapY: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    let g = 0;
    for (let c = 0; c < cols; c++) g = Math.max(g, s(cell(c, i).bordas.bottom) + s(cell(c, i + 1).bordas.top));
    gapY.push(g);
  }
  let outL = 0, outR = 0, outT = 0, outB = 0;
  for (let r = 0; r < rows; r++) { outL = Math.max(outL, s(cell(0, r).bordas.left)); outR = Math.max(outR, s(cell(cols - 1, r).bordas.right)); }
  for (let c = 0; c < cols; c++) { outT = Math.max(outT, s(cell(c, 0).bordas.top)); outB = Math.max(outB, s(cell(c, rows - 1).bordas.bottom)); }

  const xs: number[] = [outL];
  for (let j = 1; j < cols; j++) xs.push(xs[j - 1]! + cw + gapX[j - 1]!);
  const ys: number[] = [outT];
  for (let i = 1; i < rows; i++) ys.push(ys[i - 1]! + ch + gapY[i - 1]!);
  const w = xs[cols - 1]! + cw + outR;
  const h = ys[rows - 1]! + ch + outB;

  const itens: FormaLocal['itens'] = [];
  const dirVec = (e: 'left' | 'top' | 'right' | 'bottom' | null): [number, number] =>
    e === 'left' ? [-1, 0] : e === 'right' ? [1, 0] : e === 'top' ? [0, -1] : e === 'bottom' ? [0, 1] : [0, 0];

  for (const c of layout.celulas) {
    const rect = { x: xs[c.col]!, y: ys[c.row]!, w: cw, h: ch };
    // sangria efetiva de cada lado: a própria, limitada pela metade da folga quando interna
    const lado = (e: 'left' | 'top' | 'right' | 'bottom'): number => s(c.bordas[e]);
    const sangria = { l: lado('left'), t: lado('top'), r: lado('right'), b: lado('bottom') };
    const shift = creepMm(c.profundidade);
    for (const face of ['F', 'B'] as const) {
      const fp = face === 'F' ? c.frente : c.verso;
      // borda da lombada na vista superior (o verso está em vista de virada lateral → espelha x)
      let e = fp.bordaLombada;
      if (face === 'B' && e) e = e === 'left' ? 'right' : e === 'right' ? 'left' : e;
      const [vx, vy] = dirVec(e);
      itens.push({
        pagina: mapa[fp.pagina - 1]!,
        face,
        rect,
        sangria,
        rotF: c.frente.rotacao,
        rotBTurn: c.verso.rotacao,
        creepTop: { dx: vx * shift, dy: vy * shift },
      });
    }
  }

  // Linhas de corte e dobra (posições na forma) — para marcas.
  const corteX = new Set<number>(); const corteY = new Set<number>();
  const dobraX = new Set<number>(); const dobraY = new Set<number>();
  for (let j = 0; j < cols; j++) {
    const leftKinds = Array.from({ length: rows }, (_, r) => cell(j, r).bordas.left);
    const rightKinds = Array.from({ length: rows }, (_, r) => cell(j, r).bordas.right);
    const isFold = (k: EdgeKind) => k === 'dobra' || (k === 'lombada' && sangrias.lombada === 0);
    if (j === 0 || !leftKinds.every(isFold)) corteX.add(xs[j]!); else dobraX.add(xs[j]!);
    if (j === cols - 1 || !rightKinds.every(isFold)) corteX.add(xs[j]! + cw);
  }
  for (let i = 0; i < rows; i++) {
    const topKinds = Array.from({ length: cols }, (_, c) => cell(c, i).bordas.top);
    const botKinds = Array.from({ length: cols }, (_, c) => cell(c, i).bordas.bottom);
    const isFold = (k: EdgeKind) => k === 'dobra' || (k === 'lombada' && sangrias.lombada === 0);
    if (i === 0 || !topKinds.every(isFold)) corteY.add(ys[i]!); else dobraY.add(ys[i]!);
    if (i === rows - 1 || !botKinds.every(isFold)) corteY.add(ys[i]! + ch);
  }
  // Toda linha interna de dobra (folga zero) também é registrada como dobra.
  for (let j = 0; j < cols - 1; j++) if (gapX[j] === 0) { dobraX.add(xs[j]! + cw); corteX.delete(xs[j]! + cw); corteX.delete(xs[j + 1]!); }
  for (let i = 0; i < rows - 1; i++) if (gapY[i] === 0) { dobraY.add(ys[i]! + ch); corteY.delete(ys[i]! + ch); corteY.delete(ys[i + 1]!); }

  // Lombada: direção na folha e marca de colação (dorso do caderno: entre camadas 0 e n−1).
  let lombada: FormaLocal['lombada'] = 'nenhuma';
  let colacao: Retangulo | null = null;
  let colacaoFace: 'F' | 'B' = 'F';
  if (layout.esquema.folds.length > 0) {
    const n = layout.celulas.length;
    const a = layout.celulas.find((x) => x.camada === 0)!;
    const b = layout.celulas.find((x) => x.camada === n - 1)!;
    const ra = { x: xs[a.col]!, y: ys[a.row]! };
    const rb = { x: xs[b.col]!, y: ys[b.row]! };
    colacaoFace = a.frente.pagina === 1 ? 'F' : 'B';
    if (a.row === b.row) {
      lombada = 'vertical';
      const left = Math.min(ra.x, rb.x) + cw;
      const right = Math.max(ra.x, rb.x);
      const midX = (left + right) / 2;
      const mh = 6; const mw = 3;
      if (indiceColacao !== null) colacao = { x: midX - mw / 2, y: ra.y + Math.min(ch - mh, 3 + indiceColacao * mh) , w: mw, h: mh };
    } else {
      lombada = 'horizontal';
      const top = Math.min(ra.y, rb.y) + ch;
      const bottom = Math.max(ra.y, rb.y);
      const midY = (top + bottom) / 2;
      const mh = 3; const mw = 6;
      if (indiceColacao !== null) colacao = { x: ra.x + Math.min(cw - mw, 3 + indiceColacao * mw), y: midY - mh / 2, w: mw, h: mh };
    }
  }

  return {
    w, h, itens,
    linhasCorte: { xs: [...corteX].sort((p, q) => p - q), ys: [...corteY].sort((p, q) => p - q) },
    linhasDobra: { xs: [...dobraX].sort((p, q) => p - q), ys: [...dobraY].sort((p, q) => p - q) },
    colacao, colacaoFace, lombada,
  };
}

/** Gira a geometria local 90° horário (forma deitada na folha). */
function girar90(f: FormaLocal): FormaLocal {
  const H = f.h;
  const rr = (r: Retangulo): Retangulo => ({ x: H - r.y - r.h, y: r.x, w: r.h, h: r.w });
  return {
    w: f.h, h: f.w,
    itens: f.itens.map((it) => ({
      ...it,
      rect: rr(it.rect),
      sangria: { l: it.sangria.b, t: it.sangria.l, r: it.sangria.t, b: it.sangria.r },
      rotF: addRot(it.rotF, 90),
      rotBTurn: addRot(it.rotBTurn, 270),
      creepTop: { dx: -it.creepTop.dy, dy: it.creepTop.dx },
    })),
    linhasCorte: { xs: f.linhasCorte.ys.map((y) => H - y).sort((a, b) => a - b), ys: [...f.linhasCorte.xs] },
    linhasDobra: { xs: f.linhasDobra.ys.map((y) => H - y).sort((a, b) => a - b), ys: [...f.linhasDobra.xs] },
    colacao: f.colacao ? rr(f.colacao) : null,
    colacaoFace: f.colacaoFace,
    lombada: f.lombada === 'vertical' ? 'horizontal' : f.lombada === 'horizontal' ? 'vertical' : 'nenhuma',
  };
}

function areaImprimivel(p: ParametrosMaquina, simetricaX: boolean, simetricaY: boolean): Retangulo {
  const W = p.folha.largura, H = p.folha.altura;
  const m: Record<Edge, number> = { left: p.margemLateral, right: p.margemLateral, top: p.margemLateral, bottom: p.margemLateral };
  const opp: Record<Edge, Edge> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  m[p.bordaPinca] = p.pinca;
  m[opp[p.bordaPinca]] = p.cauda;
  // Virada pela pinça: no verso a pinça pega a borda oposta → as duas bordas precisam da maior margem.
  const tumble = p.modo === 'virada_pinca' || ((p.modo === 'frente_verso' || p.modo === 'perfecting') && p.viradaVerso === 'pinca');
  if (tumble) {
    const mx = Math.max(m[p.bordaPinca], m[opp[p.bordaPinca]]);
    m[p.bordaPinca] = mx; m[opp[p.bordaPinca]] = mx;
  }
  if (simetricaX) { const v = Math.max(m.left, m.right); m.left = v; m.right = v; }
  if (simetricaY) { const v = Math.max(m.top, m.bottom); m.top = v; m.bottom = v; }
  return { x: m.left, y: m.top, w: W - m.left - m.right, h: H - m.top - m.bottom };
}

export interface EntradaForma {
  layout: SignatureLayout;
  mapa: readonly number[];
  unidade: number;
  profundidadeExtra: number;
}

/**
 * Monta as formas de impressão para um conjunto de unidades com o MESMO esquema de dobra.
 * agrupamento:
 *   'repetir'     — cada forma contém apenas uma unidade, repetida em todas as posições;
 *   'sequencial'  — unidades distintas nas posições, em sequência (k·n + j);
 *   'corte_empilhamento' — posição j da folha k recebe a unidade j·K + k (pilhas em ordem após o corte).
 */
export function montarFormas(
  entradas: readonly EntradaForma[],
  formato: { largura: number; altura: number },
  sangrias: Sangrias,
  maquina: ParametrosMaquina,
  creepMmPorProfundidade: (prof: number) => number,
  agrupamento: 'repetir' | 'sequencial' | 'corte_empilhamento',
  colacao: boolean,
  idPrefixo = 'F',
): { formas: Forma[]; avisos: string[] } {
  const avisos: string[] = [];
  if (entradas.length === 0) return { formas: [], avisos };

  const turn = maquina.modo === 'virada_lateral';
  const tumble = maquina.modo === 'virada_pinca';
  const area = areaImprimivel(maquina, turn, tumble);

  const base0 = geometriaForma(entradas[0]!.layout, entradas[0]!.mapa, formato, sangrias, () => 0, null);
  const candidatos: Array<0 | 90> = maquina.rotacaoForma === 'auto' ? [0, 90] : [maquina.rotacaoForma];
  let melhor: { rot: 0 | 90; nx: number; ny: number; bw: number; bh: number } | null = null;
  for (const rot of candidatos) {
    const g = rot === 90 ? girar90(base0) : base0;
    const bw = g.w + 2 * maquina.areaMarcas;
    const bh = g.h + 2 * maquina.areaMarcas;
    const regW = turn ? area.w / 2 : area.w;
    const regH = tumble ? area.h / 2 : area.h;
    let nx = Math.floor(regW / bw + 1e-9);
    let ny = Math.floor(regH / bh + 1e-9);
    if (nx < 0) nx = 0; if (ny < 0) ny = 0;
    const total = nx * ny;
    const fibraOk = (lomb: FormaLocal['lombada']) => {
      if (!maquina.fibra || lomb === 'nenhuma') return true;
      const longaVertical = maquina.folha.altura >= maquina.folha.largura;
      const fibraVertical = maquina.fibra === 'longa' ? longaVertical : !longaVertical;
      return (lomb === 'vertical') === fibraVertical;
    };
    const cand = { rot, nx, ny, bw, bh };
    if (!melhor) { melhor = cand; continue; }
    const tm = melhor.nx * melhor.ny;
    if (total > tm || (total === tm && fibraOk(g.lombada) && !fibraOk((melhor.rot === 90 ? girar90(base0) : base0).lombada))) melhor = cand;
  }
  if (!melhor || melhor.nx * melhor.ny === 0) {
    avisos.push(`A forma (${base0.w.toFixed(1)} × ${base0.h.toFixed(1)} mm + marcas) não cabe na área imprimível da folha ${maquina.folha.largura} × ${maquina.folha.altura} mm no modo ${maquina.modo}.`);
    return { formas: [], avisos };
  }
  let nSlots = melhor.nx * melhor.ny;
  if (typeof maquina.posicoes === 'number') {
    if (maquina.posicoes > nSlots) avisos.push(`Solicitadas ${maquina.posicoes} posições, cabem ${nSlots}.`);
    nSlots = Math.min(nSlots, maquina.posicoes);
  }

  // Posições (slots) centralizadas na região.
  const regW = turn ? area.w / 2 : area.w;
  const regH = tumble ? area.h / 2 : area.h;
  const usedW = melhor.nx * melhor.bw;
  const usedH = melhor.ny * melhor.bh;
  const ox = area.x + (turn ? (regW - usedW) : (regW - usedW) / 2);
  const oy = area.y + (tumble ? (regH - usedH) : (regH - usedH) / 2);
  const slots: Array<{ x: number; y: number }> = [];
  for (let iy = 0; iy < melhor.ny; iy++) for (let ix = 0; ix < melhor.nx; ix++) {
    if (slots.length >= nSlots) break;
    slots.push({ x: ox + ix * melhor.bw + maquina.areaMarcas, y: oy + iy * melhor.bh + maquina.areaMarcas });
  }

  // Distribuição das unidades nas formas.
  const grupos: EntradaForma[][] = [];
  if (agrupamento === 'repetir') {
    for (const e of entradas) grupos.push(Array(slots.length).fill(e));
  } else if (agrupamento === 'sequencial') {
    for (let k = 0; k < entradas.length; k += slots.length) grupos.push(entradas.slice(k, k + slots.length));
  } else {
    const K = Math.ceil(entradas.length / slots.length);
    for (let k = 0; k < K; k++) {
      const g: EntradaForma[] = [];
      for (let j = 0; j < slots.length; j++) { const e = entradas[j * K + k]; if (e) g.push(e); }
      grupos.push(g);
    }
  }

  const W = maquina.folha.largura, H = maquina.folha.altura;
  const formas: Forma[] = grupos.map((grupo, gi) => {
    const ladoA: Posicionamento[] = [];
    const ladoB: Posicionamento[] = [];
    const marcasA: MarcaLinha[] = [];
    const copias: Record<number, number> = {};
    const posicoes: Forma['posicoes'] = [];
    const avisosF: string[] = [];
    if (grupo.length < slots.length && agrupamento !== 'repetir') avisosF.push(`${slots.length - grupo.length} posição(ões) vazia(s) nesta folha.`);
    let lombadaNaFolha: FormaLocal['lombada'] = 'nenhuma';

    grupo.forEach((e, si) => {
      const slot = slots[si]!;
      const local0 = geometriaForma(e.layout, e.mapa, formato, sangrias, (p) => creepMmPorProfundidade(p + e.profundidadeExtra), colacao ? e.unidade : null);
      const g = melhor!.rot === 90 ? girar90(local0) : local0;
      lombadaNaFolha = g.lombada;
      copias[e.unidade] = (copias[e.unidade] ?? 0) + (turn || tumble ? 2 : 1);
      posicoes.push({ unidade: e.unidade, area: { x: slot.x, y: slot.y, w: g.w, h: g.h } });

      for (const it of g.itens) {
        const rect = { x: slot.x + it.rect.x, y: slot.y + it.rect.y, w: it.rect.w, h: it.rect.h };
        if (it.face === 'F') {
          ladoA.push({ pagina: it.pagina, unidade: e.unidade, posicao: si, corte: rect, sangria: it.sangria, rotacao: it.rotF, creep: { ...it.creepTop }, face: 'F' });
        }
      }
      const espelho = (virada: Virada) => (it: FormaLocal['itens'][number]): Posicionamento => {
        const rect = { x: slot.x + it.rect.x, y: slot.y + it.rect.y, w: it.rect.w, h: it.rect.h };
        if (virada === 'lateral') {
          return { pagina: it.pagina, unidade: e.unidade, posicao: si, face: 'B',
            corte: { x: W - rect.x - rect.w, y: rect.y, w: rect.w, h: rect.h },
            sangria: { l: it.sangria.r, t: it.sangria.t, r: it.sangria.l, b: it.sangria.b },
            rotacao: it.rotBTurn, creep: { dx: -it.creepTop.dx, dy: it.creepTop.dy } };
        }
        return { pagina: it.pagina, unidade: e.unidade, posicao: si, face: 'B',
          corte: { x: rect.x, y: H - rect.y - rect.h, w: rect.w, h: rect.h },
          sangria: { l: it.sangria.l, t: it.sangria.b, r: it.sangria.r, b: it.sangria.t },
          rotacao: addRot(it.rotBTurn, 180), creep: { dx: it.creepTop.dx, dy: -it.creepTop.dy } };
      };
      const versos = g.itens.filter((it) => it.face === 'B');
      if (turn) ladoA.push(...versos.map(espelho('lateral')));
      else if (tumble) ladoA.push(...versos.map(espelho('pinca')));
      else ladoB.push(...versos.map(espelho(maquina.viradaVerso)));

      // Marcas de corte e dobra (fora da forma), lado A.
      const L = 4; // comprimento da marca
      const off = 1.5; // afastamento da sangria
      const mk = (x1: number, y1: number, x2: number, y2: number, tipo: MarcaLinha['tipo']) => marcasA.push({ x1, y1, x2, y2, tipo });
      const pushMarks = (ox2: number, oy2: number, gw: number, gh: number, mirrorX: boolean, mirrorY: boolean) => {
        const tx = (x: number) => (mirrorX ? W - (ox2 + x) : ox2 + x);
        const ty = (y: number) => (mirrorY ? H - (oy2 + y) : oy2 + y);
        for (const x of g.linhasCorte.xs) { mk(tx(x), ty(-off - L), tx(x), ty(-off), 'corte'); mk(tx(x), ty(gh + off), tx(x), ty(gh + off + L), 'corte'); }
        for (const y of g.linhasCorte.ys) { mk(tx(-off - L), ty(y), tx(-off), ty(y), 'corte'); mk(tx(gw + off), ty(y), tx(gw + off + L), ty(y), 'corte'); }
        for (const x of g.linhasDobra.xs) { mk(tx(x), ty(-off - L), tx(x), ty(-off), 'dobra'); mk(tx(x), ty(gh + off), tx(x), ty(gh + off + L), 'dobra'); }
        for (const y of g.linhasDobra.ys) { mk(tx(-off - L), ty(y), tx(-off), ty(y), 'dobra'); mk(tx(gw + off), ty(y), tx(gw + off + L), ty(y), 'dobra'); }
      };
      pushMarks(slot.x, slot.y, g.w, g.h, false, false);
      if (turn) pushMarks(slot.x, slot.y, g.w, g.h, true, false);
      if (tumble) pushMarks(slot.x, slot.y, g.w, g.h, false, true);
      if (g.colacao) {
        const c = g.colacao;
        // marca de colação vai na face externa do caderno (a que contém a pág. 1 local)
        if (g.colacaoFace === 'F') mk(slot.x + c.x, slot.y + c.y, slot.x + c.x + c.w, slot.y + c.y + c.h, 'colacao');
      }
    });

    const mesmaChapa = turn || tumble;
    return {
      id: `${idPrefixo}${gi + 1}`,
      unidades: [...new Set(grupo.map((g) => g.unidade))],
      folha: { ...maquina.folha },
      modo: maquina.modo,
      viradaVerso: turn ? 'lateral' : tumble ? 'pinca' : maquina.viradaVerso,
      rotacaoForma: melhor!.rot,
      posicoes,
      copiasPorFolha: copias,
      ladoA,
      ladoB: mesmaChapa ? ladoA.map((p) => ({ ...p })) : ladoB,
      mesmaChapa,
      marcasA,
      areaImprimivel: area,
      lombadaNaFolha,
      avisos: avisosF,
    };
  });

  return { formas, avisos };
}
