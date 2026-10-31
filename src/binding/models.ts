/**
 * Catálogo de modelos de produto/encadernação.
 *
 * Todo modelo de códice (livro, revista, caderno, catálogo, calendário) se reduz a:
 *   - um padrão de MONTAGEM do miolo:
 *       'aninhada'   → cadernos inseridos uns dentro dos outros (grampo canoa);
 *       'alcada'     → cadernos empilhados em sequência (costura, PUR, hotmelt, capa dura);
 *       'folhas'     → folhas soltas de 2 páginas (wire-o, espiral, garra, cartonado, PUR folha solta);
 *       'sanfona'    → tira contínua dobrada em zigue-zague (leporello);
 *   - um conjunto de ESQUEMAS DE DOBRA permitidos (ou folha solta);
 *   - um MODELO DE CAPA (autocapa, capa separada flexível, capa dura/caixa, folhas de capa);
 *   - COMPONENTES adicionais (guardas, sobrecapa, orelhas).
 *
 * Adicionar um modelo novo = adicionar uma entrada aqui, sem tocar no motor.
 */

export type Montagem = 'aninhada' | 'alcada' | 'folhas' | 'sanfona';
export type ModeloCapa = 'autocapa' | 'separada_flexivel' | 'capa_dura' | 'folhas_de_capa' | 'sem_capa';
export type TipoLombada = 'sem_lombada' | 'quadrada' | 'caixa' | 'mecanica';

export type ModeloId =
  | 'grampo_canoa'
  | 'grampo_lateral'
  | 'brochura_hotmelt'
  | 'brochura_pur'
  | 'brochura_costurada'
  | 'capa_dura_costurada'
  | 'capa_dura_colada'
  | 'wire_o'
  | 'espiral'
  | 'garra_plastica'
  | 'cartonado'
  | 'sanfona'
  | 'folhas_soltas';

export interface ModeloEncadernacao {
  id: ModeloId;
  nome: string;
  montagem: Montagem;
  /** Montagens alternativas aceitas (ex.: PUR aceita cadernos ou folhas soltas). */
  montagensAlternativas?: Montagem[];
  capas: ModeloCapa[];
  capaPadrao: ModeloCapa;
  lombada: TipoLombada;
  /** Encadernação superior (calendário de parede, bloco) é suportada. */
  aceitaEncadernacaoSuperior: boolean;
  /** Creep (empurrão) relevante. */
  creep: 'relevante' | 'dentro_do_caderno' | 'nao_aplicavel';
  /** Material removido na lombada (fresagem) — a margem de lombada precisa compensar. */
  fresagem: boolean;
  /** Furação/perfuração mecânica na borda de encadernação (margem de segurança extra). */
  furacao: boolean;
  /** Guardas obrigatórias (capa dura). */
  guardas: boolean;
  sobrecapa: boolean;
  orelhas: boolean;
  observacoes: string[];
}

