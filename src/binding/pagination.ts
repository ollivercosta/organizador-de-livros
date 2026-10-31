/**
 * Paginação: registro de páginas, separação capa/miolo, compatibilidade e propostas de ajuste.
 *
 * Regras atendidas: RN-003 (leitura ≠ imposição), RN-004 (incompatibilidade sinalizada,
 * nada aplicado sem consentimento), RN-005 (branco explícito), RN-006 (modelo de capa
 * declarado), RN-013 (nenhuma página omitida/duplicada).
 */

import type { ModeloCapa, Montagem } from './models.js';

export type PapelPagina = '1a_capa' | '2a_capa' | '3a_capa' | '4a_capa' | 'miolo' | 'guarda';

export interface PaginaRegistro {
  /** Identificador estável (não muda quando a ordem muda). */
  id: string;
  tipo: 'conteudo' | 'branco';
  papel: PapelPagina;
  rotulo?: string;
  /** Página do arquivo de origem (0-based) — ausente em brancos inseridos. */
  origem?: { arquivo: string; indice: number };
  /** Obrigatório para brancos inseridos pelo sistema/usuário (RN-005). */
  motivo?: string;
  autor?: string;
  criadoEm?: string;
}

export interface FonteCapa {
  /** Onde estão as faces da capa. */
  fonte: 'no_pdf' | 'arquivo_separado' | 'nao_impressa';
  /**
   * Quantas faces da capa estão no PDF do miolo (no início e no fim):
   *  4 → 1ª e 2ª no início, 3ª e 4ª no fim;
   *  2 → 1ª no início, 4ª no fim (2ª e 3ª não impressas — comum em capa dura e capa sem verso).
   */
  facesNoPdf?: 2 | 4;
}

export interface Componentes {
  capa: PaginaRegistro[] | null;
  miolo: PaginaRegistro[];
  avisos: string[];
}

/** Cria o registro de páginas a partir de um arquivo com `total` páginas na ordem de leitura. */
export function registrarPaginas(arquivo: string, total: number): PaginaRegistro[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `${arquivo}#${i + 1}`,
    tipo: 'conteudo' as const,
    papel: 'miolo' as const,
    origem: { arquivo, indice: i },
    rotulo: `Pág. ${i + 1} do arquivo`,
  }));
}

/**
 * Separa capa e miolo conforme o modelo de capa DECLARADO (RN-006).
 * Nunca deduz o modelo: se a declaração for incoerente com o arquivo, gera aviso.
 */
export function separarComponentes(paginas: readonly PaginaRegistro[], modelo: ModeloCapa, fonte: FonteCapa): Componentes {
  const avisos: string[] = [];
  const copia = paginas.map((p) => ({ ...p }));

  if (modelo === 'autocapa') {
    const n = copia.length;
    if (n >= 4) {
      copia[0]!.papel = '1a_capa';
      copia[1]!.papel = '2a_capa';
      copia[n - 2]!.papel = '3a_capa';
      copia[n - 1]!.papel = '4a_capa';
    } else {
      avisos.push('Autocapa exige ao menos 4 páginas.');
    }
    return { capa: null, miolo: copia, avisos };
  }

  if (modelo === 'sem_capa') return { capa: null, miolo: copia, avisos };

  if (fonte.fonte === 'no_pdf') {
    const k = fonte.facesNoPdf ?? 4;
    if (copia.length < k + 2) {
      avisos.push('O arquivo tem páginas insuficientes para separar capa e miolo.');
      return { capa: null, miolo: copia, avisos };
    }
    const n = copia.length;
    let capa: PaginaRegistro[];
    let miolo: PaginaRegistro[];
    if (k === 4) {
      capa = [copia[0]!, copia[1]!, copia[n - 2]!, copia[n - 1]!];
      miolo = copia.slice(2, n - 2);
      (['1a_capa', '2a_capa', '3a_capa', '4a_capa'] as const).forEach((papel, i) => (capa[i]!.papel = papel));
    } else {
      const c1 = copia[0]!;
      const c4 = copia[n - 1]!;
      c1.papel = '1a_capa';
      c4.papel = '4a_capa';
      capa = [c1, branco('capa-2', '2a_capa', 'Face interna da capa não impressa'), branco('capa-3', '3a_capa', 'Face interna da contracapa não impressa'), c4];
      miolo = copia.slice(1, n - 1);
    }
    return { capa, miolo, avisos };
  }

  if (fonte.fonte === 'nao_impressa') {
    return {
      capa: (['1a_capa', '2a_capa', '3a_capa', '4a_capa'] as const).map((p) => branco(`capa-${p}`, p, 'Capa sem impressão')),
      miolo: copia,
      avisos,
    };
  }

  // arquivo separado: a capa é registrada à parte; o miolo é o arquivo inteiro.
  return { capa: null, miolo: copia, avisos };
}

export function branco(id: string, papel: PapelPagina, motivo: string, autor?: string): PaginaRegistro {
  return { id, tipo: 'branco', papel, motivo, autor, rotulo: 'Página em branco' };
}

// ---------------------------------------------------------------------------------------------
// Planejamento de cadernos

export interface PlanoCadernos {
  /** Tamanhos (em páginas) de cada unidade, na ordem de montagem (externo→interno se aninhada). */
  tamanhos: number[];
  total: number;
  brancosNecessarios: number;
  /** Ajuste por remoção de brancos já existentes (negativo = remover). */
  ajuste: number;
  descricao: string;
}

