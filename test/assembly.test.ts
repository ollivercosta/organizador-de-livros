import { describe, expect, it } from 'vitest';
import { duplasDeLeitura, montarBloco, type UnidadeMontagem } from '../src/binding/assembly.js';
import { inserirBrancos, planejarCadernos, registrarPaginas, separarComponentes } from '../src/binding/pagination.js';
import { layoutSanfona } from '../src/binding/sanfona.js';

const ESQ = { 4: 'F4', 8: 'F8-AR', 12: 'F12-MX', 16: 'F16-AR', 24: 'F24-MX', 32: 'F32-AR', 64: 'F64-AR' } as const;

/** Leitura física independente: empilha as folhas como no livro real e lê página a página. */
function lerLivro(unidades: UnidadeMontagem[], aninhada: boolean): number[] {
  const folhasDe = (u: UnidadeMontagem) => {
    const n = u.layout.celulas.length;
    return Array.from({ length: n }, (_, L) => [u.mapa[2 * L]!, u.mapa[2 * L + 1]!] as const);
  };
  let folhas: (readonly [number, number])[];
  if (aninhada) {
    // recursivo: metade externa, internos, metade final
    const rec = (i: number): (readonly [number, number])[] => {
      if (i >= unidades.length) return [];
      const f = folhasDe(unidades[i]!);
      const h = f.length / 2;
      return [...f.slice(0, h), ...rec(i + 1), ...f.slice(h)];
    };
    folhas = rec(0);
  } else {
    folhas = unidades.flatMap(folhasDe);
  }
  return folhas.flat();
}

