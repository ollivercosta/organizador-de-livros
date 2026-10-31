/**
 * Geometria de capas e gabaritos (planificação).
 *
 * Todas as medidas em mm, vista EXTERNA da capa aberta, origem no canto superior esquerdo
 * da área de sangria. Para leitura LTR a ordem externa é: [orelha] 4ª capa | lombada | 1ª capa [orelha].
 * RTL espelha a ordem. A face interna (2ª/3ª) é a vista externa espelhada.
 *
 * Fórmulas por modelo:
 *  Capa flexível de grampo canoa:   largura = 2·W + extra_lombada ; altura = H
 *  Capa de brochura:                largura = 2·(W − redução_painel) + L + 2·orelha ; altura = H
 *                                   vincos de dobradiça a ±d da lombada (d da gráfica)
 *  Capa dura (caixa):
 *     papelão_altura = H + 2·esquadro
 *     papelão_largura = W + esquadro − recuo_dobradiça
 *     cartão_lombada = espessura_bloco + 2·espessura_papelão + folga_lombada
 *     revestimento_largura = 2·dobra + 2·papelão_largura + 2·canal + cartão_lombada
 *     revestimento_altura  = 2·dobra + papelão_altura
 *  Sobrecapa:                       largura = 2·orelha + 2·(papelão_largura + envolvimento) + lombada_caixa_externa
 *                                   lombada_caixa_externa = cartão_lombada + 2·espessura_papelão
 *                                   altura = papelão_altura
 *  Wire-o/espiral (folhas de capa): duas folhas W × H (1ª/2ª e 3ª/4ª)
 */

import { arred, calculado, type Proveniencia, type Valor } from '../core/evidence.js';

export interface Painel { nome: string; x: number; largura: number; tipo: 'capa' | 'lombada' | 'orelha' | 'canal' | 'papelao' | 'dobra_revestimento' }
export interface Linha { x?: number; y?: number; tipo: 'dobra' | 'vinco' | 'corte' | 'papelao' }

export interface Planificacao {
  componente: string;
  largura: number; // sem sangria
  altura: number;
  sangria: number;
  paineis: Painel[];
  linhas: Linha[];
  status: Valor<number>['status'];
  premissas: string[];
  pendencias: string[];
}

type V = Valor<number>;

function falta(...vs: Array<[string, V | Valor<boolean>]>): string[] {
  return vs.filter(([, v]) => v.valor === null).map(([n]) => n);
}

function ordenar(paineis: Omit<Painel, 'x'>[], rtl: boolean): Painel[] {
  const arr = rtl ? [...paineis].reverse() : paineis;
  let x = 0;
  return arr.map((p) => { const out = { ...p, x }; x += p.largura; return out; });
}

export function capaGrampoCanoa(W: number, H: number, sangria: V, extraLombada: V, rtl: boolean): Planificacao {
  const pend = falta(['sangria', sangria], ['extra de lombada', extraLombada]);
  const s = sangria.valor ?? 0; const e = extraLombada.valor ?? 0;
  const paineis = ordenar([
    { nome: '4ª capa', largura: W, tipo: 'capa' },
    ...(e > 0 ? [{ nome: 'lombada', largura: e, tipo: 'lombada' as const }] : []),
    { nome: '1ª capa', largura: W, tipo: 'capa' },
  ], rtl);
  const linhas: Linha[] = e > 0 ? [{ x: paineis[1]!.x, tipo: 'vinco' }, { x: paineis[2]!.x, tipo: 'vinco' }] : [{ x: W, tipo: 'dobra' }];
  return {
    componente: 'Capa (grampo canoa)', largura: arred(2 * W + e), altura: H, sangria: s, paineis, linhas,
    status: calculado(1, [sangria, extraLombada]).status, premissas: [`largura = 2 × ${W} + ${e}`], pendencias: pend,
  };
}

