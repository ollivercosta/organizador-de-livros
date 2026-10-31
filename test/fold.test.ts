import { describe, expect, it } from 'vitest';
import type { Edge } from '../src/core/geometry.js';
import { verificarCaderno } from '../src/fold/oracle3d.js';
import { ESQUEMAS_BASE, type FoldScheme, type FoldStep } from '../src/fold/schemes.js';
import { simularDobra, type SignatureLayout } from '../src/fold/simulate.js';
import { regrasLocais } from '../src/validate/verify.js';

const BORDAS: Edge[] = ['left', 'right', 'top'];
const sym = (r: number) => (r === 0 ? '' : r === 180 ? 'v' : r === 90 ? '>' : '<');
function grade(l: SignatureLayout, face: 'frente' | 'verso'): string {
  const g: string[][] = Array.from({ length: l.rows }, () => Array(l.cols).fill(''));
  for (const c of l.celulas) { const f = c[face]; g[f.row]![f.col] = f.pagina + sym(f.rotacao); }
  return g.map((r) => r.join(' ')).join(' / ');
}

describe('simulador de dobra — catálogo base', () => {
  for (const e of ESQUEMAS_BASE) {
    for (const b of BORDAS) {
      it(`${e.id} encadernação ${b}: regras locais + oráculo 3D`, () => {
        const l = simularDobra(e, { bordaEncadernacao: b });
        expect(l.paginas).toBe(e.cols * e.rows * 2);
        if (e.id === 'F6-RL') {
          expect(l.codiceValido).toBe(false);
          return;
        }
        expect(l.codiceValido).toBe(true);
        expect(regrasLocais(l)).toEqual([]);
        const o = verificarCaderno(l);
        expect(o.erros).toEqual([]);
      });
    }
  }
});

describe('referências clássicas de imposição (literatura de pré-impressão)', () => {
  it('8 páginas ângulo reto: frente 5 4 (invertidas) / 8 1 ; verso 3 6 (invertidas) / 2 7', () => {
    const l = simularDobra(ESQUEMAS_BASE.find((e) => e.id === 'F8-AR')!, { bordaEncadernacao: 'left' });
    expect(grade(l, 'frente')).toBe('5v 4v / 8 1');
    expect(grade(l, 'verso')).toBe('3v 6v / 2 7');
  });
  it('16 páginas ângulo reto: frente 5 12 9 8 (invertidas) / 4 13 16 1', () => {
    const l = simularDobra(ESQUEMAS_BASE.find((e) => e.id === 'F16-AR')!, { bordaEncadernacao: 'left' });
    expect(grade(l, 'frente')).toBe('5v 12v 9v 8v / 4 13 16 1');
    expect(grade(l, 'verso')).toBe('7v 10v 11v 6v / 2 15 14 3');
  });
  it('4 páginas: externa 4 | 1, interna 2 | 3, todas em pé', () => {
    const l = simularDobra(ESQUEMAS_BASE.find((e) => e.id === 'F4')!, { bordaEncadernacao: 'left' });
    expect(grade(l, 'verso')).toBe('4 1');
    expect(grade(l, 'frente')).toBe('2 3');
  });
  it('4 páginas RTL (mangá/árabe): externa 1 | 4, interna 3 | 2', () => {
    const l = simularDobra(ESQUEMAS_BASE.find((e) => e.id === 'F4')!, { bordaEncadernacao: 'right' });
    expect(regrasLocais(l)).toEqual([]);
    expect(verificarCaderno(l).ok).toBe(true);
    expect(grade(l, 'verso')).toBe('1 4');
    expect(grade(l, 'frente')).toBe('3 2');
  });
  it('folha solta com encadernação superior (calendário): verso gira 180° na virada lateral', () => {
    const l = simularDobra(ESQUEMAS_BASE.find((e) => e.id === 'F2')!, { bordaEncadernacao: 'top' });
    expect(l.celulas[0]!.frente.rotacao).toBe(0);
    expect(l.celulas[0]!.verso.rotacao).toBe(180);
  });
});

// ------------------------------------------------------------------------------------------
// Teste por propriedades: esquemas de dobra aleatórios fisicamente válidos.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function esquemaAleatorio(r: () => number): FoldScheme {
  // constrói "de trás para a frente": parte de 1×1 e desdobra em metades ou terços (rolo)
  let cols = 1, rows = 1;
  const folds: FoldStep[] = [];
  const nFolds = 1 + Math.floor(r() * 5);
  for (let i = 0; i < nFolds; i++) {
    const axis = r() < 0.5 ? 'x' : 'y';
    const last = i === 0; // a primeira gerada é a última dobra (lombada) → meia dobra
    const roll = !last && r() < 0.25;
    const dim = axis === 'x' ? cols : rows;
    const move = r() < 0.5 ? 'high' : 'low';
    const dir = r() < 0.5 ? 'over' : 'under';
    if (roll) {
      // dobra que acrescenta metade do tamanho atual (parte móvel = dim/… menor que a fixa)
      if (dim % 2 !== 0) continue;
      const add = dim / 2;
      const at = move === 'high' ? dim : add;
      folds.unshift({ axis, at, move, dir });
      if (axis === 'x') cols += add; else rows += add;
    } else {
      const at = dim;
      folds.unshift({ axis, at, move, dir });
      if (axis === 'x') cols *= 2; else rows *= 2;
    }
  }
  return { id: 'rand', nome: 'aleatório', cols, rows, folds, familia: 'mista' };
}

describe('propriedades: 3000 esquemas de dobra aleatórios', () => {
  it('todo esquema válido passa nas regras locais e no oráculo 3D, em todas as bordas', () => {
    const r = rng(20261031);
    let testados = 0; let codices = 0;
    for (let i = 0; i < 3000; i++) {
      const e = esquemaAleatorio(r);
      for (const b of BORDAS) {
        let l: SignatureLayout;
        try { l = simularDobra(e, { bordaEncadernacao: b }); } catch { continue; }
        testados++;
        if (!l.codiceValido) continue;
        codices++;
        const loc = regrasLocais(l);
        if (loc.length) throw new Error(`${JSON.stringify(e)} ${b}: ${loc.join('; ')}`);
        const o = verificarCaderno(l);
        if (!o.ok) throw new Error(`${JSON.stringify(e)} ${b}: ${o.erros.join('; ')}`);
      }
    }
    expect(testados).toBeGreaterThan(5000);
    expect(codices).toBeGreaterThan(3000);
  });

  it('o oráculo detecta imposição adulterada (troca de páginas e rotação errada)', () => {
    const l = simularDobra(ESQUEMAS_BASE.find((e) => e.id === 'F16-AR')!, { bordaEncadernacao: 'left' });
    const trocado: SignatureLayout = structuredClone(l);
    const a = trocado.celulas[0]!.frente.pagina; trocado.celulas[0]!.frente.pagina = trocado.celulas[1]!.frente.pagina; trocado.celulas[1]!.frente.pagina = a;
    expect(verificarCaderno(trocado).ok).toBe(false);
    const girado: SignatureLayout = structuredClone(l);
    girado.celulas[3]!.verso.rotacao = girado.celulas[3]!.verso.rotacao === 0 ? 180 : 0;
    expect(verificarCaderno(girado).ok).toBe(false);
  });
});
