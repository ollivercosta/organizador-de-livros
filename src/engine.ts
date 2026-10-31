/**
 * Motor de produção — orquestra paginação, imposição, física, capa, layout de máquina,
 * consumo e validação. Determinístico: mesma entrada + mesma versão de regra = mesmo resultado
 * (RNF-002). A interface NUNCA calcula imposição: apenas consome este resultado (RN-014).
 */

import { duplasDeLeitura, montarBloco, type Dupla, type UnidadeMontagem } from './binding/assembly.js';
import { MODELOS, type ModeloCapa, type ModeloId, type Montagem } from './binding/models.js';
import {
  planejarCadernos, separarComponentes, type FonteCapa, type PaginaRegistro, type PlanoCadernos,
} from './binding/pagination.js';
import { layoutSanfona } from './binding/sanfona.js';
import { calcularConsumo, type Consumo } from './consumption/paper.js';
import {
  bool, lista, nivelPorParametros, num, resolverParametros, txt,
  type AjusteProjeto, type NivelSaida, type PerfilGrafica, type Resolvidos, type SelecaoPerfil, type ValorParam,
} from './config/profile.js';
import { REGISTRO } from './config/registry.js';
import { arred, type Valor } from './core/evidence.js';
import type { Edge } from './core/geometry.js';
import { canonico, sha256 } from './core/hash.js';
import {
  capaBrochura, capaDura, capaGrampoCanoa, sobrecapa, type Planificacao, type ResultadoCapaDura,
} from './cover/cover.js';
import { calibreMm, creepPorProfundidade, espessuraBloco, lombadaBrochura, type Material } from './cover/physics.js';
import { encontrarEsquema } from './fold/schemes.js';
import { simularDobra, type SignatureLayout } from './fold/simulate.js';
import { montarFormas, type Forma, type ModoImpressao, type ParametrosMaquina, type Sangrias, type Virada } from './press/layout.js';
import { verificarFormas, verificarUnidades, type Constatacao } from './validate/verify.js';

export const VERSAO_MOTOR = '0.2.0';
/** Versão da regra de imposição. Muda quando a lógica de imposição muda (RN-007). */
export const VERSAO_REGRA = 'imposicao/2026.10-r1';

export interface DimensaoOrigem { indice: number; larguraMm: number; alturaMm: number; sangriaMm?: number }

export interface EntradaProjeto {
  projeto: { id: string; nome: string; versao: number };
  modelo: ModeloId;
  montagem?: Montagem;
  formato: { largura: number; altura: number };
  direcao: 'ltr' | 'rtl';
  encadernacaoSuperior?: boolean;
  capa: {
    modelo: ModeloCapa;
    fonte: FonteCapa;
    orelha?: number;
    sobrecapa?: boolean;
    sobrecapaOrelha?: number;
  };
  /** Páginas do arquivo principal na ordem de leitura (com brancos já aprovados pelo usuário). */
  paginas: PaginaRegistro[];
  dimensoesOrigem?: DimensaoOrigem[];
  /** Plano de cadernos escolhido pelo usuário (tamanhos na ordem de montagem). */
  planoCadernos?: number[];
  tiragem?: number;
  cores: { mioloFrente: number; mioloVerso: number; capaFrente: number; capaVerso: number };
  /** Papéis informados manualmente (usados quando não há seleção no perfil). */
  papeis: { miolo?: Material; capa?: Material; guarda?: Material };
  perfil: PerfilGrafica | null;
  selecao: SelecaoPerfil;
  ajustes: AjusteProjeto[];
}

export interface ItemMapa {
  componente: 'miolo' | 'capa';
  pagina: number;
  paginaId: string;
  rotulo: string;
  tipo: PaginaRegistro['tipo'];
  unidade: number;
  forma: string | null;
  lado: 'A' | 'B' | 'A+B' | null;
  posicao: number | null;
  rotacao: number | null;
  /** Posição lógica no caderno (antes de ir para a folha). */
  celula: { col: number; row: number; face: 'F' | 'B' } | null;
}

export interface FaceLeitura { indice: number; rotulo: string; componente: 'capa' | 'miolo' | 'guarda'; paginaMiolo: number | null; paginaId: string | null; tipo: 'conteudo' | 'branco' }