export function capaBrochura(
  W: number, H: number, lombada: V, sangria: V, orelha: V, reducaoPainel: V, vincoDobradica: V, rtl: boolean,
): Planificacao {
  const pend = falta(['lombada', lombada], ['sangria', sangria], ['orelha', orelha], ['redução de painel', reducaoPainel], ['vinco de dobradiça', vincoDobradica]);
  const L = lombada.valor ?? 0; const o = orelha.valor ?? 0; const r = reducaoPainel.valor ?? 0; const d = vincoDobradica.valor ?? 0;
  const pw = W - (o > 0 ? r : 0);
  const base: Omit<Painel, 'x'>[] = [];
  if (o > 0) base.push({ nome: 'orelha (4ª)', largura: o, tipo: 'orelha' });
  base.push({ nome: '4ª capa', largura: pw, tipo: 'capa' }, { nome: 'lombada', largura: L, tipo: 'lombada' }, { nome: '1ª capa', largura: pw, tipo: 'capa' });
  if (o > 0) base.push({ nome: 'orelha (1ª)', largura: o, tipo: 'orelha' });
  const paineis = ordenar(base, rtl);
  const lomb = paineis.find((p) => p.tipo === 'lombada')!;
  const linhas: Linha[] = [{ x: lomb.x, tipo: 'vinco' }, { x: lomb.x + L, tipo: 'vinco' }];
  if (d > 0) linhas.push({ x: arred(lomb.x - d), tipo: 'vinco' }, { x: arred(lomb.x + L + d), tipo: 'vinco' });
  if (o > 0) { const p0 = paineis[1]!; const pl = paineis[paineis.length - 1]!; linhas.push({ x: p0.x, tipo: 'dobra' }, { x: pl.x, tipo: 'dobra' }); }
  const entradas: Proveniencia[] = [lombada, sangria, orelha, reducaoPainel, vincoDobradica];
  return {
    componente: 'Capa (brochura)', largura: arred(2 * pw + L + 2 * o), altura: H, sangria: sangria.valor ?? 0, paineis,
    linhas: linhas.sort((a, b) => (a.x ?? 0) - (b.x ?? 0)),
    status: pend.length ? 'pendente' : calculado(1, entradas).status,
    premissas: [`largura = 2 × (${W} − ${o > 0 ? r : 0}) + ${L} + 2 × ${o}`, `vincos de dobradiça a ${d} mm da lombada`],
    pendencias: pend,
  };
}

export interface ParametrosCapaDura {
  espessuraPapelao: V; esquadro: V; canal: V; dobraRevestimento: V; folgaLombada: V; recuoDobradica: V;
}

export interface ResultadoCapaDura {
  revestimento: Planificacao;
  papelao: { largura: V; altura: V; cartaoLombada: V };
  lombadaExterna: V;
}

export function capaDura(W: number, H: number, espessuraBlocoComGuardas: V, p: ParametrosCapaDura, rtl: boolean): ResultadoCapaDura {
  const ent: Array<[string, V]> = [
    ['espessura do bloco', espessuraBlocoComGuardas], ['espessura do papelão', p.espessuraPapelao], ['esquadro', p.esquadro],
    ['canal', p.canal], ['dobra do revestimento', p.dobraRevestimento], ['folga de lombada', p.folgaLombada], ['recuo da dobradiça', p.recuoDobradica],
  ];
  const pend = ent.filter(([, v]) => v.valor === null).map(([n]) => n);
  const g = (v: V) => v.valor ?? 0;
  const pa = H + 2 * g(p.esquadro);
  const pl = W + g(p.esquadro) - g(p.recuoDobradica);
  const cl = g(espessuraBlocoComGuardas) + 2 * g(p.espessuraPapelao) + g(p.folgaLombada);
  const d = g(p.dobraRevestimento); const c = g(p.canal);
  const entradas = ent.map(([, v]) => v);
  const st = pend.length ? 'pendente' : calculado(1, entradas).status;
  const paineis = ordenar([
    { nome: 'dobra', largura: d, tipo: 'dobra_revestimento' },
    { nome: 'papelão 4ª capa', largura: pl, tipo: 'papelao' },
    { nome: 'canal', largura: c, tipo: 'canal' },
    { nome: 'cartão de lombada', largura: cl, tipo: 'lombada' },
    { nome: 'canal', largura: c, tipo: 'canal' },
    { nome: 'papelão 1ª capa', largura: pl, tipo: 'papelao' },
    { nome: 'dobra', largura: d, tipo: 'dobra_revestimento' },
  ], rtl);
  const larg = arred(2 * d + 2 * pl + 2 * c + cl);
  const alt = arred(2 * d + pa);
  const linhas: Linha[] = paineis.slice(1).map((pp) => ({ x: arred(pp.x), tipo: 'papelao' as const }));
  linhas.push({ y: d, tipo: 'papelao' }, { y: arred(d + pa), tipo: 'papelao' });
  const mk = (v: number, f: string): V => (pend.length ? { valor: null, origem: 'ausente', status: 'pendente', unidade: 'mm', fonte: f } : { ...calculado(arred(v), entradas, 'mm', f) });
  return {
    revestimento: {
      componente: 'Revestimento da capa dura', largura: larg, altura: alt, sangria: 0, paineis, linhas, status: st,
      premissas: [
        `papelão: ${arred(pl)} × ${arred(pa)} mm (W + esquadro − recuo; H + 2 × esquadro)`,
        `cartão de lombada: ${arred(cl)} mm (bloco + 2 × papelão + folga)`,
        `revestimento: 2 × ${d} + 2 × ${arred(pl)} + 2 × ${c} + ${arred(cl)} = ${larg} mm`,
      ],
      pendencias: pend,
    },
    papelao: { largura: mk(pl, 'W + esquadro − recuo'), altura: mk(pa, 'H + 2 × esquadro'), cartaoLombada: mk(cl, 'bloco + 2 × papelão + folga') },
    lombadaExterna: mk(cl + 2 * g(p.espessuraPapelao), 'cartão de lombada + 2 × papelão'),
  };
}

