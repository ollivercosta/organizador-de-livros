import { describe, expect, it } from 'vitest';
import { montarBloco, type UnidadeMontagem } from '../src/binding/assembly.js';
import { addRot, type Rotation } from '../src/core/geometry.js';
import { verificarCaderno } from '../src/fold/oracle3d.js';
import type { SignatureLayout } from '../src/fold/simulate.js';
import { montarFormas, type Forma, type ModoImpressao, type ParametrosMaquina, type Posicionamento, type Virada } from '../src/press/layout.js';
import { verificarFormas } from '../src/validate/verify.js';

const ESQ = { 4: 'F4', 8: 'F8-AR', 12: 'F12-MX', 16: 'F16-AR', 24: 'F24-MX', 32: 'F32-AR' } as const;
const FORMATO = { largura: 160, altura: 230 };
const SANG = { lombada: 0, cabeca: 3, pe: 3, frente: 3, lateral: 3, dobra: 0 };

function maquina(modo: ModoImpressao, virada: Virada = 'lateral', rot: 'auto' | 0 | 90 = 'auto', folha = { largura: 960, altura: 660 }): ParametrosMaquina {
  return { folha, bordaPinca: 'bottom', pinca: 12, cauda: 5, margemLateral: 5, areaMarcas: 8, modo, viradaVerso: virada, posicoes: 'auto', rotacaoForma: rot };
}

/**
 * Reconstrução física: pega o que foi impresso nos lados A e B da folha, desfaz a virada
 * e a rotação da forma, monta um layout de caderno e submete ao oráculo 3D.
 */
function reconstruir(f: Forma, u: UnidadeMontagem, posicao: number): SignatureLayout {
  const W = f.folha.largura, H = f.folha.altura;
  const area = f.posicoes[posicao]!.area;
  const localDe = new Map<number, number>(u.mapa.map((g, i) => [g, i + 1]));
  type Item = { pagina: number; face: 'F' | 'B'; x: number; y: number; w: number; h: number; rotTopOrTurn: Rotation };
  const itens: Item[] = [];
  const add = (p: Posicionamento, lado: 'A' | 'B') => {
    if (p.posicao !== posicao || p.unidade !== u.indice) return;
    let { x, y } = p.corte; const { w, h } = p.corte;
    let rot = p.rotacao;
    // lado B (ou verso numa chapa única) → vista superior
    const fisicamenteNoVerso = lado === 'B' || p.face === 'B';
    if (fisicamenteNoVerso) {
      if (f.viradaVerso === 'lateral') x = W - x - w;
      else { y = H - y - h; rot = addRot(rot, 180); }
    }
    itens.push({ pagina: localDe.get(p.pagina)!, face: p.face, x: x - area.x, y: y - area.y, w, h, rotTopOrTurn: rot });
  };
  if (f.mesmaChapa) {
    // chapa única: na metade "de origem" os itens F estão no lado A; os itens B foram espelhados
    f.ladoA.forEach((p) => add(p, 'A'));
  } else {
    f.ladoA.forEach((p) => add(p, 'A'));
    f.ladoB.forEach((p) => add(p, 'B'));
  }
  // desfaz rotação de 90° da forma
  if (f.rotacaoForma === 90) {
    const Hf = area.w; // altura original = largura girada
    for (const it of itens) {
      const nx = it.y; const ny = Hf - it.x - it.w;
      [it.x, it.y, it.w, it.h] = [nx, ny, it.h, it.w];
      it.rotTopOrTurn = it.face === 'F' ? addRot(it.rotTopOrTurn, 270) : addRot(it.rotTopOrTurn, 90);
    }
  }
  const xs = [...new Set(itens.map((i) => Math.round(i.x * 1000)))].sort((a, b) => a - b);
  const ys = [...new Set(itens.map((i) => Math.round(i.y * 1000)))].sort((a, b) => a - b);
  const L = structuredClone(u.layout);
  for (const c of L.celulas) {
    const F = itens.find((i) => i.face === 'F' && xs.indexOf(Math.round(i.x * 1000)) === c.col && ys.indexOf(Math.round(i.y * 1000)) === c.row);
    const B = itens.find((i) => i.face === 'B' && xs.indexOf(Math.round(i.x * 1000)) === c.col && ys.indexOf(Math.round(i.y * 1000)) === c.row);
    if (!F || !B) throw new Error(`célula ${c.col},${c.row} sem frente/verso na folha`);
    c.frente.pagina = F.pagina; c.frente.rotacao = F.rotTopOrTurn;
    c.verso.pagina = B.pagina; c.verso.rotacao = B.rotTopOrTurn;
  }
  return L;
}

function semSobreposicao(lista: Posicionamento[]): boolean {
  for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
    const a = lista[i]!.corte, b = lista[j]!.corte;
    if (a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6) return false;
  }
  return true;
}

const CASOS: Array<{ nome: string; plano: number[]; montagem: 'aninhada' | 'alcada' | 'folhas'; borda: 'left' | 'right' | 'top' }> = [
  { nome: 'canoa 32 pp em 1×32', plano: [32], montagem: 'aninhada', borda: 'left' },
  { nome: 'canoa 32 pp em 2×16', plano: [16, 16], montagem: 'aninhada', borda: 'left' },
  { nome: 'canoa 28 pp 16+8+4', plano: [16, 8, 4], montagem: 'aninhada', borda: 'left' },
  { nome: 'PUR 64 pp 4×16', plano: [16, 16, 16, 16], montagem: 'alcada', borda: 'left' },
  { nome: 'costurado RTL 48 pp 2×24', plano: [24, 24], montagem: 'alcada', borda: 'right' },
  { nome: 'calendário superior 12 pp', plano: [12], montagem: 'alcada', borda: 'top' },
  { nome: 'wire-o 20 pp', plano: Array(10).fill(2), montagem: 'folhas', borda: 'left' },
];
const MODOS: Array<[ModoImpressao, Virada]> = [['frente_verso', 'lateral'], ['frente_verso', 'pinca'], ['virada_lateral', 'lateral'], ['virada_pinca', 'pinca'], ['perfecting', 'pinca']];