export interface ResultadoMotor {
  versaoMotor: string;
  versaoRegra: string;
  hashEntrada: string;
  geradoEm: string;
  modelo: ModeloId;
  montagem: Montagem;
  bordaEncadernacao: Edge;
  parametros: Array<{ chave: string } & Valor<ValorParam>>;
  componentes: {
    capa: PaginaRegistro[] | null;
    miolo: PaginaRegistro[];
  };
  plano: { escolhido: number[] | null; opcoes: PlanoCadernos[] };
  unidades: UnidadeMontagem[];
  formas: Forma[];
  formasCapa: Forma[];
  mapa: ItemMapa[];
  leitura: { faces: FaceLeitura[]; duplas: Dupla[] };
  fisica: {
    calibreMiolo: Valor<number>;
    calibreCapa: Valor<number>;
    espessuraBloco: Valor<number>;
    lombada: Valor<number> | null;
    creepPorFolha: Valor<number>;
    creepMaximo: number;
  };
  capa: { planificacao: Planificacao | null; capaDura: ResultadoCapaDura | null; sobrecapa: Planificacao | null; folhasDeCapa: number };
  consumo: { miolo: Consumo | null; capa: Consumo | null };
  constatacoes: Constatacao[];
  nivel: NivelSaida;
  rotuloNivel: string;
  parametrosCriticos: { pendentes: string[]; genericos: string[] };
}

export const ROTULO_NIVEL: Record<NivelSaida, string> = {
  bloqueado: 'Bloqueado para produção — há pendências ou erros',
  previa_generica: 'Prévia genérica — parâmetros críticos com valores de referência',
  validado_parametros: 'Validado para os parâmetros informados (não substitui a aprovação da gráfica)',
};

function materialDoPerfil(perfil: PerfilGrafica | null, id: string | undefined): Material | undefined {
  const p = perfil?.papeis.find((x) => x.id === id);
  if (!p || !perfil) return undefined;
  const fonte = `${perfil.grafica} v${perfil.versao}${p.fonte ? ` · ${p.fonte}` : ''}`;
  const conf = <T>(v: T | undefined): Valor<T> => (v === undefined || v === null || (v as unknown) === 0)
    ? { valor: null, origem: 'ausente', status: 'pendente' }
    : { valor: v, origem: 'grafica', status: 'confirmado', fonte, data: p.verificadoEm };
  return { id: p.id, nome: p.nome, gramatura: conf(p.gramatura), calibreUm: conf(p.calibreUm), bulk: conf(p.bulk) };
}

const SEM_MATERIAL: Material = {
  id: '-', nome: 'não informado',
  gramatura: { valor: null, origem: 'ausente', status: 'pendente' },
  calibreUm: { valor: null, origem: 'ausente', status: 'pendente' },
};

