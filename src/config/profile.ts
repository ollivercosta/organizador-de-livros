/**
 * Perfil da gráfica (arquivo enviado pela gráfica) e ajustes manuais do projeto.
 *
 * Fluxo:
 *  1. A plataforma gera um MODELO de perfil (gerarModeloPerfil) que a gráfica preenche.
 *  2. A gráfica devolve o JSON; o usuário importa na área de configuração (validarPerfil).
 *  3. O projeto seleciona máquina/folha/papéis do perfil e, quando necessário,
 *     registra AJUSTES manuais (com motivo e autor) que prevalecem sobre o perfil.
 *  4. resolverParametros produz cada valor com origem e status — o motor só consome isso.
 */

import type { ModeloId } from '../binding/models.js';
import type { Valor } from '../core/evidence.js';
import type { FoldScheme } from '../fold/schemes.js';
import { REGISTRO, REGISTRO_POR_CHAVE, aplicavel, type ParamDef } from './registry.js';

export const SCHEMA_PERFIL = 'plataforma-editorial/perfil-grafica@1';

export type ValorParam = number | string | boolean | number[];

export interface MaquinaPerfil { id: string; nome: string; parametros: Record<string, ValorParam> }
export interface FolhaPerfil { id: string; nome: string; largura: number; altura: number; fibra?: 'longa' | 'curta' }
export interface PapelPerfil {
  id: string; nome: string; fabricante?: string; linha?: string;
  gramatura: number; calibreUm?: number; bulk?: number; fonte?: string; verificadoEm?: string;
}

export interface PerfilGrafica {
  schema: typeof SCHEMA_PERFIL;
  id: string;
  grafica: string;
  versao: string;
  emitidoEm: string;
  responsavel?: string;
  contato?: string;
  /** Parâmetros gerais (chaves do registro). */
  parametros: Record<string, ValorParam>;
  maquinas: MaquinaPerfil[];
  folhas: FolhaPerfil[];
  papeis: PapelPerfil[];
  /** Esquemas de dobra próprios da gráfica (complementam o catálogo base). */
  esquemasDobra: FoldScheme[];
  observacoes?: string;
}

export interface AjusteProjeto {
  chave: string;
  valor: ValorParam;
  motivo: string;
  autor: string;
  data: string;
}

export interface SelecaoPerfil {
  maquinaId?: string;
  folhaMioloId?: string;
  folhaCapaId?: string;
  papelMioloId?: string;
  papelCapaId?: string;
  papelGuardaId?: string;
}

export interface ErroPerfil { caminho: string; mensagem: string }

function validarValor(def: ParamDef, v: unknown): string | null {
  switch (def.tipo) {
    case 'numero':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'deve ser número';
      if (def.min !== undefined && v < def.min) return `mínimo ${def.min}`;
      if (def.max !== undefined && v > def.max) return `máximo ${def.max}`;
      return null;
    case 'booleano':
      return typeof v === 'boolean' ? null : 'deve ser verdadeiro/falso';
    case 'opcao':
      return typeof v === 'string' && def.opcoes!.includes(v) ? null : `opções: ${def.opcoes!.join(', ')}`;
    case 'texto':
      return typeof v === 'string' || typeof v === 'number' ? null : 'deve ser texto';
    case 'lista_numeros':
      return Array.isArray(v) && v.every((x) => typeof x === 'number' && x > 0) ? null : 'deve ser lista de números positivos';
  }
}