describe('layout de máquina — reconstrução física de ponta a ponta', () => {
  for (const caso of CASOS) {
    for (const [modo, virada] of MODOS) {
      for (const rot of [0, 90] as const) {
        it(`${caso.nome} · ${modo}/${virada} · forma ${rot}°`, () => {
          const N = caso.plano.reduce((a, b) => a + b, 0);
          const unidades = montarBloco(N, caso.plano, caso.montagem, ESQ, caso.borda);
          const porEsq = new Map<SignatureLayout, UnidadeMontagem[]>();
          for (const u of unidades) porEsq.set(u.layout, [...(porEsq.get(u.layout) ?? []), u]);
          const formas: Forma[] = [];
          for (const [, us] of porEsq) {
            const r = montarFormas(us.map((u) => ({ layout: u.layout, mapa: u.mapa, unidade: u.indice, profundidadeExtra: 0 })), FORMATO, SANG,
              maquina(modo, virada, rot, modo === 'virada_lateral' || modo === 'virada_pinca' ? { largura: 2100, altura: 2100 } : { largura: 1020, altura: 1020 }),
              () => 0, caso.montagem === 'folhas' ? 'corte_empilhamento' : 'repetir', caso.montagem === 'alcada');
            expect(r.avisos).toEqual([]);
            expect(r.formas.length).toBeGreaterThan(0);
            formas.push(...r.formas);
          }
          expect(verificarFormas(formas, unidades)).toEqual([]);
          let reconstruidas = 0;
          for (const f of formas) {
            expect(semSobreposicao(f.ladoA)).toBe(true);
            expect(semSobreposicao(f.ladoB)).toBe(true);
            // tudo dentro da área imprimível (corte + sangria)
            for (const p of [...f.ladoA, ...f.ladoB]) {
              expect(p.corte.x - p.sangria.l).toBeGreaterThanOrEqual(-1e-6);
              expect(p.corte.y - p.sangria.t).toBeGreaterThanOrEqual(-1e-6);
              expect(p.corte.x + p.corte.w + p.sangria.r).toBeLessThanOrEqual(f.folha.largura + 1e-6);
              expect(p.corte.y + p.corte.h + p.sangria.b).toBeLessThanOrEqual(f.folha.altura + 1e-6);
            }
            reconstruidas += f.posicoes.length;
            f.posicoes.forEach((pos, i) => {
              const u = unidades.find((x) => x.indice === pos.unidade)!;
              const L = reconstruir(f, u, i);
              const o = verificarCaderno(L);
              if (!o.ok) throw new Error(`${f.id} posição ${i + 1}: ${o.erros.slice(0, 4).join('; ')}`);
            });
          }
          expect(reconstruidas).toBeGreaterThan(0);
        });
      }
    }
  }
});

describe('aproveitamento e cópias por folha', () => {
  it('16 pp 160×230 em 960×660: frente/verso = 1 cópia; virada lateral exige folha com 2 formas', () => {
    const [u] = montarBloco(16, [16], 'alcada', ESQ, 'left');
    const fv = montarFormas([{ layout: u!.layout, mapa: u!.mapa, unidade: 0, profundidadeExtra: 0 }], FORMATO, SANG, maquina('frente_verso'), () => 0, 'repetir', false);
    expect(fv.formas[0]!.copiasPorFolha[0]).toBe(1);
    const vl = montarFormas([{ layout: u!.layout, mapa: u!.mapa, unidade: 0, profundidadeExtra: 0 }], FORMATO, SANG, maquina('virada_lateral'), () => 0, 'repetir', false);
    expect(vl.formas.length).toBe(0); // 2 × (4×160 + sangrias) > 960
    expect(vl.avisos[0]).toMatch(/não cabe/);
    const vl2 = montarFormas([{ layout: u!.layout, mapa: u!.mapa, unidade: 0, profundidadeExtra: 0 }], FORMATO, SANG, maquina('virada_lateral', 'lateral', 'auto', { largura: 1400, altura: 1000 }), () => 0, 'repetir', false);
    expect(vl2.formas[0]!.copiasPorFolha[0]).toBe(2 * vl2.formas[0]!.posicoes.length);
    expect(vl2.formas[0]!.mesmaChapa).toBe(true);
  });
  it('creep desloca o conteúdo em direção à lombada e cresce com a profundidade', () => {
    const [u] = montarBloco(32, [32], 'aninhada', ESQ, 'left');
    const t = 0.1;
    const r = montarFormas([{ layout: u!.layout, mapa: u!.mapa, unidade: 0, profundidadeExtra: 0 }], FORMATO, SANG, maquina('frente_verso', 'lateral', 'auto', { largura: 1020, altura: 1400 }), (d) => d * t, 'repetir', false);
    const f = r.formas[0]!;
    const todas = [...f.ladoA, ...f.ladoB];
    const p1 = todas.find((p) => p.pagina === 1)!; const p16 = todas.find((p) => p.pagina === 16)!; const p17 = todas.find((p) => p.pagina === 17)!;
    expect(Math.hypot(p1.creep.dx, p1.creep.dy)).toBe(0);
    expect(Math.hypot(p16.creep.dx, p16.creep.dy)).toBeCloseTo(7 * t, 6); // folha central: 8 folhas → profundidade 7
    expect(Math.hypot(p17.creep.dx, p17.creep.dy)).toBeCloseTo(7 * t, 6);
  });
});
