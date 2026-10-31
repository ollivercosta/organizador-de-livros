/**
 * Sanfona / leporello: tira contínua de n painéis dobrada em zigue-zague.
 * Frente: painéis 1..n na ordem de leitura. Verso (lido após virar a tira lateralmente):
 * painéis n+1..2n. Na vista superior, a célula c recebe no verso a página 2n − c (LTR).
 * As junções entre painéis são dobras (sem refile, sem sangria entre painéis).
 */

import type { Edge } from '../core/geometry.js';
import type { CellResult, SignatureLayout } from '../fold/simulate.js';

export function layoutSanfona(paineis: number, direcao: 'ltr' | 'rtl'): SignatureLayout {
  if (paineis < 2) throw new Error('Sanfona exige ao menos 2 painéis.');
  const n = paineis;
  const celulas: CellResult[] = [];
  for (let c = 0; c < n; c++) {
    // posição de leitura do painel na frente
    const ordemFrente = direcao === 'ltr' ? c : n - 1 - c; // 0-based
    const paginaFrente = ordemFrente + 1;
    const paginaVerso = 2 * n - ordemFrente;
    const bordas: Record<Edge, CellResult['bordas'][Edge]> = {
      left: c === 0 ? 'frente' : 'dobra',
      right: c === n - 1 ? 'frente' : 'dobra',
      top: 'cabeca',
      bottom: 'pe',
    };
    celulas.push({
      col: c,
      row: 0,
      camada: ordemFrente,
      profundidade: 0,
      frente: { pagina: paginaFrente, col: c, row: 0, rotacao: 0, bordaLombada: null },
      verso: { pagina: paginaVerso, col: n - 1 - c, row: 0, rotacao: 0, bordaLombada: null },
      bordas,
    });
  }
  return {
    esquema: { id: `SANFONA-${n}`, nome: `Sanfona ${n} painéis`, cols: n, rows: 1, folds: [], familia: 'paralela' },
    paginas: 2 * n,
    cols: n,
    rows: 1,
    bordaEncadernacao: direcao === 'ltr' ? 'left' : 'right',
    celulaGirada: false,
    celulas,
    codiceValido: false,
    motivoInvalido: 'Sanfona não é códice; leitura por painéis.',
  };
}