export function validarPerfil(dados: unknown): { perfil: PerfilGrafica | null; erros: ErroPerfil[] } {
  const erros: ErroPerfil[] = [];
  const d = dados as Partial<PerfilGrafica> | null;
  if (!d || typeof d !== 'object') return { perfil: null, erros: [{ caminho: '', mensagem: 'Arquivo não é um objeto JSON.' }] };
  if (d.schema !== SCHEMA_PERFIL) erros.push({ caminho: 'schema', mensagem: `Esperado "${SCHEMA_PERFIL}".` });
  for (const k of ['id', 'grafica', 'versao', 'emitidoEm'] as const) {
    if (typeof d[k] !== 'string' || !d[k]) erros.push({ caminho: k, mensagem: 'Obrigatório.' });
  }
  const checarParams = (base: string, params: Record<string, unknown> | undefined) => {
    for (const [k, v] of Object.entries(params ?? {})) {
      const def = REGISTRO_POR_CHAVE.get(k);
      if (!def) { erros.push({ caminho: `${base}.${k}`, mensagem: 'Parâmetro desconhecido (verifique a versão do modelo).' }); continue; }
      const e = validarValor(def, v);
      if (e) erros.push({ caminho: `${base}.${k}`, mensagem: e });
    }
  };
  checarParams('parametros', d.parametros);
  (d.maquinas ?? []).forEach((m, i) => {
    if (!m.id) erros.push({ caminho: `maquinas[${i}].id`, mensagem: 'Obrigatório.' });
    checarParams(`maquinas[${i}].parametros`, m.parametros);
  });
  (d.folhas ?? []).forEach((f, i) => {
    if (!(f.largura > 0 && f.altura > 0)) erros.push({ caminho: `folhas[${i}]`, mensagem: 'Largura e altura obrigatórias (mm).' });
  });
  (d.papeis ?? []).forEach((p, i) => {
    if (!(p.gramatura > 0)) erros.push({ caminho: `papeis[${i}].gramatura`, mensagem: 'Obrigatória (g/m²).' });
    if (p.calibreUm === undefined && p.bulk === undefined) erros.push({ caminho: `papeis[${i}]`, mensagem: 'Informe calibre (µm) ou bulk (cm³/g) — gramatura não determina espessura.' });
  });
  (d.esquemasDobra ?? []).forEach((e, i) => {
    if (!e.id || !(e.cols > 0) || !(e.rows > 0) || !Array.isArray(e.folds)) erros.push({ caminho: `esquemasDobra[${i}]`, mensagem: 'Esquema incompleto (id, cols, rows, folds).' });
  });
  if (erros.length) return { perfil: null, erros };
  return {
    perfil: {
      schema: SCHEMA_PERFIL,
      id: d.id!, grafica: d.grafica!, versao: d.versao!, emitidoEm: d.emitidoEm!,
      responsavel: d.responsavel, contato: d.contato, observacoes: d.observacoes,
      parametros: d.parametros ?? {}, maquinas: d.maquinas ?? [], folhas: d.folhas ?? [],
      papeis: d.papeis ?? [], esquemasDobra: d.esquemasDobra ?? [],
    },
    erros,
  };
}

/** Modelo para a gráfica preencher: todas as chaves, com ajuda e unidade. */
export function gerarModeloPerfil(): Record<string, unknown> {
  const params: Record<string, string> = {};
  for (const d of REGISTRO) {
    params[d.chave] = `${d.rotulo}${d.unidade ? ` (${d.unidade})` : ''}${d.opcoes ? ` — opções: ${d.opcoes.join(' | ')}` : ''}${d.critico ? ' — CRÍTICO' : ''}. ${d.ajuda}`.trim();
  }
  return {
    schema: SCHEMA_PERFIL,
    id: 'preencher',
    grafica: 'Nome da gráfica',
    versao: '1',
    emitidoEm: 'AAAA-MM-DD',
    responsavel: 'Nome do responsável técnico',
    contato: 'e-mail/telefone',
    _instrucoes: 'Substitua cada texto de "parametros" pelo valor real (número, texto, true/false ou lista). Remova chaves que não se aplicam. Máquinas podem ter parâmetros próprios (chaves maquina.*).',
    parametros: params,
    maquinas: [{ id: 'maq-1', nome: 'Ex.: Offset 4 cores 66×96', parametros: { 'maquina.pinca': 12, 'maquina.modo': 'frente_verso', 'maquina.viradaVerso': 'lateral', 'maquina.bordaPinca': 'bottom' } }],
    folhas: [{ id: 'folha-66x96', nome: '66 × 96 cm', largura: 960, altura: 660, fibra: 'longa' }],
    papeis: [{ id: 'couche-fosco-115', nome: 'Couchê fosco 115', fabricante: '', linha: '', gramatura: 115, calibreUm: 0, fonte: 'ficha técnica do fabricante', verificadoEm: 'AAAA-MM-DD' }],
    esquemasDobra: [],
  };
}

// ---------------------------------------------------------------------------------------------

export type Resolvidos = Map<string, Valor<ValorParam>>;

