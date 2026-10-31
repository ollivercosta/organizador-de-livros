/**
 * Pares de impressão ("lado a lado", printer spreads): para cada folha dobrada, as duas páginas
 * que ficam lado a lado em cada face. É o formato que muitas gráficas pedem para livretos.
 *
 * Numa unidade (caderno) de P páginas e L = P/2 folhas, a folha dobrada k une as folhas k e L−1−k:
 *   lado de fora   = [P−2k | 2k+1]
 *   lado de dentro = [2k+2 | P−2k−1]
 * (números locais, convertidos pelo mapa da montagem; em RTL a ordem visual se inverte).
 * No grampo canoa (aninhado) as unidades vêm da mais externa para a mais interna, então a lista
 * reproduz exatamente a ordem "imprimir livreto": N|1, 2|N−1, N−2|3, 4|N−3…
 */

import type { UnidadeMontagem } from './assembly.js';
import type { Montagem } from './models.js';

export interface ParImpressao {
  folha: number;
  caderno: number;
  /** Profundidade da folha dobrada (0 = mais externa) — usada no creep. */
  profundidade: number;
  /** Páginas na ordem visual [esquerda, direita]; 0 = sem página (folha solta). */
  fora: [number, number];
  dentro: [number, number];
  solta: boolean;
}

export function paresDeImpressao(unidades: readonly UnidadeMontagem[], montagem: Montagem, direcao: 'ltr' | 'rtl'): ParImpressao[] {
  const out: ParImpressao[] = [];
  if (montagem === 'sanfona') return out;
  const vis = (a: number, b: number): [number, number] => (direcao === 'rtl' ? [b, a] : [a, b]);
  let n = 0;
  for (const u of unidades) {
    const P = u.tamanho;
    if (u.layout.esquema.folds.length === 0) {
      out.push({ folha: ++n, caderno: u.indice + 1, profundidade: 0, fora: [u.mapa[0]!, 0], dentro: [u.mapa[1]!, 0], solta: true });
      continue;
    }
    for (let k = 0; k < P / 4; k++) {
      out.push({
        folha: ++n, caderno: u.indice + 1, profundidade: u.envoltorias + k,
        fora: vis(u.mapa[P - 2 * k - 1]!, u.mapa[2 * k]!),
        dentro: vis(u.mapa[2 * k + 1]!, u.mapa[P - 2 * k - 2]!),
        solta: false,
      });
    }
  }
  return out;
}
