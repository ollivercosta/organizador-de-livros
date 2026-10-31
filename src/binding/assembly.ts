/**
 * Montagem do bloco: converte páginas locais de cada caderno/folha em páginas globais.
 *
 *  aninhada (grampo canoa) — caderno s (0 = mais externo) com P páginas:
 *     frente acumulada F_s = Σ_{j<s} P_j/2
 *     local i ≤ P/2  → global F_s + i
 *     local i > P/2  → global N − F_s − (P − i)
 *  alçada (cadernos empilhados) — O_s = Σ_{j<s} P_j ; local i → O_s + i
 *  folhas soltas — folha k: páginas 2k+1 (frente) e 2k+2 (verso)
 *  sanfona — ver sanfona.ts
 */

import type { Edge } from '../core/geometry.js';
import { encontrarEsquema, type FoldScheme } from '../fold/schemes.js';
import { simularDobra, type SignatureLayout } from '../fold/simulate.js';
import type { Montagem } from './models.js';

export interface UnidadeMontagem {
  indice: number;
  tamanho: number;
  layout: SignatureLayout;
  /** mapa[i-1] = página global (1-based) da página local i. */
  mapa: number[];
  /** Profundidade adicional por cadernos externos (aninhada): nº de folhas dobradas que envolvem este caderno. */
  envoltorias: number;
}

export function montarBloco(
  total: number,
  tamanhos: readonly number[],
  montagem: Montagem,
  esquemaPorTamanho: Readonly<Record<number, string>>,
  borda: Edge,
  esquemasExtras: readonly FoldScheme[] = [],
): UnidadeMontagem[] {
  const soma = tamanhos.reduce((a, b) => a + b, 0);
  if (soma !== total) throw new Error(`Plano de cadernos (${soma} pp) não corresponde ao total do bloco (${total} pp).`);

  if (montagem === 'sanfona') throw new Error('Sanfona é montada por sanfona.ts');

  const layoutCache = new Map<string, SignatureLayout>();
  const layoutFor = (tam: number): SignatureLayout => {
    const id = montagem === 'folhas' ? 'F2' : esquemaPorTamanho[tam];
    if (!id) throw new Error(`Sem esquema de dobra configurado para cadernos de ${tam} páginas.`);
    const key = `${id}|${borda}`;
    let l = layoutCache.get(key);
    if (!l) {
      const esquema = encontrarEsquema(id, esquemasExtras);
      l = simularDobra(esquema, { bordaEncadernacao: borda });
      if (l.paginas !== tam) throw new Error(`Esquema ${id} gera ${l.paginas} pp, mas o caderno exige ${tam} pp.`);
      if (!l.codiceValido) throw new Error(`Esquema ${id} não forma caderno encadernável: ${l.motivoInvalido}`);
      layoutCache.set(key, l);
    }
    return l;
  };

  const unidades: UnidadeMontagem[] = [];
  let frente = 0; // aninhada
  let offset = 0; // alçada/folhas
  let envoltorias = 0;
  tamanhos.forEach((P, s) => {
    const layout = layoutFor(P);
    const mapa: number[] = [];
    for (let i = 1; i <= P; i++) {
      if (montagem === 'aninhada') {
        if (P % 4 !== 0) throw new Error('Montagem aninhada exige cadernos múltiplos de 4.');
        mapa.push(i <= P / 2 ? frente + i : total - frente - (P - i));
      } else {
        mapa.push(offset + i);
      }
    }
    unidades.push({ indice: s, tamanho: P, layout, mapa, envoltorias: montagem === 'aninhada' ? envoltorias : 0 });
    frente += P / 2;
    offset += P;
    envoltorias += P / 4; // cada caderno aninhado adiciona P/4 folhas dobradas em volta dos internos
  });
  return unidades;
}

// ---------------------------------------------------------------------------------------------
// Leitura

export interface Dupla {
  /** Página à esquerda/acima (null = vazio). */
  a: number | null;
  /** Página à direita/abaixo. */
  b: number | null;
}

/**
 * Duplas de leitura de um códice com N faces na ordem de leitura.
 * LTR: a primeira página fica sozinha à DIREITA; depois (2|3), (4|5)…; a última par fica à esquerda.
 * RTL: espelhado — a primeira fica à ESQUERDA.
 * Encadernação superior: mesma lógica com "acima/abaixo".
 */
export function duplasDeLeitura(N: number, direcao: 'ltr' | 'rtl'): Dupla[] {
  const out: Dupla[] = [];
  if (N <= 0) return out;
  const push = (esq: number | null, dir: number | null) =>
    out.push(direcao === 'ltr' ? { a: esq, b: dir } : { a: dir, b: esq });
  push(null, 1);
  for (let p = 2; p <= N; p += 2) push(p, p + 1 <= N ? p + 1 : null);
  return out;
}
