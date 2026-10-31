/**
 * Esquemas de dobra (catálogo base + esquemas personalizados enviados pela gráfica).
 *
 * Um esquema descreve a folha plana como uma grade de células (cada célula = 1 folha do
 * livro após o refile = 2 páginas) e a sequência de dobras. A imposição NÃO é tabelada:
 * é derivada por simulação (ver simulate.ts). Isso permite cobrir qualquer esquema de
 * dobra — ângulo reto, paralela, rolo, mista — e aceitar esquemas cadastrados pela gráfica.
 *
 * Os identificadores seguem a lógica de nomenclatura do catálogo de dobras CIP4/JDF
 * (F<páginas>-<variante>), mas a correspondência exata de cada variante com o catálogo JDF
 * NÃO é afirmada aqui: deve ser confirmada pela gráfica ao homologar o esquema.
 */

export type FoldAxis = 'x' | 'y';

export interface FoldStep {
  /** 'x' = linha de dobra vertical (dobra ao longo da largura); 'y' = linha horizontal. */
  axis: FoldAxis;
  /** Posição da linha, em células, a partir da borda esquerda/superior da folha já dobrada. */
  at: number;
  /** Qual parte se move: 'high' = à direita/abaixo da linha; 'low' = à esquerda/acima. */
  move: 'high' | 'low';
  /** A parte móvel vai por cima ('over') ou por baixo ('under') da parte fixa. */
  dir: 'over' | 'under';
}

export interface FoldScheme {
  id: string;
  nome: string;
  /** Colunas e linhas de células na folha plana. */
  cols: number;
  rows: number;
  folds: readonly FoldStep[];
  familia: 'folha_solta' | 'meia_dobra' | 'angulo_reto' | 'paralela' | 'mista';
  observacao?: string;
  /** Referência JDF sugerida — a confirmar com a gráfica. */
  jdfSugerido?: string;
}

export function paginasDoEsquema(s: FoldScheme): number {
  return s.cols * s.rows * 2;
}

const over = (axis: FoldAxis, at: number, move: 'high' | 'low' = 'high'): FoldStep => ({ axis, at, move, dir: 'over' });
const under = (axis: FoldAxis, at: number, move: 'high' | 'low' = 'high'): FoldStep => ({ axis, at, move, dir: 'under' });

export const ESQUEMAS_BASE: readonly FoldScheme[] = [
  {
    id: 'F2', nome: 'Folha solta (sem dobra)', cols: 1, rows: 1, folds: [], familia: 'folha_solta',
    observacao: 'Wire-o, espiral, garra, lombada colada de folhas soltas, cartonado, cartões.',
  },
  {
    id: 'F4', nome: '4 páginas — 1 dobra', cols: 2, rows: 1, folds: [over('x', 1)], familia: 'meia_dobra',
    jdfSugerido: 'F4-1',
  },
  {
    id: 'F6-RL', nome: '6 páginas — dobra em rolo (folheto)', cols: 3, rows: 1,
    folds: [over('x', 2), over('x', 1)], familia: 'paralela',
    observacao: 'Não é caderno de livro (a última dobra não divide a pilha ao meio). Uso em folhetos.',
    jdfSugerido: 'F6-1',
  },
  {
    id: 'F8-AR', nome: '8 páginas — 2 dobras em ângulo reto', cols: 2, rows: 2,
    folds: [under('y', 1), over('x', 1)], familia: 'angulo_reto', jdfSugerido: 'F8-7',
    observacao: 'Reproduz a imposição clássica de 8 páginas (frente: 5 4 invertidas / 8 1).',
  },
  {
    id: 'F8-PAR', nome: '8 páginas — 2 dobras paralelas', cols: 4, rows: 1,
    folds: [over('x', 2), over('x', 1)], familia: 'paralela', jdfSugerido: 'F8-1',
  },
  {
    id: 'F12-MX', nome: '12 páginas — rolo + ângulo reto', cols: 3, rows: 2,
    folds: [over('x', 2), over('x', 1), over('y', 1)], familia: 'mista',
    observacao: 'Rolo em 3 painéis seguido de meia dobra (lombada). Validade verificada na simulação.',
    jdfSugerido: 'F12-14',
  },
  {
    id: 'F16-AR', nome: '16 páginas — 3 dobras em ângulo reto', cols: 4, rows: 2,
    folds: [under('x', 2), over('y', 1, 'low'), over('x', 1, 'low')], familia: 'angulo_reto', jdfSugerido: 'F16-7',
    observacao: 'Reproduz a imposição clássica de 16 páginas (frente: 5 12 9 8 invertidas / 4 13 16 1).',
  },
  {
    id: 'F16-PAR', nome: '16 páginas — 2 paralelas + 1 ângulo reto', cols: 4, rows: 2,
    folds: [over('x', 2), over('x', 1), over('y', 1)], familia: 'mista', jdfSugerido: 'F16-8',
  },
  {
    id: 'F24-MX', nome: '24 páginas — rolo + 2 ângulos retos', cols: 3, rows: 4,
    folds: [over('y', 2), over('x', 2), under('x', 1), over('y', 1)], familia: 'mista', jdfSugerido: 'F24-11',
  },
  {
    id: 'F32-AR', nome: '32 páginas — 4 dobras em ângulo reto', cols: 4, rows: 4,
    folds: [over('y', 2), over('x', 2), over('y', 1), over('x', 1)], familia: 'angulo_reto', jdfSugerido: 'F32-9',
  },
  {
    id: 'F64-AR', nome: '64 páginas — 5 dobras em ângulo reto', cols: 8, rows: 4,
    folds: [over('x', 4), over('y', 2), over('x', 2), over('y', 1), over('x', 1)], familia: 'angulo_reto',
    jdfSugerido: 'F64-2',
  },
];

export function encontrarEsquema(id: string, extras: readonly FoldScheme[] = []): FoldScheme {
  const s = [...extras, ...ESQUEMAS_BASE].find((e) => e.id === id);
  if (!s) throw new Error(`Esquema de dobra desconhecido: ${id}`);
  return s;
}