export function executarMotor(e: EntradaProjeto, agora = new Date().toISOString()): ResultadoMotor {
  const c: Constatacao[] = [];
  const modelo = MODELOS[e.modelo];
  const montagem: Montagem = e.montagem ?? modelo.montagem;
  if (montagem !== modelo.montagem && !(modelo.montagensAlternativas ?? []).includes(montagem)) {
    c.push({ codigo: 'CFG-003', severidade: 'erro', mensagem: `O modelo ${modelo.nome} não aceita montagem "${montagem}".` });
  }
  if (!modelo.capas.includes(e.capa.modelo)) {
    c.push({ codigo: 'CAP-002', severidade: 'erro', mensagem: `Modelo de capa "${e.capa.modelo}" incompatível com ${modelo.nome}.`, opcoes: modelo.capas });
  }
  if (e.encadernacaoSuperior && !modelo.aceitaEncadernacaoSuperior) {
    c.push({ codigo: 'CFG-004', severidade: 'erro', mensagem: `${modelo.nome} não aceita encadernação superior.` });
  }
  const borda: Edge = e.encadernacaoSuperior ? 'top' : e.direcao === 'ltr' ? 'left' : 'right';

  const R = resolverParametros(e.modelo, e.perfil, e.selecao, e.ajustes);
  const chavesUsadas = new Set<string>(['arquivo.sangria', 'maquina.folha.largura', 'maquina.folha.altura', 'maquina.bordaPinca', 'maquina.pinca', 'maquina.modo']);

  // ---------------- Componentes ----------------
  const comp = separarComponentes(e.paginas, e.capa.modelo, e.capa.fonte);
  comp.avisos.forEach((m) => c.push({ codigo: 'CAP-003', severidade: 'aviso', mensagem: m }));
  const miolo = comp.miolo;
  const N = miolo.length;

  // CT-004: capa enviada como página dupla (planificada) mas declarada como 4 faces no PDF.
  if (e.dimensoesOrigem && e.capa.fonte.fonte === 'no_pdf' && e.capa.modelo !== 'autocapa') {
    const d0 = e.dimensoesOrigem.find((d) => d.indice === 0);
    if (d0 && d0.larguraMm > e.formato.largura * 1.6) {
      c.push({ codigo: 'CAP-001', severidade: 'erro', mensagem: 'A primeira página do PDF parece uma capa planificada (largura ≈ 2 páginas), mas o modelo declara as faces da capa como páginas separadas.', evidencia: `pág. 1: ${arred(d0.larguraMm)} mm de largura; formato ${e.formato.largura} mm`, opcoes: ['Declarar a capa como arquivo separado', 'Substituir por faces individuais'] });
    }
  }

  // ---------------- Sangrias por tipo de borda ----------------
  const sang = num(R, 'arquivo.sangria');
  const s = sang.valor ?? 0;
  let sLombada = 0;
  if (modelo.fresagem) { const f = num(R, 'acabamento.fresagem'); chavesUsadas.add('acabamento.fresagem'); sLombada = f.valor ?? 0; }
  else if (montagem === 'folhas') sLombada = s;
  const sangrias: Sangrias = { lombada: sLombada, cabeca: s, pe: s, frente: s, lateral: s, dobra: 0 };

  // ---------------- Máquina ----------------
  const largFolha = num(R, 'maquina.folha.largura').valor;
  const altFolha = num(R, 'maquina.folha.altura').valor;
  const modo = (txt(R, 'maquina.modo').valor ?? 'frente_verso') as ModoImpressao;
  if (modo === 'frente_verso' || modo === 'perfecting') chavesUsadas.add('maquina.viradaVerso');
  const posTxt = txt(R, 'maquina.posicoes').valor ?? 'auto';
  const rotTxt = txt(R, 'maquina.rotacaoForma').valor ?? 'auto';
  const fibra = txt(R, 'maquina.fibra').valor as 'longa' | 'curta' | null;
  const maquinaBase = (w: number, h: number): ParametrosMaquina => ({
    folha: { largura: w, altura: h },
    bordaPinca: (txt(R, 'maquina.bordaPinca').valor ?? 'bottom') as Edge,
    pinca: num(R, 'maquina.pinca').valor ?? 0,
    cauda: num(R, 'maquina.cauda').valor ?? 0,
    margemLateral: num(R, 'maquina.margemLateral').valor ?? 0,
    areaMarcas: num(R, 'arquivo.areaMarcas').valor ?? 0,
    modo,
    viradaVerso: (txt(R, 'maquina.viradaVerso').valor ?? 'lateral') as Virada,
    posicoes: posTxt === 'auto' ? 'auto' : Math.max(1, Math.floor(Number(posTxt)) || 1),
    rotacaoForma: rotTxt === '90' ? 90 : rotTxt === '0' ? 0 : 'auto',
    fibra: fibra ?? undefined,
  });

  // ---------------- Plano de cadernos ----------------
  const tamanhosPerm = lista(R, 'cadernos.tamanhos');
  let tamanhos = montagem === 'folhas' ? [2] : (tamanhosPerm.valor ?? [4]);
  if ((montagem === 'aninhada' || montagem === 'alcada') && largFolha && altFolha) {
    // Só entram no planejamento os cadernos que cabem na folha de impressão configurada.
    const cabe = (t: number): boolean => {
      const id = txt(R, `cadernos.esquema.${t}`).valor;
      if (!id) return true; // a falta de esquema é reportada na montagem
      try {
        const lay = simularDobra(encontrarEsquema(id, e.perfil?.esquemasDobra ?? []), { bordaEncadernacao: borda });
        const r = montarFormas([{ layout: lay, mapa: Array.from({ length: lay.paginas }, (_, i) => i + 1), unidade: 0, profundidadeExtra: 0 }],
          e.formato, sangrias, maquinaBase(largFolha, altFolha), () => 0, 'repetir', false);
        return r.formas.length > 0;
      } catch { return true; }
    };
    const naoCabem = tamanhos.filter((t) => !cabe(t));
    if (naoCabem.length) {
      tamanhos = tamanhos.filter((t) => !naoCabem.includes(t));
      c.push({ codigo: 'CFG-005', severidade: tamanhos.length ? 'info' : 'erro', mensagem: `Cadernos de ${naoCabem.join('/')} pp não cabem na folha ${largFolha} × ${altFolha} mm (modo ${modo}) e foram excluídos do planejamento.`, evidencia: tamanhos.length ? `tamanhos usados: ${tamanhos.join('/')}` : 'nenhum tamanho de caderno cabe na folha' });
    }
  }
  const brancos = miolo.filter((p) => p.tipo === 'branco').length;
  const opcoes = N > 0 ? planejarCadernos(N, montagem, tamanhos, brancos) : [];
  let plano: number[] | null = null;
  if (e.planoCadernos) {
    const soma = e.planoCadernos.reduce((a, b) => a + b, 0);
    const invalidos = montagem === 'folhas' || montagem === 'sanfona' ? [] : e.planoCadernos.filter((t) => !tamanhos.includes(t));
    if (invalidos.length) c.push({ codigo: 'PAG-004', severidade: 'info', mensagem: 'Tamanhos aceitos considerando a folha configurada.', evidencia: tamanhos.join('/') });
    if (soma !== N) c.push({ codigo: 'PAG-002', severidade: 'erro', mensagem: `O plano escolhido soma ${soma} pp, mas o bloco tem ${N} pp.`, opcoes: opcoes.map((o) => o.descricao) });
    else if (invalidos.length) c.push({ codigo: 'PAG-003', severidade: 'erro', mensagem: `Tamanhos de caderno não aceitos pela configuração: ${invalidos.join(', ')}.` });
    else plano = e.planoCadernos;
  } else {
    const exato = opcoes.find((o) => o.ajuste === 0);
    if (exato) plano = exato.tamanhos;
    else if (N > 0) {
      c.push({
        codigo: 'PAG-001', severidade: 'erro',
        mensagem: `${N} páginas no bloco não formam ${montagem === 'folhas' ? 'folhas completas' : 'cadernos completos'} com os tamanhos ${tamanhos.join('/')}. Nenhuma página foi adicionada (RN-004).`,
        opcoes: opcoes.map((o) => o.descricao),
      });
    }
  }
  if (montagem !== 'folhas' && montagem !== 'sanfona') {
    for (const t of new Set(plano ?? [])) chavesUsadas.add(`cadernos.esquema.${t}`);
    chavesUsadas.add('cadernos.tamanhos');
  }

  // ---------------- Montagem ----------------
  let unidades: UnidadeMontagem[] = [];
  if (plano) {
    try {
      if (montagem === 'sanfona') {
        const layout = layoutSanfona(N / 2, e.direcao);
        unidades = [{ indice: 0, tamanho: N, layout, mapa: Array.from({ length: N }, (_, i) => i + 1), envoltorias: 0 }];
      } else {
        const esq: Record<number, string> = {};
        for (const t of new Set(plano)) { const v = txt(R, `cadernos.esquema.${t}`).valor; if (v) esq[t] = v; }
        unidades = montarBloco(N, plano, montagem, esq, borda, e.perfil?.esquemasDobra ?? []);
      }
      c.push(...verificarUnidades(unidades, N));
    } catch (err) {
      c.push({ codigo: 'IMP-000', severidade: 'erro', mensagem: (err as Error).message });
      unidades = [];
    }
  }

  // ---------------- Materiais e física ----------------
  const matMiolo = materialDoPerfil(e.perfil, e.selecao.papelMioloId) ?? e.papeis.miolo ?? SEM_MATERIAL;
  const matCapa = materialDoPerfil(e.perfil, e.selecao.papelCapaId) ?? e.papeis.capa ?? SEM_MATERIAL;
  const matGuarda = materialDoPerfil(e.perfil, e.selecao.papelGuardaId) ?? e.papeis.guarda ?? SEM_MATERIAL;
  const calMiolo = calibreMm(matMiolo);
  const calCapa = calibreMm(matCapa);
  const bloco = espessuraBloco(N, calMiolo);

  const creepAtivo = (bool(R, 'creep.ativo').valor ?? false) && modelo.creep !== 'nao_aplicavel' && montagem !== 'folhas' && montagem !== 'sanfona';
  const creep = creepPorProfundidade(calMiolo, num(R, 'creep.fator'), creepAtivo);
  const capaSeparadaAninhada = montagem === 'aninhada' && e.capa.modelo !== 'autocapa' ? 1 : 0;
  const totalDobradas = montagem === 'aninhada' ? N / 4 : 0;
  const creepMaximo = creepAtivo && montagem === 'aninhada' ? creep.fn(totalDobradas - 1 + capaSeparadaAninhada) : 0;
  if (creepAtivo && calMiolo.valor === null) c.push({ codigo: 'FIS-003', severidade: 'pendencia', mensagem: 'Creep não compensado: calibre do papel do miolo não informado.' });

  let formas: Forma[] = [];
  if (unidades.length && largFolha && altFolha) {
    const porEsquema = new Map<SignatureLayout, UnidadeMontagem[]>();
    for (const u of unidades) { const l = porEsquema.get(u.layout) ?? []; l.push(u); porEsquema.set(u.layout, l); }
    const agrup = (txt(R, montagem === 'folhas' ? 'folhas.agrupamento' : 'cadernos.agrupamento').valor ?? 'repetir') as 'repetir' | 'sequencial' | 'corte_empilhamento';
    const colacao = montagem === 'alcada' && (bool(R, 'arquivo.marcasColacao').valor ?? false);
    let gi = 0;
    for (const [, us] of porEsquema) {
      gi++;
      const r = montarFormas(
        us.map((u) => ({ layout: u.layout, mapa: u.mapa, unidade: u.indice, profundidadeExtra: u.envoltorias + capaSeparadaAninhada })),
        e.formato, sangrias, maquinaBase(largFolha, altFolha), creep.fn, agrup, colacao, porEsquema.size > 1 ? `M${gi}.` : 'M',
      );
      r.avisos.forEach((m) => c.push({ codigo: 'MAQ-001', severidade: 'erro', mensagem: m,
        opcoes: montagem === 'sanfona' ? ['Dividir a sanfona em segmentos com emenda (aba de colagem) — definir largura da aba com a gráfica', 'Usar folha de impressão maior', 'Reduzir o número de painéis'] : ['Usar folha maior', 'Usar caderno menor', 'Rever margens/pinça'] }));
      formas.push(...r.formas);
    }
    c.push(...verificarFormas(formas, unidades));
    for (const f of formas) {
      f.avisos.forEach((m) => c.push({ codigo: 'MAQ-004', severidade: 'aviso', mensagem: `Forma ${f.id}: ${m}` }));
      if (fibra && f.lombadaNaFolha !== 'nenhuma') {
        const longaVertical = altFolha >= largFolha;
        const fibraVertical = fibra === 'longa' ? longaVertical : !longaVertical;
        if ((f.lombadaNaFolha === 'vertical') !== fibraVertical) {
          c.push({ codigo: 'MAQ-002', severidade: 'aviso', mensagem: `Forma ${f.id}: a lombada fica perpendicular à fibra do papel (dobra e planura podem ser afetadas).` });
        }
      }
    }
    const mp = maquinaBase(largFolha, altFolha);
    if ((mp.modo === 'virada_pinca' || (mp.modo !== 'virada_lateral' && mp.viradaVerso === 'pinca')) && mp.cauda < mp.pinca) {
      c.push({ codigo: 'MAQ-003', severidade: 'info', mensagem: 'Virada pela pinça: a borda de cauda vira borda de pinça no verso; a área imprimível foi reduzida nas duas bordas.' });
    }
  } else if (unidades.length) {
    c.push({ codigo: 'MAQ-000', severidade: 'pendencia', mensagem: 'Formato da folha de impressão não informado: disponível apenas a imposição lógica dos cadernos (sem posicionamento na folha).' });
  }

  // ---------------- Limites do grampo canoa ----------------
  if (e.modelo === 'grampo_canoa') {
    const mx = num(R, 'acabamento.canoa.maxPaginas').valor;
    if (mx && N > mx) c.push({ codigo: 'FIS-002', severidade: 'aviso', mensagem: `O bloco tem ${N} pp; o limite informado para grampo canoa é ${mx} pp.` });
    const emax = num(R, 'acabamento.canoa.espessuraMax').valor;
    if (emax && bloco.valor !== null && bloco.valor > emax) c.push({ codigo: 'FIS-002', severidade: 'aviso', mensagem: `Espessura do bloco ${bloco.valor} mm excede o limite de ${emax} mm.` });
  }
  if (modelo.furacao) {
    c.push({ codigo: 'ARQ-004', severidade: 'nao_verificavel', mensagem: `Manter textos e elementos importantes a pelo menos ${num(R, 'acabamento.furacao.margem').valor ?? '?'} mm da borda de encadernação (furação/grampo).` });
  }

  // ---------------- Capa ----------------
  const W = e.formato.largura; const H = e.formato.altura; const rtl = e.direcao === 'rtl';
  let planificacao: Planificacao | null = null;
  let rCapaDura: ResultadoCapaDura | null = null;
  let plSobrecapa: Planificacao | null = null;
  let lombada: Valor<number> | null = null;
  let folhasDeCapa = 0;
  const vNum = (v: number | undefined, f: string): Valor<number> => v === undefined ? { valor: 0, origem: 'projeto', status: 'informado', fonte: f } : { valor: v, origem: 'projeto', status: 'informado', fonte: f };

  if (e.capa.modelo === 'separada_flexivel') {
    if (e.modelo === 'grampo_canoa') {
      planificacao = capaGrampoCanoa(W, H, sang, num(R, 'acabamento.canoa.extraLombadaCapa'), rtl);
    } else {
      const isBrochura = ['brochura_hotmelt', 'brochura_pur', 'brochura_costurada'].includes(e.modelo);
      if (isBrochura) chavesUsadas.add('acabamento.lombada.acrescimo');
      lombada = isBrochura
        ? lombadaBrochura(bloco, calCapa, bool(R, 'acabamento.lombada.incluirCapa'), num(R, 'acabamento.lombada.acrescimo'))
        : bloco;
      planificacao = capaBrochura(W, H, lombada, sang, vNum(e.capa.orelha, 'orelha definida no projeto'),
        num(R, 'acabamento.reducaoPainelOrelha'), num(R, 'acabamento.vincoDobradica'), rtl);
      if (lombada.valor === null) c.push({ codigo: 'FIS-001', severidade: 'pendencia', mensagem: 'Lombada não calculável: falta calibre do papel (miolo/capa). A capa não pode ser fechada.', evidencia: lombada.fonte });
    }
  } else if (e.capa.modelo === 'capa_dura') {
    for (const k of ['capaDura.espessuraPapelao', 'capaDura.esquadro', 'capaDura.canal', 'capaDura.dobraRevestimento', 'capaDura.folgaLombada', 'capaDura.recuoDobradica']) chavesUsadas.add(k);
    const calG = calibreMm(matGuarda);
    const guardas: Valor<number> = calG.valor === null || bloco.valor === null
      ? { valor: null, origem: 'ausente', status: 'pendente', fonte: 'Falta calibre do miolo ou das guardas' }
      : { ...bloco, valor: arred(bloco.valor + 4 * calG.valor, 2), fonte: `bloco + 4 folhas de guarda × ${calG.valor} mm` };
    rCapaDura = capaDura(W, H, guardas, {
      espessuraPapelao: num(R, 'capaDura.espessuraPapelao'), esquadro: num(R, 'capaDura.esquadro'), canal: num(R, 'capaDura.canal'),
      dobraRevestimento: num(R, 'capaDura.dobraRevestimento'), folgaLombada: num(R, 'capaDura.folgaLombada'), recuoDobradica: num(R, 'capaDura.recuoDobradica'),
    }, rtl);
    planificacao = rCapaDura.revestimento;
    lombada = rCapaDura.lombadaExterna;
    if (e.capa.sobrecapa) plSobrecapa = sobrecapa(rCapaDura, vNum(e.capa.sobrecapaOrelha, 'orelha da sobrecapa (projeto)'), num(R, 'acabamento.sobrecapa.envolvimento'), sang, rtl);
    if (rCapaDura.revestimento.pendencias.length) c.push({ codigo: 'FIS-001', severidade: 'pendencia', mensagem: 'Capa dura incompleta.', evidencia: rCapaDura.revestimento.pendencias.join(', ') });
  } else if (e.capa.modelo === 'folhas_de_capa') {
    folhasDeCapa = 2;
  }

  // Formas da capa (para consumo): planificação como uma "folha" única com face externa e interna.
  let formasCapa: Forma[] = [];
  if (planificacao && largFolha && altFolha && planificacao.pendencias.length === 0) {
    const folhaCapa = e.perfil?.folhas.find((f) => f.id === e.selecao.folhaCapaId);
    const layoutCapa: SignatureLayout = {
      esquema: { id: 'CAPA', nome: planificacao.componente, cols: 1, rows: 1, folds: [], familia: 'folha_solta' },
      paginas: 2, cols: 1, rows: 1, bordaEncadernacao: 'left', celulaGirada: false, codiceValido: true,
      celulas: [{ col: 0, row: 0, camada: 0, profundidade: 0,
        frente: { pagina: 1, col: 0, row: 0, rotacao: 0, bordaLombada: null },
        verso: { pagina: 2, col: 0, row: 0, rotacao: 0, bordaLombada: null },
        bordas: { left: 'frente', right: 'frente', top: 'cabeca', bottom: 'pe' } }],
    };
    const sCapa = planificacao.sangria;
    const r = montarFormas([{ layout: layoutCapa, mapa: [1, 2], unidade: 0, profundidadeExtra: 0 }],
      { largura: planificacao.largura, altura: planificacao.altura },
      { lombada: sCapa, cabeca: sCapa, pe: sCapa, frente: sCapa, lateral: sCapa, dobra: 0 },
      { ...maquinaBase(folhaCapa?.largura ?? largFolha, folhaCapa?.altura ?? altFolha), modo: 'frente_verso' }, () => 0, 'repetir', false, 'C');
    r.avisos.forEach((m) => c.push({ codigo: 'MAQ-001', severidade: 'aviso', mensagem: `Capa: ${m}` }));
    formasCapa = r.formas;
  }

  // ---------------- Arquivo de origem ----------------
  if (e.dimensoesOrigem) {
    const diverg: string[] = []; const semSangria: string[] = [];
    const idxMiolo = new Set(miolo.filter((p) => p.origem).map((p) => p.origem!.indice));
    for (const d of e.dimensoesOrigem) {
      if (!idxMiolo.has(d.indice)) continue;
      if (Math.abs(d.larguraMm - W) > 0.5 || Math.abs(d.alturaMm - H) > 0.5) diverg.push(`p.${d.indice + 1} (${arred(d.larguraMm, 1)}×${arred(d.alturaMm, 1)})`);
      if (s > 0 && (d.sangriaMm ?? 0) + 0.01 < s) semSangria.push(`p.${d.indice + 1}`);
    }
    if (diverg.length) c.push({ codigo: 'ARQ-001', severidade: 'erro', mensagem: `Páginas com formato de corte diferente de ${W}×${H} mm.`, evidencia: diverg.slice(0, 30).join(', ') + (diverg.length > 30 ? '…' : '') });
    if (semSangria.length) c.push({ codigo: 'ARQ-002', severidade: 'aviso', mensagem: `Páginas sem sangria de ${s} mm (BleedBox ausente ou menor).`, evidencia: semSangria.slice(0, 30).join(', ') + (semSangria.length > 30 ? '…' : '') });
  } else {
    c.push({ codigo: 'ARQ-003', severidade: 'nao_verificavel', mensagem: 'Dimensões do arquivo de origem não verificadas (nenhum PDF importado).' });
  }

  // ---------------- Consumo ----------------
  const tiragem: Valor<number> = e.tiragem ? { valor: e.tiragem, origem: 'projeto', status: 'informado' } : { valor: null, origem: 'ausente', status: 'pendente' };
  const consumoMiolo = formas.length ? calcularConsumo('miolo', formas, {
    tiragem, perdaPercentual: num(R, 'consumo.perdaPercentual'), acertoFolhasPorForma: num(R, 'consumo.acertoFolhas'),
    gramatura: matMiolo.gramatura, coresFrente: e.cores.mioloFrente, coresVerso: e.cores.mioloVerso,
  }) : null;
  const consumoCapa = formasCapa.length ? calcularConsumo('capa', formasCapa, {
    tiragem, perdaPercentual: num(R, 'consumo.perdaPercentual'), acertoFolhasPorForma: num(R, 'consumo.acertoFolhas'),
    gramatura: matCapa.gramatura, coresFrente: e.cores.capaFrente, coresVerso: e.cores.capaVerso,
  }) : null;

  // ---------------- Mapa de páginas ----------------
  const mapa: ItemMapa[] = [];
  const locLocal = new Map<number, { unidade: number; col: number; row: number; face: 'F' | 'B' }>();
  for (const u of unidades) {
    for (const cell of u.layout.celulas) {
      locLocal.set(u.mapa[cell.frente.pagina - 1]!, { unidade: u.indice, col: cell.col, row: cell.row, face: 'F' });
      locLocal.set(u.mapa[cell.verso.pagina - 1]!, { unidade: u.indice, col: cell.col, row: cell.row, face: 'B' });
    }
  }
  miolo.forEach((p, i) => {
    const g = i + 1;
    const loc = locLocal.get(g);
    let forma: Forma | undefined; let lado: ItemMapa['lado'] = null; let pos: number | null = null; let rot: number | null = null;
    for (const f of formas) {
      const a = f.ladoA.find((x) => x.pagina === g);
      const b = f.mesmaChapa ? undefined : f.ladoB.find((x) => x.pagina === g);
      if (a || b) { forma = f; lado = f.mesmaChapa ? 'A+B' : a ? 'A' : 'B'; pos = (a ?? b)!.posicao; rot = (a ?? b)!.rotacao; break; }
    }
    mapa.push({ componente: 'miolo', pagina: g, paginaId: p.id, rotulo: p.rotulo ?? '', tipo: p.tipo, unidade: loc?.unidade ?? -1, forma: forma?.id ?? null, lado, posicao: pos, rotacao: rot, celula: loc ? { col: loc.col, row: loc.row, face: loc.face } : null });
  });

  // ---------------- Leitura ----------------
  const faces: FaceLeitura[] = [];
  const pushCapa = (p: PaginaRegistro | undefined, rot: string) => faces.push({ indice: faces.length + 1, rotulo: rot, componente: 'capa', paginaMiolo: null, paginaId: p?.id ?? null, tipo: p?.tipo ?? 'branco' });
  const capaPag = comp.capa;
  if (e.capa.modelo !== 'autocapa' && e.capa.modelo !== 'sem_capa') {
    pushCapa(capaPag?.[0], '1ª capa'); pushCapa(capaPag?.[1], '2ª capa');
    if (e.capa.modelo === 'capa_dura') { faces.push({ indice: faces.length + 1, rotulo: 'Guarda (frente)', componente: 'guarda', paginaMiolo: null, paginaId: null, tipo: 'branco' }); faces.push({ indice: faces.length + 1, rotulo: 'Guarda (verso)', componente: 'guarda', paginaMiolo: null, paginaId: null, tipo: 'branco' }); }
  }
  miolo.forEach((p, i) => faces.push({ indice: faces.length + 1, rotulo: rotuloPapel(p, i + 1), componente: 'miolo', paginaMiolo: i + 1, paginaId: p.id, tipo: p.tipo }));
  if (e.capa.modelo !== 'autocapa' && e.capa.modelo !== 'sem_capa') {
    if (e.capa.modelo === 'capa_dura') { faces.push({ indice: faces.length + 1, rotulo: 'Guarda (frente)', componente: 'guarda', paginaMiolo: null, paginaId: null, tipo: 'branco' }); faces.push({ indice: faces.length + 1, rotulo: 'Guarda (verso)', componente: 'guarda', paginaMiolo: null, paginaId: null, tipo: 'branco' }); }
    pushCapa(capaPag?.[2], '3ª capa'); pushCapa(capaPag?.[3], '4ª capa');
  }
  const duplas = montagem === 'sanfona' ? sanfonaDuplas(N, e.direcao) : duplasDeLeitura(faces.length, e.direcao);

  // ---------------- Nível ----------------
  const crit = nivelPorParametros(R, e.modelo, chavesUsadas);
  if (crit.pendentes.length) c.push({ codigo: 'CFG-001', severidade: 'pendencia', mensagem: 'Parâmetros críticos sem valor (gráfica ou ajuste do projeto).', evidencia: crit.pendentes.map(rotuloChave).join('; ') });
  if (crit.genericos.length) c.push({ codigo: 'CFG-002', severidade: 'aviso', mensagem: 'Parâmetros críticos usando valor genérico de referência — saída apenas como prévia.', evidencia: crit.genericos.map(rotuloChave).join('; ') });
  const temErro = c.some((x) => x.severidade === 'erro');
  const temPend = c.some((x) => x.severidade === 'pendencia');
  let nivel: NivelSaida = crit.nivel;
  if (temErro || temPend || !formas.length) nivel = 'bloqueado';

  const parametros = [...R.entries()].map(([chave, v]) => ({ chave, ...v }));
  const hashEntrada = sha256(canonico({ e: { ...e, perfil: e.perfil }, regra: VERSAO_REGRA, motor: VERSAO_MOTOR }));

  return {
    versaoMotor: VERSAO_MOTOR, versaoRegra: VERSAO_REGRA, hashEntrada, geradoEm: agora,
    modelo: e.modelo, montagem, bordaEncadernacao: borda, parametros,
    componentes: { capa: comp.capa, miolo },
    plano: { escolhido: plano, opcoes },
    unidades, formas, formasCapa, mapa,
    leitura: { faces, duplas },
    fisica: { calibreMiolo: calMiolo, calibreCapa: calCapa, espessuraBloco: bloco, lombada, creepPorFolha: creep.status, creepMaximo },
    capa: { planificacao, capaDura: rCapaDura, sobrecapa: plSobrecapa, folhasDeCapa },
    consumo: { miolo: consumoMiolo, capa: consumoCapa },
    constatacoes: ordenarConstatacoes(c),
    nivel,
    rotuloNivel: ROTULO_NIVEL[nivel],
    parametrosCriticos: { pendentes: crit.pendentes, genericos: crit.genericos },
  };
}