/**
 * Encontra planos de cadernos válidos para `n` páginas.
 * - `tamanhos`: tamanhos de caderno aceitos pela gráfica (ex.: [32, 16, 8, 4]).
 * - `brancosRemoviveis`: brancos já presentes que o usuário aceita remover.
 * Retorna opções ordenadas por menor alteração de páginas e depois por menos cadernos.
 * Não altera nada — apenas propõe (RN-004).
 */
export function planejarCadernos(n: number, montagem: Montagem, tamanhos: readonly number[], brancosRemoviveis = 0): PlanoCadernos[] {
  if (n <= 0) return [];
  if (montagem === 'folhas') {
    const total = Math.ceil(n / 2) * 2;
    const op: PlanoCadernos[] = [{ tamanhos: Array(total / 2).fill(2), total, brancosNecessarios: total - n, ajuste: total - n, descricao: `${total / 2} folhas soltas` }];
    if (total !== n && brancosRemoviveis > 0) {
      const t2 = total - 2;
      if (t2 >= n - brancosRemoviveis && t2 > 0) op.push({ tamanhos: Array(t2 / 2).fill(2), total: t2, brancosNecessarios: 0, ajuste: t2 - n, descricao: `${t2 / 2} folhas soltas (removendo ${n - t2} branco)` });
    }
    return op;
  }
  if (montagem === 'sanfona') {
    const total = Math.ceil(n / 2) * 2;
    return [{ tamanhos: [total], total, brancosNecessarios: total - n, ajuste: total - n, descricao: `Sanfona com ${total / 2} painéis` }];
  }

  const sizes = [...new Set(tamanhos)].filter((t) => t >= 4 && t % 4 === 0).sort((a, b) => b - a);
  if (sizes.length === 0) throw new Error('Nenhum tamanho de caderno válido (múltiplos de 4).');
  const maxS = sizes[0]!;
  const limite = n + maxS * 2;
  // DP: menor número de cadernos para cada total; desempate pelos maiores cadernos primeiro.
  const best: (number[] | null)[] = Array(limite + 1).fill(null);
  best[0] = [];
  for (let t = 1; t <= limite; t++) {
    let melhor: number[] | null = null;
    for (const s of sizes) {
      if (t - s < 0) continue;
      const prev = best[t - s];
      if (!prev) continue;
      const cand = [...prev, s].sort((a, b) => b - a);
      if (!melhor || cand.length < melhor.length || (cand.length === melhor.length && cmpDesc(cand, melhor) < 0)) melhor = cand;
    }
    best[t] = melhor;
  }

  const opcoes: PlanoCadernos[] = [];
  const minT = Math.max(4, n - brancosRemoviveis);
  for (let t = minT; t <= limite; t++) {
    const plano = best[t];
    if (!plano) continue;
    const ajuste = t - n;
    opcoes.push({
      tamanhos: plano,
      total: t,
      brancosNecessarios: Math.max(0, ajuste),
      ajuste,
      descricao: `${plano.length} caderno(s): ${plano.join(' + ')} = ${t} pp` + (ajuste > 0 ? ` (+${ajuste} branco)` : ajuste < 0 ? ` (remove ${-ajuste} branco)` : ''),
    });
  }
  opcoes.sort((a, b) => Math.abs(a.ajuste) - Math.abs(b.ajuste) || a.tamanhos.length - b.tamanhos.length || a.total - b.total);
  // Mantém as opções mais relevantes: até 2 por quantidade de ajuste.
  const vistos = new Map<number, number>();
  return opcoes.filter((o) => {
    const c = vistos.get(o.ajuste) ?? 0;
    vistos.set(o.ajuste, c + 1);
    return c < 2;
  }).slice(0, 6);
}

function cmpDesc(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i]! - a[i]!;
  return a.length - b.length;
}

// ---------------------------------------------------------------------------------------------
// Inserção explícita de brancos (só executada com consentimento do usuário)

export type PosicaoBranco =
  | { tipo: 'fim' }
  | { tipo: 'inicio' }
  /** Antes das duas últimas páginas (mantém 3ª e 4ª capa nas posições externas em autocapa). */
  | { tipo: 'antes_da_contracapa' }
  | { tipo: 'apos_indice'; indice: number };

export function inserirBrancos(
  paginas: readonly PaginaRegistro[],
  quantidade: number,
  posicao: PosicaoBranco,
  motivo: string,
  autor: string,
  agora = new Date().toISOString(),
): PaginaRegistro[] {
  if (quantidade <= 0) return [...paginas];
  if (!motivo.trim()) throw new Error('RN-005: todo branco inserido exige motivo.');
  const novos: PaginaRegistro[] = Array.from({ length: quantidade }, (_, i) => ({
    ...branco(`branco-${agora}-${i + 1}`, 'miolo', motivo, autor),
    criadoEm: agora,
  }));
  const arr = [...paginas];
  let idx: number;
  switch (posicao.tipo) {
    case 'fim': idx = arr.length; break;
    case 'inicio': idx = 0; break;
    case 'antes_da_contracapa': idx = Math.max(0, arr.length - 2); break;
    case 'apos_indice': idx = Math.min(arr.length, Math.max(0, posicao.indice + 1)); break;
  }
  arr.splice(idx, 0, ...novos);
  return arr;
}

export function removerPagina(paginas: readonly PaginaRegistro[], id: string): PaginaRegistro[] {
  const p = paginas.find((x) => x.id === id);
  if (!p) throw new Error(`Página ${id} não encontrada`);
  if (p.tipo !== 'branco') throw new Error('Só páginas em branco podem ser removidas pelo ajuste de paginação; conteúdo exige nova versão do arquivo.');
  return paginas.filter((x) => x.id !== id);
}
