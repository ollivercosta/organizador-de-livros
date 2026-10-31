/**
 * Registro de parâmetros técnicos de produção.
 *
 * Fonte única da verdade para: formulário da área de configuração, validação do perfil
 * importado, modelo de preenchimento enviado à gráfica, resolução de valores e relatório.
 *
 * `critico: true` → sem valor confirmado (gráfica) ou informado (projeto), a saída de
 * produção não pode ser declarada validada (RN-008, RN-012).
 * `generico` → valor de referência que permite PRÉVIA; nunca conta como confirmado.
 */

import type { ModeloId } from '../binding/models.js';

export type TipoParam = 'numero' | 'texto' | 'opcao' | 'booleano' | 'lista_numeros';

export interface ParamDef {
  chave: string;
  rotulo: string;
  grupo: 'Arquivo' | 'Máquina' | 'Cadernos e dobra' | 'Acabamento' | 'Capa dura' | 'Creep' | 'Consumo';
  tipo: TipoParam;
  unidade?: string;
  opcoes?: readonly string[];
  min?: number;
  max?: number;
  critico: boolean;
  /** Modelos aos quais o parâmetro se aplica (ausente = todos). */
  aplicaA?: readonly ModeloId[];
  generico?: number | string | boolean | number[];
  ajuda: string;
}

const BROCHURAS: ModeloId[] = ['brochura_hotmelt', 'brochura_pur', 'brochura_costurada'];
const CAPA_DURA: ModeloId[] = ['capa_dura_costurada', 'capa_dura_colada'];
const FRESADOS: ModeloId[] = ['brochura_hotmelt', 'brochura_pur', 'capa_dura_colada'];
const MECANICOS: ModeloId[] = ['wire_o', 'espiral', 'garra_plastica', 'grampo_lateral'];
const CADERNOS: ModeloId[] = ['grampo_canoa', 'brochura_hotmelt', 'brochura_pur', 'brochura_costurada', 'capa_dura_costurada', 'capa_dura_colada', 'grampo_lateral'];

