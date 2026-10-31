/**
 * Padrão de mercado (referência) — usado quando a gráfica ainda não enviou o perfil.
 *
 * São valores usuais na indústria gráfica brasileira para cada modelo de encadernação.
 * Permitem preparar e exportar o projeto, mas a saída é rotulada "padrão de mercado —
 * confirmar com a gráfica": nunca se apresenta como dado confirmado (RN-001).
 * Espessuras de papel são típicas (variação real de ±10% entre fabricantes).
 */

import type { ModeloId } from '../binding/models.js';
import type { FolhaPerfil, MaquinaPerfil, PapelPerfil, ValorParam } from './profile.js';

export const FONTE_REFERENCIA = 'Padrão de mercado (referência da plataforma) — confirmar com a gráfica';

/** Formatos de folha usuais no Brasil (largura × altura em mm, vista com a pinça embaixo). */
export const FOLHAS_REFERENCIA: FolhaPerfil[] = [
  { id: 'ref-66x96', nome: '66 × 96 cm (formato BB)', largura: 960, altura: 660 },
  { id: 'ref-76x112', nome: '76 × 112 cm (formato AA)', largura: 1120, altura: 760 },
  { id: 'ref-64x88', nome: '64 × 88 cm', largura: 880, altura: 640 },
  { id: 'ref-48x66', nome: '48 × 66 cm (½ BB)', largura: 660, altura: 480 },
  { id: 'ref-56x76', nome: '56 × 76 cm (½ AA)', largura: 760, altura: 560 },
  { id: 'ref-32x45', nome: '32 × 45 cm (SRA3 — impressão digital)', largura: 450, altura: 320 },
];

export const MAQUINAS_REFERENCIA: MaquinaPerfil[] = [
  { id: 'ref-offset', nome: 'Offset plana — frente e verso (referência)', parametros: { 'maquina.pinca': 12, 'maquina.cauda': 5, 'maquina.margemLateral': 5, 'maquina.bordaPinca': 'bottom', 'maquina.modo': 'frente_verso', 'maquina.viradaVerso': 'lateral' } },
  { id: 'ref-digital', nome: 'Impressão digital — folha SRA3 (referência)', parametros: { 'maquina.pinca': 5, 'maquina.cauda': 5, 'maquina.margemLateral': 5, 'maquina.bordaPinca': 'bottom', 'maquina.modo': 'frente_verso', 'maquina.viradaVerso': 'lateral' } },
];

/** Papéis usuais em livros e impressos, com espessura típica (µm). */
export const PAPEIS_REFERENCIA: PapelPerfil[] = [
  { id: 'ref-offset-75', nome: 'Offset 75 g/m²', gramatura: 75, calibreUm: 95 },
  { id: 'ref-offset-90', nome: 'Offset 90 g/m²', gramatura: 90, calibreUm: 112 },
  { id: 'ref-offset-120', nome: 'Offset 120 g/m²', gramatura: 120, calibreUm: 150 },
  { id: 'ref-polen-80', nome: 'Papel creme (tipo pólen) 80 g/m²', gramatura: 80, calibreUm: 104 },
  { id: 'ref-polen-90', nome: 'Papel creme (tipo pólen) 90 g/m²', gramatura: 90, calibreUm: 125 },
  { id: 'ref-couche-b-90', nome: 'Couchê brilho 90 g/m²', gramatura: 90, calibreUm: 75 },
  { id: 'ref-couche-b-115', nome: 'Couchê brilho 115 g/m²', gramatura: 115, calibreUm: 95 },
  { id: 'ref-couche-b-150', nome: 'Couchê brilho 150 g/m²', gramatura: 150, calibreUm: 125 },
  { id: 'ref-couche-f-90', nome: 'Couchê fosco 90 g/m²', gramatura: 90, calibreUm: 85 },
  { id: 'ref-couche-f-115', nome: 'Couchê fosco 115 g/m²', gramatura: 115, calibreUm: 105 },
  { id: 'ref-couche-f-150', nome: 'Couchê fosco 150 g/m²', gramatura: 150, calibreUm: 140 },
  { id: 'ref-triplex-250', nome: 'Cartão triplex 250 g/m²', gramatura: 250, calibreUm: 330 },
  { id: 'ref-triplex-300', nome: 'Cartão triplex 300 g/m²', gramatura: 300, calibreUm: 400 },
  { id: 'ref-supremo-300', nome: 'Cartão supremo 300 g/m²', gramatura: 300, calibreUm: 390 },
  { id: 'ref-offset-150', nome: 'Offset 150 g/m² (guarda)', gramatura: 150, calibreUm: 180 },
].map((p) => ({ ...p, fonte: 'espessura típica de mercado (±10%) — conferir a ficha do fabricante' }));

/** Valores de referência que variam por modelo (sobrepõem o padrão do registro). */
export const REFERENCIA_POR_MODELO: Partial<Record<ModeloId, Record<string, ValorParam>>> = {
  grampo_canoa: { 'arquivo.entrega': 'lado_a_lado', 'acabamento.canoa.maxPaginas': 64, 'creep.ativo': true, 'cadernos.tamanhos': [32, 16, 8, 4] },
  grampo_lateral: { 'acabamento.furacao.margem': 10 },
  brochura_hotmelt: { 'acabamento.fresagem': 3, 'acabamento.lombada.acrescimo': 0.5, 'acabamento.vincoDobradica': 0, 'cadernos.tamanhos': [32, 16, 8] },
  brochura_pur: { 'acabamento.fresagem': 3, 'acabamento.lombada.acrescimo': 0.5, 'acabamento.vincoDobradica': 6, 'cadernos.tamanhos': [32, 16, 8] },
  brochura_costurada: { 'acabamento.lombada.acrescimo': 0.5, 'acabamento.vincoDobradica': 6, 'cadernos.tamanhos': [32, 16, 8] },
  capa_dura_costurada: { 'cadernos.tamanhos': [32, 16, 8], 'capaDura.espessuraPapelao': 2.5 },
  capa_dura_colada: { 'acabamento.fresagem': 3, 'cadernos.tamanhos': [32, 16, 8], 'capaDura.espessuraPapelao': 2.5 },
  wire_o: { 'acabamento.furacao.margem': 10 },
  espiral: { 'acabamento.furacao.margem': 12 },
  garra_plastica: { 'acabamento.furacao.margem': 12 },
};

export const SELECAO_REFERENCIA = { maquinaId: 'ref-offset', folhaMioloId: 'ref-66x96', folhaCapaId: 'ref-48x66' } as const;