export function resolverParametros(
  modelo: ModeloId,
  perfil: PerfilGrafica | null,
  selecao: SelecaoPerfil,
  ajustes: readonly AjusteProjeto[],
): Resolvidos {
  const out: Resolvidos = new Map();
  const fontePerfil = perfil ? `${perfil.grafica} — perfil v${perfil.versao} (${perfil.emitidoEm})` : '';
  const maquina = perfil?.maquinas.find((m) => m.id === selecao.maquinaId);
  const folha = perfil?.folhas.find((f) => f.id === selecao.folhaMioloId);

  // Ajustes: o mais recente de cada chave prevalece (histórico preservado no projeto).
  const ultimoAjuste = new Map<string, AjusteProjeto>();
  for (const a of [...ajustes].sort((x, y) => x.data.localeCompare(y.data))) ultimoAjuste.set(a.chave, a);

  for (const def of REGISTRO) {
    if (!aplicavel(def, modelo)) continue;
    const aj = ultimoAjuste.get(def.chave);
    if (aj) {
      out.set(def.chave, { valor: aj.valor, origem: 'projeto', status: 'informado', fonte: `Ajuste no projeto: ${aj.motivo}`, autor: aj.autor, data: aj.data, unidade: def.unidade });
      continue;
    }
    let v: ValorParam | undefined;
    let fonte = fontePerfil;
    if (folha && def.chave === 'maquina.folha.largura') { v = folha.largura; fonte += ` · folha ${folha.nome}`; }
    else if (folha && def.chave === 'maquina.folha.altura') { v = folha.altura; fonte += ` · folha ${folha.nome}`; }
    else if (folha && def.chave === 'maquina.fibra' && folha.fibra) { v = folha.fibra; fonte += ` · folha ${folha.nome}`; }
    if (v === undefined && maquina && def.chave in maquina.parametros) { v = maquina.parametros[def.chave]; fonte += ` · máquina ${maquina.nome}`; }
    if (v === undefined && perfil && def.chave in perfil.parametros) v = perfil.parametros[def.chave];
    if (v !== undefined) {
      out.set(def.chave, { valor: v, origem: 'grafica', status: 'confirmado', fonte, data: perfil!.emitidoEm, unidade: def.unidade });
      continue;
    }
    if (def.generico !== undefined) {
      out.set(def.chave, { valor: def.generico, origem: 'generico', status: 'estimado', fonte: 'Valor genérico de referência da plataforma (não confirmado pela gráfica)', unidade: def.unidade });
      continue;
    }
    out.set(def.chave, { valor: null, origem: 'ausente', status: 'pendente', fonte: 'Não informado', unidade: def.unidade });
  }
  return out;
}

export function num(r: Resolvidos, k: string): Valor<number> {
  const v = r.get(k);
  if (!v) return { valor: null, origem: 'ausente', status: 'pendente' };
  if (v.valor === null) return v as Valor<number>;
  const n = typeof v.valor === 'number' ? v.valor : Number(v.valor);
  return { ...v, valor: Number.isFinite(n) ? n : null };
}
export function txt(r: Resolvidos, k: string): Valor<string> {
  const v = r.get(k);
  if (!v) return { valor: null, origem: 'ausente', status: 'pendente' };
  return { ...v, valor: v.valor === null ? null : String(v.valor) };
}
export function bool(r: Resolvidos, k: string): Valor<boolean> {
  const v = r.get(k);
  if (!v) return { valor: null, origem: 'ausente', status: 'pendente' };
  return { ...v, valor: v.valor === null ? null : Boolean(v.valor) };
}
export function lista(r: Resolvidos, k: string): Valor<number[]> {
  const v = r.get(k);
  if (!v) return { valor: null, origem: 'ausente', status: 'pendente' };
  return { ...v, valor: Array.isArray(v.valor) ? v.valor : null };
}

/** Nível da saída de produção, a partir da origem dos parâmetros críticos aplicáveis. */
export type NivelSaida = 'bloqueado' | 'previa_generica' | 'validado_parametros';
export function nivelPorParametros(r: Resolvidos, modelo: ModeloId, chavesUsadas?: ReadonlySet<string>): { nivel: NivelSaida; pendentes: string[]; genericos: string[] } {
  const pendentes: string[] = [];
  const genericos: string[] = [];
  for (const def of REGISTRO) {
    if (!def.critico || !aplicavel(def, modelo)) continue;
    if (chavesUsadas && !chavesUsadas.has(def.chave)) continue;
    const v = r.get(def.chave);
    if (!v || v.status === 'pendente') pendentes.push(def.chave);
    else if (v.origem === 'generico') genericos.push(def.chave);
  }
  return { nivel: pendentes.length ? 'bloqueado' : genericos.length ? 'previa_generica' : 'validado_parametros', pendentes, genericos };
}