describe('grampo canoa (aninhada) — fórmula fechada do documento', () => {
  for (const N of [4, 8, 12, 16, 20, 28, 32, 48, 64, 100, 200]) {
    it(`${N} pp em folhas de 4 pp: folha k externa [N−2k | 1+2k], interna [2+2k | N−1−2k]`, () => {
      const u = montarBloco(N, Array(N / 4).fill(4), 'aninhada', ESQ, 'left');
      u.forEach((un, k) => {
        const cel = un.layout.celulas;
        const externa = [...cel].sort((a, b) => a.verso.col - b.verso.col).map((c) => un.mapa[c.verso.pagina - 1]);
        const interna = [...cel].sort((a, b) => a.frente.col - b.frente.col).map((c) => un.mapa[c.frente.pagina - 1]);
        expect(externa).toEqual([N - 2 * k, 1 + 2 * k]);
        expect(interna).toEqual([2 + 2 * k, N - 1 - 2 * k]);
      });
      expect(lerLivro(u, true)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    });
  }
  it('o exemplo de 32 pp do protótipo (8 folhas) bate com a tabela original', () => {
    const u = montarBloco(32, Array(8).fill(4), 'aninhada', ESQ, 'left');
    const tabela = [[32, 1, 2, 31], [30, 3, 4, 29], [28, 5, 6, 27], [26, 7, 8, 25], [24, 9, 10, 23], [22, 11, 12, 21], [20, 13, 14, 19], [18, 15, 16, 17]];
    u.forEach((un, k) => {
      const cel = un.layout.celulas;
      const ext = [...cel].sort((a, b) => a.verso.col - b.verso.col).map((c) => un.mapa[c.verso.pagina - 1]);
      const int = [...cel].sort((a, b) => a.frente.col - b.frente.col).map((c) => un.mapa[c.frente.pagina - 1]);
      expect([...ext, ...int]).toEqual(tabela[k]);
    });
  });
  it('cadernos aninhados de tamanhos mistos (16+8+4+4) mantêm a leitura física', () => {
    const plano = [16, 8, 4, 4];
    const u = montarBloco(32, plano, 'aninhada', ESQ, 'left');
    expect(lerLivro(u, true)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(u.map((x) => x.envoltorias)).toEqual([0, 4, 6, 7]);
  });
});

describe('cadernos alçados (costura, PUR, hotmelt, capa dura)', () => {
  for (const plano of [[16, 16, 16], [32, 16, 8], [24, 24], [12, 12, 4], [64, 32], [8, 8, 8, 4]]) {
    it(`plano ${plano.join('+')} lê em ordem — LTR, RTL e superior`, () => {
      const N = plano.reduce((a, b) => a + b, 0);
      for (const borda of ['left', 'right', 'top'] as const) {
        const u = montarBloco(N, plano, 'alcada', ESQ, borda);
        expect(lerLivro(u, false)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
      }
    });
  }
  it('folhas soltas (wire-o, espiral): folha k = páginas 2k+1/2k+2', () => {
    const u = montarBloco(10, Array(5).fill(2), 'folhas', ESQ, 'left');
    expect(lerLivro(u, false)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('duplas de leitura (correção do protótipo v0.1)', () => {
  it('LTR: 1 sozinha à direita, depois 2|3 … 30|31, 32 sozinha à esquerda — 17 vistas', () => {
    const d = duplasDeLeitura(32, 'ltr');
    expect(d.length).toBe(17);
    expect(d[0]).toEqual({ a: null, b: 1 });
    expect(d[1]).toEqual({ a: 2, b: 3 });
    expect(d[16]).toEqual({ a: 32, b: null });
    // nunca exibe frente e verso da mesma folha lado a lado
    for (const x of d) if (x.a && x.b) expect(x.a % 2).toBe(0);
  });
  it('RTL espelha', () => {
    const d = duplasDeLeitura(8, 'rtl');
    expect(d[0]).toEqual({ a: 1, b: null });
    expect(d[1]).toEqual({ a: 3, b: 2 });
  });
});

describe('planejamento de cadernos', () => {
  it('caso do livro infantil — 30 pp, autocapa: +2 brancos → 1 caderno de 32 pp', () => {
    const op = planejarCadernos(30, 'aninhada', [32, 16, 8, 4]);
    expect(op[0]!.total).toBe(32);
    expect(op[0]!.tamanhos).toEqual([32]);
    expect(op[0]!.brancosNecessarios).toBe(2);
  });
  it('caso do livro infantil — capa separada: miolo 26 pp → 28 pp (16+8+4) com +2 brancos', () => {
    const op = planejarCadernos(26, 'aninhada', [32, 16, 8, 4]);
    expect(op[0]!.total).toBe(28);
    expect(op[0]!.tamanhos).toEqual([16, 8, 4]);
  });
  it('remoção do branco existente é oferecida só se fechar um múltiplo válido', () => {
    const op = planejarCadernos(30, 'aninhada', [32, 16, 8, 4], 1);
    expect(op.every((o) => o.total >= 29)).toBe(true);
    expect(op.some((o) => o.ajuste < 0)).toBe(false); // 29 não é múltiplo de 4
  });
  it('DP: número mínimo de cadernos confere com busca exaustiva (N até 160)', () => {
    const sizes = [32, 16, 8, 4];
    const minExaust = (t: number): number => {
      let best = Infinity;
      const rec = (rest: number, cnt: number, from: number) => {
        if (rest === 0) { best = Math.min(best, cnt); return; }
        for (let i = from; i < sizes.length; i++) if (sizes[i]! <= rest) rec(rest - sizes[i]!, cnt + 1, i);
      };
      rec(t, 0, 0);
      return best;
    };
    for (let n = 4; n <= 160; n += 4) {
      const op = planejarCadernos(n, 'alcada', sizes).find((o) => o.ajuste === 0)!;
      expect(op.tamanhos.reduce((a, b) => a + b, 0)).toBe(n);
      expect(op.tamanhos.length).toBe(minExaust(n));
    }
  });
});

describe('capa e brancos', () => {
  it('autocapa: papéis 1ª..4ª nas posições externas; brancos antes da contracapa', () => {
    const p = registrarPaginas('livro.pdf', 30);
    const p2 = inserirBrancos(p, 2, { tipo: 'antes_da_contracapa' }, 'Completar caderno de 32 pp', 'usuário', '2026-10-31T00:00:00Z');
    const c = separarComponentes(p2, 'autocapa', { fonte: 'no_pdf' });
    expect(c.miolo.length).toBe(32);
    expect(c.miolo[0]!.papel).toBe('1a_capa');
    expect(c.miolo[31]!.papel).toBe('4a_capa');
    expect(c.miolo[30]!.origem?.indice).toBe(28); // 3ª capa = pág. 29 do arquivo
    expect(c.miolo[30]!.papel).toBe("3a_capa");
    expect(c.miolo.slice(28, 30).every((x) => x.tipo === 'branco' && x.motivo)).toBe(true);
  });
  it('capa separada no PDF (4 faces): miolo = arquivo − 4', () => {
    const c = separarComponentes(registrarPaginas('a', 30), 'separada_flexivel', { fonte: 'no_pdf', facesNoPdf: 4 });
    expect(c.capa!.length).toBe(4);
    expect(c.miolo.length).toBe(26);
  });
  it('branco sem motivo é recusado (RN-005)', () => {
    expect(() => inserirBrancos(registrarPaginas('a', 2), 1, { tipo: 'fim' }, '  ', 'x')).toThrow();
  });
});

describe('sanfona', () => {
  it('6 painéis: frente 1..6, verso 7..12 lido após virar', () => {
    const l = layoutSanfona(6, 'ltr');
    const frente = [...l.celulas].sort((a, b) => a.frente.col - b.frente.col).map((c) => c.frente.pagina);
    const verso = [...l.celulas].sort((a, b) => a.verso.col - b.verso.col).map((c) => c.verso.pagina);
    expect(frente).toEqual([1, 2, 3, 4, 5, 6]);
    expect(verso).toEqual([7, 8, 9, 10, 11, 12]);
    // verso do painel 6 é o 7 (mesma célula)
    const c6 = l.celulas.find((c) => c.frente.pagina === 6)!;
    expect(c6.verso.pagina).toBe(7);
  });
});