export const MODELOS: Record<ModeloId, ModeloEncadernacao> = {
  grampo_canoa: {
    id: 'grampo_canoa', nome: 'Grampo canoa', montagem: 'aninhada',
    capas: ['autocapa', 'separada_flexivel'], capaPadrao: 'autocapa', lombada: 'sem_lombada',
    aceitaEncadernacaoSuperior: true, creep: 'relevante', fresagem: false, furacao: false,
    guardas: false, sobrecapa: false, orelhas: false,
    observacoes: [
      'Total de páginas do bloco grampeado é múltiplo de 4.',
      'Capa separada (papel diferente) é uma folha dobrada externa ao miolo; o miolo também precisa ser múltiplo de 4.',
      'Limite de espessura/páginas definido pela gráfica.',
    ],
  },
  grampo_lateral: {
    id: 'grampo_lateral', nome: 'Grampo lateral', montagem: 'folhas', montagensAlternativas: ['alcada'],
    capas: ['separada_flexivel', 'folhas_de_capa'], capaPadrao: 'separada_flexivel', lombada: 'quadrada',
    aceitaEncadernacaoSuperior: true, creep: 'nao_aplicavel', fresagem: false, furacao: true,
    guardas: false, sobrecapa: false, orelhas: false,
    observacoes: ['O grampo atravessa a margem de encadernação: exige margem interna maior.'],
  },
  brochura_hotmelt: {
    id: 'brochura_hotmelt', nome: 'Brochura — lombada quadrada (hotmelt/EVA)', montagem: 'alcada',
    montagensAlternativas: ['folhas'], capas: ['separada_flexivel'], capaPadrao: 'separada_flexivel',
    lombada: 'quadrada', aceitaEncadernacaoSuperior: false, creep: 'dentro_do_caderno', fresagem: true,
    furacao: false, guardas: false, sobrecapa: false, orelhas: true,
    observacoes: ['A lombada é fresada: a gráfica informa quantos mm são removidos.'],
  },
  brochura_pur: {
    id: 'brochura_pur', nome: 'Brochura — lombada quadrada (PUR)', montagem: 'alcada',
    montagensAlternativas: ['folhas'], capas: ['separada_flexivel'], capaPadrao: 'separada_flexivel',
    lombada: 'quadrada', aceitaEncadernacaoSuperior: false, creep: 'dentro_do_caderno', fresagem: true,
    furacao: false, guardas: false, sobrecapa: false, orelhas: true,
    observacoes: ['PUR permite abertura maior (lay-flat) — capa e vincos conforme a gráfica.'],
  },
  brochura_costurada: {
    id: 'brochura_costurada', nome: 'Brochura costurada', montagem: 'alcada',
    capas: ['separada_flexivel'], capaPadrao: 'separada_flexivel', lombada: 'quadrada',
    aceitaEncadernacaoSuperior: false, creep: 'dentro_do_caderno', fresagem: false, furacao: false,
    guardas: false, sobrecapa: false, orelhas: true,
    observacoes: ['Exige cadernos dobrados (não aceita folhas soltas).'],
  },
  capa_dura_costurada: {
    id: 'capa_dura_costurada', nome: 'Capa dura — miolo costurado', montagem: 'alcada',
    capas: ['capa_dura'], capaPadrao: 'capa_dura', lombada: 'caixa', aceitaEncadernacaoSuperior: false,
    creep: 'dentro_do_caderno', fresagem: false, furacao: false, guardas: true, sobrecapa: true, orelhas: false,
    observacoes: ['Guardas (folha dupla) na frente e no fim do miolo.', 'Papelão, esquadro, canal e dobra do revestimento informados pela gráfica.'],
  },
  capa_dura_colada: {
    id: 'capa_dura_colada', nome: 'Capa dura — miolo colado (PUR)', montagem: 'alcada',
    montagensAlternativas: ['folhas'], capas: ['capa_dura'], capaPadrao: 'capa_dura', lombada: 'caixa',
    aceitaEncadernacaoSuperior: false, creep: 'dentro_do_caderno', fresagem: true, furacao: false,
    guardas: true, sobrecapa: true, orelhas: false, observacoes: [],
  },
  wire_o: {
    id: 'wire_o', nome: 'Wire-o', montagem: 'folhas', capas: ['folhas_de_capa', 'sem_capa'],
    capaPadrao: 'folhas_de_capa', lombada: 'mecanica', aceitaEncadernacaoSuperior: true,
    creep: 'nao_aplicavel', fresagem: false, furacao: true, guardas: false, sobrecapa: false, orelhas: false,
    observacoes: ['Furação na borda de encadernação: margem de segurança informada pela gráfica.'],
  },
  espiral: {
    id: 'espiral', nome: 'Espiral', montagem: 'folhas', capas: ['folhas_de_capa', 'sem_capa'],
    capaPadrao: 'folhas_de_capa', lombada: 'mecanica', aceitaEncadernacaoSuperior: true,
    creep: 'nao_aplicavel', fresagem: false, furacao: true, guardas: false, sobrecapa: false, orelhas: false,
    observacoes: [],
  },
  garra_plastica: {
    id: 'garra_plastica', nome: 'Garra plástica', montagem: 'folhas', capas: ['folhas_de_capa', 'sem_capa'],
    capaPadrao: 'folhas_de_capa', lombada: 'mecanica', aceitaEncadernacaoSuperior: true,
    creep: 'nao_aplicavel', fresagem: false, furacao: true, guardas: false, sobrecapa: false, orelhas: false,
    observacoes: [],
  },
  cartonado: {
    id: 'cartonado', nome: 'Livro cartonado (board book)', montagem: 'folhas',
    capas: ['capa_dura', 'autocapa'], capaPadrao: 'autocapa', lombada: 'quadrada',
    aceitaEncadernacaoSuperior: false, creep: 'nao_aplicavel', fresagem: false, furacao: false,
    guardas: false, sobrecapa: false, orelhas: false,
    observacoes: ['Cada folha é um cartão (espessura do cartão domina a lombada).'],
  },
  sanfona: {
    id: 'sanfona', nome: 'Sanfona / leporello', montagem: 'sanfona',
    capas: ['autocapa', 'capa_dura'], capaPadrao: 'autocapa', lombada: 'sem_lombada',
    aceitaEncadernacaoSuperior: false, creep: 'nao_aplicavel', fresagem: false, furacao: false,
    guardas: false, sobrecapa: false, orelhas: false,
    observacoes: ['Painéis em tira contínua; emendas definidas pela gráfica quando excede a folha.'],
  },
  folhas_soltas: {
    id: 'folhas_soltas', nome: 'Folhas soltas (sem encadernação)', montagem: 'folhas',
    capas: ['sem_capa'], capaPadrao: 'sem_capa', lombada: 'sem_lombada', aceitaEncadernacaoSuperior: true,
    creep: 'nao_aplicavel', fresagem: false, furacao: false, guardas: false, sobrecapa: false, orelhas: false,
    observacoes: ['Cartões, fichas, jogos de páginas sem montagem.'],
  },
};

/** Múltiplo de páginas exigido por unidade de montagem. */
export function multiploMinimo(montagem: Montagem): number {
  return montagem === 'aninhada' ? 4 : montagem === 'alcada' ? 4 : montagem === 'folhas' ? 2 : 2;
}