function rotuloPapel(p: PaginaRegistro, g: number): string {
  const nomes: Record<string, string> = { '1a_capa': '1ª capa', '2a_capa': '2ª capa', '3a_capa': '3ª capa', '4a_capa': '4ª capa' };
  const base = nomes[p.papel] ?? `Pág. ${g}`;
  return p.tipo === 'branco' ? `${base} (branco)` : base;
}

function sanfonaDuplas(N: number, dir: 'ltr' | 'rtl'): Dupla[] {
  // Frente: painéis 1..n vistos em pares consecutivos; verso: n+1..2n.
  const n = N / 2; const out: Dupla[] = [];
  for (let i = 1; i <= n; i += 2) out.push(dir === 'ltr' ? { a: i, b: i + 1 <= n ? i + 1 : null } : { a: i + 1 <= n ? i + 1 : null, b: i });
  for (let i = n + 1; i <= N; i += 2) out.push(dir === 'ltr' ? { a: i, b: i + 1 <= N ? i + 1 : null } : { a: i + 1 <= N ? i + 1 : null, b: i });
  return out;
}

function rotuloChave(k: string): string {
  return REGISTRO.find((d) => d.chave === k)?.rotulo ?? k;
}

const ORDEM: Record<Constatacao['severidade'], number> = { erro: 0, pendencia: 1, aviso: 2, nao_verificavel: 3, info: 4 };
function ordenarConstatacoes(c: Constatacao[]): Constatacao[] {
  return [...c].sort((a, b) => ORDEM[a.severidade] - ORDEM[b.severidade] || a.codigo.localeCompare(b.codigo));
}
