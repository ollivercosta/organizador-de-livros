/**
 * Estados de evidência (RN-001, RN-009, seção 14 do documento).
 * Todo valor que influencia produção carrega origem e status — nunca um número "nu".
 */

export type Origem =
  /** Ajuste manual feito no projeto (com motivo e autor). Prevalece sobre os demais. */
  | 'projeto'
  /** Perfil técnico enviado pela gráfica e importado na área de configuração. */
  | 'grafica'
  /** Valor de referência genérico da plataforma — permite prévia, nunca produção validada. */
  | 'generico'
  /** Derivado por fórmula a partir de outros valores. */
  | 'calculado'
  /** Não informado. */
  | 'ausente';

export type Status =
  | 'confirmado' // fornecido pela gráfica (fonte identificada)
  | 'informado' // fornecido manualmente pelo usuário no projeto
  | 'calculado' // derivado de entradas confirmadas/informadas
  | 'estimado' // depende de pelo menos uma entrada genérica ou aproximação
  | 'pendente' // dado crítico ausente
  | 'nao_verificavel';

export interface Proveniencia {
  origem: Origem;
  status: Status;
  /** Ex.: "Perfil Gráfica X v3 (2026-10-02)", "Ajuste de projeto: confirmado por telefone". */
  fonte?: string;
  autor?: string;
  data?: string;
}

export interface Valor<T> extends Proveniencia {
  valor: T | null;
  unidade?: string;
}

const RANK: Record<Status, number> = {
  confirmado: 0,
  informado: 0,
  calculado: 0,
  estimado: 1,
  nao_verificavel: 2,
  pendente: 3,
};

/** Combina status de entradas: o resultado nunca é mais forte que a entrada mais fraca. */
export function combinarStatus(entradas: readonly Status[]): Status {
  let pior: Status = 'calculado';
  for (const s of entradas) {
    if (RANK[s] > RANK[pior]) pior = s;
  }
  if (pior === 'confirmado' || pior === 'informado') return 'calculado';
  return pior;
}

export function calculado<T>(valor: T | null, entradas: readonly Proveniencia[], unidade?: string, fonte?: string): Valor<T> {
  const status = valor === null ? 'pendente' : combinarStatus(entradas.map((e) => e.status));
  return { valor: status === 'pendente' ? null : valor, origem: 'calculado', status, unidade, fonte };
}

/** Arredondamento definido (RNF-001): meio para longe do zero, casas decimais explícitas. */
export function arred(v: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.sign(v) * Math.round(Math.abs(v) * f + Number.EPSILON) / f;
}

export const MM_PER_PT = 25.4 / 72;
export const mmToPt = (mm: number) => mm / MM_PER_PT;
export const ptToMm = (pt: number) => pt * MM_PER_PT;