export function sobrecapa(caixa: ResultadoCapaDura, orelha: V, envolvimento: V, sangria: V, rtl: boolean): Planificacao {
  const pend = [...falta(['orelha da sobrecapa', orelha], ['envolvimento', envolvimento], ['sangria', sangria]), ...(caixa.revestimento.pendencias)];
  const pl = caixa.papelao.largura.valor ?? 0; const pa = caixa.papelao.altura.valor ?? 0;
  const le = caixa.lombadaExterna.valor ?? 0; const o = orelha.valor ?? 0; const e = envolvimento.valor ?? 0;
  const paineis = ordenar([
    { nome: 'orelha (4ª)', largura: o, tipo: 'orelha' },
    { nome: '4ª capa', largura: pl + e, tipo: 'capa' },
    { nome: 'lombada', largura: le, tipo: 'lombada' },
    { nome: '1ª capa', largura: pl + e, tipo: 'capa' },
    { nome: 'orelha (1ª)', largura: o, tipo: 'orelha' },
  ], rtl);
  return {
    componente: 'Sobrecapa', largura: arred(2 * o + 2 * (pl + e) + le), altura: arred(pa), sangria: sangria.valor ?? 0, paineis,
    linhas: paineis.slice(1).map((p) => ({ x: arred(p.x), tipo: 'dobra' as const })),
    status: pend.length ? 'pendente' : calculado(1, [orelha, envolvimento, sangria, caixa.lombadaExterna]).status,
    premissas: ['largura = 2·orelha + 2·(papelão + envolvimento) + lombada externa da caixa'], pendencias: pend,
  };
}

/** Painéis de folheto com compensação (dobra em rolo/janela: painéis internos menores). */
export type TipoFolheto = 'meia_dobra' | 'rolo' | 'sanfona_z' | 'janela' | 'cruzada';
export function paineisFolheto(tipo: TipoFolheto, larguraAberta: number, paineis: number, compensacao: V): { larguras: number[]; status: V['status']; formula: string } {
  const c = compensacao.valor ?? 0;
  const st = compensacao.valor === null && (tipo === 'rolo' || tipo === 'janela') ? 'pendente' : 'calculado';
  if (tipo === 'meia_dobra' || tipo === 'cruzada') return { larguras: [larguraAberta / 2, larguraAberta / 2], status: 'calculado', formula: 'L/2' };
  if (tipo === 'sanfona_z') { const w = larguraAberta / paineis; return { larguras: Array(paineis).fill(arred(w)), status: 'calculado', formula: `L/${paineis}` }; }
  if (tipo === 'rolo') {
    // n painéis; cada painel que entra por dentro é c mm menor que o anterior (o último é o mais interno).
    // Σ = n·w − c·(0+1+…+(n−2)) … simplificado: os n−1 externos iguais, internos reduzidos progressivamente.
    const k = paineis;
    const reducoes = Array.from({ length: k }, (_, i) => (i < 2 ? 0 : (i - 1) * c));
    const w = (larguraAberta + reducoes.reduce((a, b) => a + b, 0)) / k;
    return { larguras: reducoes.map((r) => arred(w - r)), status: st, formula: `painéis internos reduzidos progressivamente em ${c} mm` };
  }
  // janela: 2 abas que fecham sobre o centro; centro = 2·aba + 2·c
  const aba = (larguraAberta - 2 * c) / 4;
  return { larguras: [arred(aba), arred(2 * aba + 2 * c), arred(aba)], status: st, formula: `abas = (L − 2c)/4 ; centro = 2·aba + 2c` };
}
