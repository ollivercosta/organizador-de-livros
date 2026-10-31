import type { PerfilGrafica } from './profile.js';

/**
 * Perfil de EXEMPLO para demonstração da área de configuração.
 * Valores ilustrativos — não representam uma gráfica real. Substitua pelo perfil enviado pela gráfica.
 */
export const PERFIL_EXEMPLO: PerfilGrafica = {
  schema: 'plataforma-editorial/perfil-grafica@1',
  id: 'exemplo', grafica: 'Gráfica Exemplo (dados ilustrativos)', versao: '1', emitidoEm: '2026-10-01',
  responsavel: 'Responsável técnico (exemplo)', contato: 'preencher',
  parametros: {
    'arquivo.sangria': 3, 'arquivo.areaMarcas': 8,
    'cadernos.tamanhos': [32, 16, 8, 4],
    'cadernos.esquema.4': 'F4', 'cadernos.esquema.8': 'F8-AR', 'cadernos.esquema.12': 'F12-MX', 'cadernos.esquema.16': 'F16-AR',
    'cadernos.esquema.24': 'F24-MX', 'cadernos.esquema.32': 'F32-AR', 'cadernos.esquema.64': 'F64-AR',
    'acabamento.fresagem': 3, 'acabamento.lombada.acrescimo': 0.5, 'acabamento.canoa.maxPaginas': 96,
    'capaDura.espessuraPapelao': 2.5, 'capaDura.esquadro': 3, 'capaDura.canal': 7, 'capaDura.dobraRevestimento': 15,
    'capaDura.folgaLombada': 1, 'capaDura.recuoDobradica': 3,
    'creep.fator': 1, 'consumo.perdaPercentual': 4, 'consumo.acertoFolhas': 150,
  },
  maquinas: [
    { id: 'of-4c', nome: 'Offset 4 cores (folha 66×96)', parametros: { 'maquina.pinca': 12, 'maquina.cauda': 6, 'maquina.margemLateral': 5, 'maquina.bordaPinca': 'bottom', 'maquina.modo': 'frente_verso', 'maquina.viradaVerso': 'lateral' } },
    { id: 'of-perf', nome: 'Offset com perfecting', parametros: { 'maquina.pinca': 12, 'maquina.cauda': 12, 'maquina.margemLateral': 5, 'maquina.bordaPinca': 'bottom', 'maquina.modo': 'perfecting', 'maquina.viradaVerso': 'pinca' } },
  ],
  folhas: [
    { id: '66x96', nome: '66 × 96 cm', largura: 960, altura: 660, fibra: 'longa' },
    { id: '48x66', nome: '48 × 66 cm', largura: 660, altura: 480, fibra: 'longa' },
    { id: '72x102', nome: '72 × 102 cm', largura: 1020, altura: 720, fibra: 'longa' },
  ],
  papeis: [
    { id: 'couche-fosco-115', nome: 'Couchê fosco 115 g/m²', gramatura: 115, calibreUm: 98, fonte: 'ficha técnica (exemplo)' },
    { id: 'offset-90', nome: 'Offset 90 g/m²', gramatura: 90, calibreUm: 110, fonte: 'ficha técnica (exemplo)' },
    { id: 'triplex-250', nome: 'Triplex 250 g/m²', gramatura: 250, calibreUm: 330, fonte: 'ficha técnica (exemplo)' },
    { id: 'offset-150', nome: 'Offset 150 g/m² (guarda)', gramatura: 150, calibreUm: 180, fonte: 'ficha técnica (exemplo)' },
  ],
  esquemasDobra: [],
  observacoes: 'Perfil de demonstração. Os valores não foram fornecidos por uma gráfica.',
};