export const REGISTRO: readonly ParamDef[] = [
  // Arquivo
  { chave: 'arquivo.sangria', rotulo: 'Sangria', grupo: 'Arquivo', tipo: 'numero', unidade: 'mm', min: 0, max: 20, critico: true, generico: 3, ajuda: 'Área de imagem além do corte, em cada borda refilada.' },
  { chave: 'arquivo.areaMarcas', rotulo: 'Área para marcas', grupo: 'Arquivo', tipo: 'numero', unidade: 'mm', min: 0, max: 30, critico: false, generico: 8, ajuda: 'Espaço reservado em volta de cada forma para marcas de corte e dobra.' },
  { chave: 'arquivo.padraoPdf', rotulo: 'Padrão de PDF exigido', grupo: 'Arquivo', tipo: 'opcao', opcoes: ['PDF/X-1a', 'PDF/X-3', 'PDF/X-4', 'Livre'], critico: false, generico: 'PDF/X-4', ajuda: 'PDF/X garante TrimBox/BleedBox e fontes incorporadas.' },
  { chave: 'arquivo.perfilSaida', rotulo: 'Perfil de cor de saída', grupo: 'Arquivo', tipo: 'texto', critico: false, generico: 'FOGRA39 (ISO Coated v2)', ajuda: 'Condição de impressão (ex.: FOGRA39, FOGRA51, GRACoL).' },
  { chave: 'arquivo.resolucaoMin', rotulo: 'Resolução mínima de imagem', grupo: 'Arquivo', tipo: 'numero', unidade: 'ppi', min: 72, max: 2400, critico: false, generico: 300, ajuda: 'Na escala final de impressão.' },
  { chave: 'arquivo.margemSeguranca', rotulo: 'Margem de segurança', grupo: 'Arquivo', tipo: 'numero', unidade: 'mm', min: 0, max: 40, critico: false, generico: 5, ajuda: 'Distância mínima de textos/elementos importantes até o corte.' },
  { chave: 'arquivo.marcasColacao', rotulo: 'Imprimir marcas de colação', grupo: 'Arquivo', tipo: 'booleano', critico: false, generico: true, ajuda: 'Marcas no dorso para conferir a ordem dos cadernos alçados.' },

  // Máquina
  { chave: 'maquina.folha.largura', rotulo: 'Folha de impressão — largura', grupo: 'Máquina', tipo: 'numero', unidade: 'mm', min: 50, max: 2000, critico: true, ajuda: 'Formato real da folha que entra na máquina (não presumido).' },
  { chave: 'maquina.folha.altura', rotulo: 'Folha de impressão — altura', grupo: 'Máquina', tipo: 'numero', unidade: 'mm', min: 50, max: 2000, critico: true, ajuda: '' },
  { chave: 'maquina.fibra', rotulo: 'Direção da fibra', grupo: 'Máquina', tipo: 'opcao', opcoes: ['longa', 'curta'], critico: false, ajuda: 'Fibra paralela ao lado maior (longa) ou menor (curta). A lombada deve ficar paralela à fibra.' },
  { chave: 'maquina.bordaPinca', rotulo: 'Borda da pinça', grupo: 'Máquina', tipo: 'opcao', opcoes: ['top', 'bottom', 'left', 'right'], critico: true, generico: 'bottom', ajuda: 'Borda da folha pega pela pinça, na vista do lado A.' },
  { chave: 'maquina.pinca', rotulo: 'Pinça', grupo: 'Máquina', tipo: 'numero', unidade: 'mm', min: 0, max: 40, critico: true, generico: 12, ajuda: 'Área não imprimível na borda da pinça.' },
  { chave: 'maquina.cauda', rotulo: 'Margem de cauda', grupo: 'Máquina', tipo: 'numero', unidade: 'mm', min: 0, max: 40, critico: false, generico: 5, ajuda: 'Borda oposta à pinça.' },
  { chave: 'maquina.margemLateral', rotulo: 'Margem lateral', grupo: 'Máquina', tipo: 'numero', unidade: 'mm', min: 0, max: 40, critico: false, generico: 5, ajuda: 'Bordas laterais (esquadro lateral).' },
  { chave: 'maquina.modo', rotulo: 'Modo de impressão', grupo: 'Máquina', tipo: 'opcao', opcoes: ['frente_verso', 'virada_lateral', 'virada_pinca', 'perfecting'], critico: true, generico: 'frente_verso', ajuda: 'Frente e verso com chapas distintas; virada lateral (work-and-turn); virada pela pinça (work-and-tumble); impressão simultânea (perfecting).' },
  { chave: 'maquina.viradaVerso', rotulo: 'Virada do verso', grupo: 'Máquina', tipo: 'opcao', opcoes: ['lateral', 'pinca'], critico: true, generico: 'lateral', ajuda: 'Como a folha é virada para imprimir o verso (frente/verso e perfecting).' },
  { chave: 'maquina.posicoes', rotulo: 'Posições por folha', grupo: 'Máquina', tipo: 'texto', critico: false, generico: 'auto', ajuda: '"auto" maximiza o aproveitamento; ou um número fixo.' },
  { chave: 'maquina.rotacaoForma', rotulo: 'Rotação da forma', grupo: 'Máquina', tipo: 'opcao', opcoes: ['auto', '0', '90'], critico: false, generico: 'auto', ajuda: '' },
  { chave: 'maquina.coresMax', rotulo: 'Cores por passada', grupo: 'Máquina', tipo: 'numero', min: 1, max: 12, critico: false, generico: 4, ajuda: '' },

  // Cadernos
  { chave: 'cadernos.tamanhos', rotulo: 'Tamanhos de caderno aceitos', grupo: 'Cadernos e dobra', tipo: 'lista_numeros', critico: true, aplicaA: CADERNOS, generico: [32, 16, 8, 4], ajuda: 'Páginas por caderno que a dobradeira da gráfica produz.' },
  { chave: 'cadernos.esquema.4', rotulo: 'Esquema para 4 pp', grupo: 'Cadernos e dobra', tipo: 'texto', critico: true, aplicaA: CADERNOS, generico: 'F4', ajuda: 'ID do esquema de dobra (catálogo ou esquema enviado pela gráfica).' },
  { chave: 'cadernos.esquema.8', rotulo: 'Esquema para 8 pp', grupo: 'Cadernos e dobra', tipo: 'texto', critico: true, aplicaA: CADERNOS, generico: 'F8-AR', ajuda: '' },
  { chave: 'cadernos.esquema.12', rotulo: 'Esquema para 12 pp', grupo: 'Cadernos e dobra', tipo: 'texto', critico: true, aplicaA: CADERNOS, generico: 'F12-MX', ajuda: '' },
  { chave: 'cadernos.esquema.16', rotulo: 'Esquema para 16 pp', grupo: 'Cadernos e dobra', tipo: 'texto', critico: true, aplicaA: CADERNOS, generico: 'F16-AR', ajuda: '' },
  { chave: 'cadernos.esquema.24', rotulo: 'Esquema para 24 pp', grupo: 'Cadernos e dobra', tipo: 'texto', critico: true, aplicaA: CADERNOS, generico: 'F24-MX', ajuda: '' },
  { chave: 'cadernos.esquema.32', rotulo: 'Esquema para 32 pp', grupo: 'Cadernos e dobra', tipo: 'texto', critico: true, aplicaA: CADERNOS, generico: 'F32-AR', ajuda: '' },
  { chave: 'cadernos.esquema.64', rotulo: 'Esquema para 64 pp', grupo: 'Cadernos e dobra', tipo: 'texto', critico: true, aplicaA: CADERNOS, generico: 'F64-AR', ajuda: '' },
  { chave: 'cadernos.agrupamento', rotulo: 'Distribuição na folha (cadernos)', grupo: 'Cadernos e dobra', tipo: 'opcao', opcoes: ['repetir', 'sequencial', 'corte_empilhamento'], critico: false, generico: 'repetir', ajuda: 'Repetir o mesmo caderno em todas as posições, ou combinar cadernos diferentes.' },
  { chave: 'folhas.agrupamento', rotulo: 'Distribuição na folha (folhas soltas)', grupo: 'Cadernos e dobra', tipo: 'opcao', opcoes: ['sequencial', 'corte_empilhamento', 'repetir'], critico: false, generico: 'corte_empilhamento', ajuda: 'Corte e empilhamento mantém a ordem das pilhas após o corte.' },

  // Acabamento
  { chave: 'acabamento.fresagem', rotulo: 'Fresagem da lombada', grupo: 'Acabamento', tipo: 'numero', unidade: 'mm', min: 0, max: 10, critico: true, aplicaA: FRESADOS, generico: 3, ajuda: 'Material removido na lombada antes da cola, por página.' },
  { chave: 'acabamento.lombada.acrescimo', rotulo: 'Acréscimo na lombada', grupo: 'Acabamento', tipo: 'numero', unidade: 'mm', min: -5, max: 10, critico: true, aplicaA: [...BROCHURAS], generico: 0, ajuda: 'Ajuste da gráfica sobre a espessura calculada (cola, compressão).' },
  { chave: 'acabamento.lombada.incluirCapa', rotulo: 'Somar espessura da capa na lombada', grupo: 'Acabamento', tipo: 'booleano', critico: false, aplicaA: [...BROCHURAS], generico: true, ajuda: 'Lombada externa = bloco + 2 × calibre da capa.' },
  { chave: 'acabamento.vincoDobradica', rotulo: 'Vinco de dobradiça', grupo: 'Acabamento', tipo: 'numero', unidade: 'mm', min: 0, max: 15, critico: false, aplicaA: [...BROCHURAS], generico: 6, ajuda: 'Distância dos vincos auxiliares a partir da lombada (0 = sem).' },
  { chave: 'acabamento.reducaoPainelOrelha', rotulo: 'Redução do painel com orelha', grupo: 'Acabamento', tipo: 'numero', unidade: 'mm', min: 0, max: 10, critico: false, aplicaA: [...BROCHURAS], generico: 2, ajuda: 'Painel frontal/traseiro menor que o miolo quando há orelhas.' },
  { chave: 'acabamento.canoa.extraLombadaCapa', rotulo: 'Extra de lombada na capa (canoa)', grupo: 'Acabamento', tipo: 'numero', unidade: 'mm', min: 0, max: 10, critico: false, aplicaA: ['grampo_canoa'], generico: 0, ajuda: 'Para cadernos espessos com capa separada.' },
  { chave: 'acabamento.canoa.maxPaginas', rotulo: 'Máximo de páginas (canoa)', grupo: 'Acabamento', tipo: 'numero', min: 4, max: 400, critico: false, aplicaA: ['grampo_canoa'], ajuda: 'Limite de páginas do bloco grampeado.' },
  { chave: 'acabamento.canoa.espessuraMax', rotulo: 'Espessura máxima (canoa)', grupo: 'Acabamento', tipo: 'numero', unidade: 'mm', min: 0, max: 20, critico: false, aplicaA: ['grampo_canoa'], ajuda: '' },
  { chave: 'acabamento.furacao.margem', rotulo: 'Margem da furação', grupo: 'Acabamento', tipo: 'numero', unidade: 'mm', min: 0, max: 30, critico: false, aplicaA: MECANICOS, generico: 10, ajuda: 'Faixa da borda de encadernação ocupada por furos/grampos.' },
  { chave: 'acabamento.sobrecapa.envolvimento', rotulo: 'Envolvimento da sobrecapa', grupo: 'Acabamento', tipo: 'numero', unidade: 'mm', min: 0, max: 10, critico: false, aplicaA: CAPA_DURA, generico: 2, ajuda: 'Folga para envolver o canal e a espessura do papelão.' },

  // Capa dura
  { chave: 'capaDura.espessuraPapelao', rotulo: 'Espessura do papelão', grupo: 'Capa dura', tipo: 'numero', unidade: 'mm', min: 0.5, max: 6, critico: true, aplicaA: CAPA_DURA, generico: 2.5, ajuda: '' },
  { chave: 'capaDura.esquadro', rotulo: 'Esquadro (sobra do papelão)', grupo: 'Capa dura', tipo: 'numero', unidade: 'mm', min: 0, max: 10, critico: true, aplicaA: CAPA_DURA, generico: 3, ajuda: 'Quanto o papelão excede o miolo na cabeça, no pé e na frente.' },
  { chave: 'capaDura.canal', rotulo: 'Canal (junta)', grupo: 'Capa dura', tipo: 'numero', unidade: 'mm', min: 0, max: 20, critico: true, aplicaA: CAPA_DURA, generico: 7, ajuda: 'Espaço entre o papelão da capa e o cartão de lombada.' },
  { chave: 'capaDura.dobraRevestimento', rotulo: 'Dobra do revestimento', grupo: 'Capa dura', tipo: 'numero', unidade: 'mm', min: 5, max: 30, critico: true, aplicaA: CAPA_DURA, generico: 15, ajuda: 'Quanto o revestimento dobra para dentro do papelão.' },
  { chave: 'capaDura.folgaLombada', rotulo: 'Folga do cartão de lombada', grupo: 'Capa dura', tipo: 'numero', unidade: 'mm', min: 0, max: 10, critico: true, aplicaA: CAPA_DURA, generico: 1, ajuda: '' },
  { chave: 'capaDura.recuoDobradica', rotulo: 'Recuo do papelão na dobradiça', grupo: 'Capa dura', tipo: 'numero', unidade: 'mm', min: 0, max: 10, critico: true, aplicaA: CAPA_DURA, generico: 3, ajuda: 'Papelão menor que o miolo do lado da lombada.' },

  // Creep
  { chave: 'creep.ativo', rotulo: 'Compensar creep', grupo: 'Creep', tipo: 'booleano', critico: false, generico: true, ajuda: 'Desloca o conteúdo das folhas internas em direção à lombada.' },
  { chave: 'creep.fator', rotulo: 'Fator de creep', grupo: 'Creep', tipo: 'numero', min: 0, max: 3, critico: false, generico: 1, ajuda: 'Multiplicador sobre o calibre por folha envolvente (calibrado pela gráfica).' },

  // Consumo
  { chave: 'consumo.perdaPercentual', rotulo: 'Perda de impressão/acabamento', grupo: 'Consumo', tipo: 'numero', unidade: '%', min: 0, max: 100, critico: false, generico: 5, ajuda: '' },
  { chave: 'consumo.acertoFolhas', rotulo: 'Folhas de acerto por forma', grupo: 'Consumo', tipo: 'numero', unidade: 'folhas', min: 0, max: 5000, critico: false, generico: 100, ajuda: '' },
];

export const REGISTRO_POR_CHAVE: ReadonlyMap<string, ParamDef> = new Map(REGISTRO.map((d) => [d.chave, d]));

export function aplicavel(def: ParamDef, modelo: ModeloId): boolean {
  return !def.aplicaA || def.aplicaA.includes(modelo);
}
