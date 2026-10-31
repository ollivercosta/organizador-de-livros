import { inserirBrancos, registrarPaginas } from '../src/binding/pagination.js';
import type { PerfilGrafica } from '../src/config/profile.js';
import type { EntradaProjeto } from '../src/engine.js';

/** Perfil fictício de gráfica para testes (valores ilustrativos, não de uma gráfica real). */
export const PERFIL_TESTE: PerfilGrafica = {
  schema: 'plataforma-editorial/perfil-grafica@1',
  id: 'grafica-teste', grafica: 'Gráfica de Teste', versao: '3', emitidoEm: '2026-10-01',
  responsavel: 'Responsável técnico (teste)',
  parametros: {
    'arquivo.sangria': 3, 'arquivo.areaMarcas': 8,
    'cadernos.tamanhos': [32, 16, 8, 4],
    'cadernos.esquema.4': 'F4', 'cadernos.esquema.8': 'F8-AR', 'cadernos.esquema.16': 'F16-AR', 'cadernos.esquema.32': 'F32-AR',
    'cadernos.esquema.12': 'F12-MX', 'cadernos.esquema.24': 'F24-MX', 'cadernos.esquema.64': 'F64-AR',
    'acabamento.fresagem': 3, 'acabamento.lombada.acrescimo': 0.5, 'acabamento.canoa.maxPaginas': 96,
    'capaDura.espessuraPapelao': 2.5, 'capaDura.esquadro': 3, 'capaDura.canal': 7, 'capaDura.dobraRevestimento': 15,
    'capaDura.folgaLombada': 1, 'capaDura.recuoDobradica': 3,
    'creep.fator': 1, 'consumo.perdaPercentual': 4, 'consumo.acertoFolhas': 150,
  },
  maquinas: [{ id: 'of-4c', nome: 'Offset 4 cores', parametros: { 'maquina.pinca': 12, 'maquina.cauda': 6, 'maquina.margemLateral': 5, 'maquina.bordaPinca': 'bottom', 'maquina.modo': 'frente_verso', 'maquina.viradaVerso': 'lateral' } }],
  folhas: [{ id: '66x96', nome: '66 × 96 cm', largura: 960, altura: 660, fibra: 'longa' }, { id: '48x66', nome: '48 × 66 cm', largura: 660, altura: 480, fibra: 'longa' }],
  papeis: [
    { id: 'couche-fosco-115', nome: 'Couchê fosco 115', gramatura: 115, calibreUm: 98, fonte: 'ficha do fabricante (teste)' },
    { id: 'triplex-250', nome: 'Triplex 250', gramatura: 250, calibreUm: 330, fonte: 'ficha do fabricante (teste)' },
    { id: 'offset-150', nome: 'Offset 150 (guarda)', gramatura: 150, calibreUm: 180 },
  ],
  esquemasDobra: [],
};

/** Livro infantil da seção 20: 160×230, grampo canoa, miolo couchê 115, capa triplex 250. */
export function livroInfantil(over: Partial<EntradaProjeto> = {}, paginasArquivo = 30): EntradaProjeto {
  return {
    projeto: { id: 'livro-infantil', nome: 'Livro infantil ilustrado', versao: 1 },
    modelo: 'grampo_canoa',
    formato: { largura: 160, altura: 230 },
    direcao: 'ltr',
    capa: { modelo: 'autocapa', fonte: { fonte: 'no_pdf' } },
    paginas: registrarPaginas('livro.pdf', paginasArquivo),
    tiragem: 1000,
    cores: { mioloFrente: 4, mioloVerso: 4, capaFrente: 4, capaVerso: 4 },
    papeis: {},
    perfil: PERFIL_TESTE,
    selecao: { maquinaId: 'of-4c', folhaMioloId: '66x96', folhaCapaId: '48x66', papelMioloId: 'couche-fosco-115', papelCapaId: 'triplex-250' },
    ajustes: [],
    ...over,
  };
}

export function comBrancos(n: number, total = 30) {
  return inserirBrancos(registrarPaginas('livro.pdf', total), n, { tipo: 'antes_da_contracapa' }, 'Completar caderno', 'teste', '2026-10-31T12:00:00Z');
}
