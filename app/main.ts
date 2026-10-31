/**
 * Plataforma de Produção Editorial e Gráfica — interface.
 * A interface só edita a ENTRADA do motor; todo cálculo vem de executarMotor (RN-014).
 */

import { MODELOS, type ModeloCapa, type ModeloId, type Montagem } from '../src/binding/models.js';
import { inserirBrancos, registrarPaginas, removerPagina, type PaginaRegistro, type PosicaoBranco } from '../src/binding/pagination.js';
import { PERFIL_EXEMPLO } from '../src/config/exemplo.js';
import { gerarModeloPerfil, validarPerfil, type AjusteProjeto, type PerfilGrafica, type ValorParam } from '../src/config/profile.js';
import { FOLHAS_REFERENCIA, MAQUINAS_REFERENCIA, PAPEIS_REFERENCIA, SELECAO_REFERENCIA } from '../src/config/referencia.js';
import { REGISTRO, REGISTRO_POR_CHAVE, aplicavel } from '../src/config/registry.js';
import type { Material } from '../src/cover/physics.js';
import { svgCodigo } from '../src/editorial/codigoBarras.js';
import { EDITORIAL_PADRAO, type DadosEditoriais } from '../src/editorial/normas.js';
import { executarMotor, type EntradaProjeto, type ResultadoMotor } from '../src/engine.js';
import { pdfAmostra } from '../src/pdf/amostra.js';
import { gerarPdfCapa, gerarPdfCodigo, gerarPdfImposto, gerarPdfOrdemLeitura, inspecionarPdf, type RefOrigem } from '../src/pdf/impose.js';
import type { Forma } from '../src/press/layout.js';
import { fichaTecnica, mapaCsv } from '../src/report/export.js';

// ==========================================================================================
// Estado

type Dim = Awaited<ReturnType<typeof inspecionarPdf>>['dimensoes'][number];
type ModoImport = 'simples' | 'duplas' | 'livreto';
interface Analise { tipo: ModoImport | 'formato_diferente'; nSimples: number; nDuplas: number; w0: number; h0: number; total: number }
interface PdfCarregado { nome: string; bytes: Uint8Array; paginas: number; dims: Dim[]; analise: Analise; modo: ModoImport }
interface Estado {
  entrada: EntradaProjeto;
  pdf: PdfCarregado | null;
  autor: string;
  pagina: number | null;
  forma: string | null;
  lado: 'A' | 'B';
  vista: number;
  modoLeitura: 'leitor' | 'pares';
  eventos: Array<{ data: string; autor: string; texto: string }>;
  r: ResultadoMotor;
}

const agora = () => new Date().toISOString();
const ARQ = 'livro.pdf';
const CHAVE_LOCAL = 'pepg.projeto.v3';

function entradaInicial(): EntradaProjeto {
  return {
    projeto: { id: 'livro-infantil', nome: 'Livro infantil ilustrado', versao: 1 },
    modelo: 'grampo_canoa',
    formato: { largura: 160, altura: 230 },
    direcao: 'ltr',
    capa: { modelo: 'autocapa', fonte: { fonte: 'no_pdf', facesNoPdf: 4 } },
    paginas: registrarPaginas(ARQ, 30),
    tiragem: 1000,
    cores: { mioloFrente: 4, mioloVerso: 4, capaFrente: 4, capaVerso: 4 },
    papeis: {},
    perfil: null,
    selecao: { ...SELECAO_REFERENCIA, papelMioloId: 'ref-couche-f-115', papelCapaId: 'ref-triplex-250', papelGuardaId: 'ref-offset-150' },
    ajustes: [],
    editorial: structuredClone(EDITORIAL_PADRAO),
  };
}

function carregarLocal(): Partial<Estado> | null {
  try { const t = localStorage.getItem(CHAVE_LOCAL); return t ? JSON.parse(t) : null; } catch { return null; }
}
function salvarLocal() {
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify({ entrada: S.entrada, autor: S.autor, eventos: S.eventos })); } catch { /* sem armazenamento: segue */ }
}

const salvo = carregarLocal();
const S: Estado = {
  entrada: salvo?.entrada ?? entradaInicial(),
  pdf: null,
  autor: salvo?.autor ?? '',
  pagina: null, forma: null, lado: 'A', vista: 0, modoLeitura: 'leitor',
  eventos: salvo?.eventos ?? [],
  r: null as unknown as ResultadoMotor,
};
S.entrada.editorial ??= structuredClone(EDITORIAL_PADRAO);

const ed = (): DadosEditoriais => (S.entrada.editorial ??= structuredClone(EDITORIAL_PADRAO));

function recalcular() {
  S.r = executarMotor(S.entrada);
  if (S.forma && ![...S.r.formas, ...S.r.formasCapa].some((f) => f.id === S.forma)) S.forma = null;
  if (!S.forma && S.r.formas[0]) S.forma = S.r.formas[0].id;
  S.vista = Math.min(S.vista, Math.max(0, S.r.leitura.duplas.length - 1));
  salvarLocal();
}

function registrar(texto: string) {
  S.eventos.unshift({ data: agora(), autor: S.autor || 'sem nome', texto });
  S.eventos = S.eventos.slice(0, 200);
}

function mudar(fn: (e: EntradaProjeto) => void, evento?: string, novaVersao = false) {
  fn(S.entrada);
  if (novaVersao) S.entrada.projeto.versao += 1;
  if (evento) registrar(evento);
  recalcular();
  render();
  agendarVerificacaoTexto();
}

// ==========================================================================================
// Utilidades

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n2 = (v: number | null | undefined, c = 2) => (v === null || v === undefined ? '—' : Number(v.toFixed(c)).toLocaleString('pt-BR'));
const reduzMovimento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ORIGEM_ROT: Record<string, string> = { projeto: 'Projeto', grafica: 'Gráfica', referencia: 'Padrão de mercado', ausente: 'Pendente', calculado: 'Calculado' };
const SEV_ROT: Record<string, string> = { erro: 'Erro', pendencia: 'Pendência', aviso: 'Aviso', nao_verificavel: 'A conferir', info: 'Info' };
const NIVEL_CLASSE: Record<string, string> = { bloqueado: 'err', padrao_mercado: 'warn', validado_parametros: 'ok' };
const NIVEL_CURTO: Record<string, string> = { bloqueado: 'Bloqueado', padrao_mercado: 'Padrão de mercado', validado_parametros: 'Validado p/ parâmetros' };

let toastTimer = 0;
function toast(msg: string, tipo: 'ok' | 'err' = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.className = 'toast'), 5200);
}

function progresso(msg: string | null) {
  const p = $('#progresso');
  p.hidden = !msg;
  if (msg) $('#progresso-txt').textContent = msg;
}

async function oferecerArquivo(nome: string, dados: Uint8Array | string) {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (claude?.use) {
    try {
      const dl = (await claude.use('downloads')) as { save(r: { filename: string; data: unknown }): Promise<{ status: string }> } | null;
      if (dl) {
        const data = typeof dados === 'string' ? dados : new Blob([dados as BlobPart]);
        const r = await dl.save({ filename: nome, data });
        if (r.status === 'saved') toast(`${nome} salvo.`);
        return;
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') { toast('Download cancelado.'); return; }
      if (code && code !== 'unavailable' && code !== 'not_granted') { toast(`Não foi possível salvar: ${(e as Error).message ?? code}`, 'err'); return; }
    }
  }
  const blob = new Blob([typeof dados === 'string' ? dados : (dados as BlobPart)]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

// ==========================================================================================
// pdf.js (embutido, com worker próprio) e miniaturas

interface PdfJsPage { getViewport(o: { scale: number }): { width: number; height: number }; render(o: unknown): { promise: Promise<void> }; getTextContent(): Promise<{ items: Array<{ str?: string }> }>; cleanup(): void }
interface PdfJsDoc { numPages: number; getPage(n: number): Promise<PdfJsPage>; destroy(): Promise<void> }
type PdfJsLib = { getDocument(o: unknown): { promise: Promise<PdfJsDoc> }; GlobalWorkerOptions: { workerSrc: string } };

let pdfjsDoc: PdfJsDoc | null = null;
function pdfjs(): PdfJsLib | null {
  const lib = (window as unknown as { pdfjsLib?: PdfJsLib }).pdfjsLib;
  if (!lib) return null;
  if (!lib.GlobalWorkerOptions.workerSrc) {
    const src = document.getElementById('pdfjs-worker')?.textContent;
    if (src) lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  }
  return lib;
}

const thumbs = new Map<string, string>(); // chave → blob URL ('' = em fila, 'erro')
const fila: string[] = [];
let processando = false;
let falhasRender = 0;

const chaveDe = (o: RefOrigem | null | undefined) => (o ? `${o.indice}|${o.recorte ?? ''}` : '');

async function abrirPdfjs(bytes: Uint8Array) {
  for (const u of thumbs.values()) if (u.startsWith('blob:')) URL.revokeObjectURL(u);
  thumbs.clear(); fila.length = 0; falhasRender = 0;
  if (pdfjsDoc) { try { await pdfjsDoc.destroy(); } catch { /* ignora */ } }
  pdfjsDoc = null;
  const lib = pdfjs();
  if (!lib) return;
  try { pdfjsDoc = await lib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise; } catch { pdfjsDoc = null; }
}

function pedirThumb(o: RefOrigem | null | undefined, prioridade = false) {
  const k = chaveDe(o);
  if (!k || !pdfjsDoc || thumbs.has(k)) return;
  thumbs.set(k, '');
  if (prioridade) fila.unshift(k); else fila.push(k);
  void processarFila();
}

async function processarFila() {
  if (processando) return;
  processando = true;
  while (fila.length && pdfjsDoc) {
    const k = fila.shift()!;
    const [idxTxt, rec] = k.split('|');
    const indice = Number(idxTxt);
    try {
      const p = await pdfjsDoc.getPage(indice + 1);
      const vp0 = p.getViewport({ scale: 1 });
      const alvo = rec ? 1200 : 640; // largura total (metade = 600 px)
      const scale = Math.min(alvo / vp0.width, 900 / vp0.height);
      const vp = p.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await p.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      let out = c;
      if (rec) {
        out = document.createElement('canvas');
        out.width = Math.round(c.width / 2); out.height = c.height;
        out.getContext('2d')!.drawImage(c, rec === 'direita' ? -out.width : 0, 0);
      }
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/jpeg', 0.85));
      p.cleanup();
      if (!blob) throw new Error('falha');
      const url = URL.createObjectURL(blob);
      thumbs.set(k, url);
      aplicarThumb(k, url);
    } catch {
      thumbs.set(k, 'erro'); falhasRender++;
    }
    await new Promise((r) => setTimeout(r, 0)); // devolve o controle ao navegador
  }
  processando = false;
}

/** Atualiza só os elementos que mostram esta página — sem redesenhar a tela (sem piscar). */
function aplicarThumb(k: string, url: string) {
  document.querySelectorAll<HTMLElement>(`[data-th="${CSS.escape(k)}"]`).forEach((el) => {
    if (el instanceof HTMLImageElement) { el.src = url; el.classList.add('ok'); }
    else el.setAttribute('href', url);
  });
}

const urlThumb = (o: RefOrigem | null | undefined) => {
  const u = thumbs.get(chaveDe(o));
  return u && u.startsWith('blob:') ? u : '';
};

function origemDaPagina(pg: number): RefOrigem | null {
  const reg = S.r.componentes.miolo[pg - 1];
  return reg && reg.tipo !== 'branco' && reg.origem ? reg.origem : null;
}

// ==========================================================================================
// Rotas

const ROTAS = [
  ['projeto', 'Projeto'],
  ['grafica', 'Configuração da gráfica'],
  ['paginacao', 'Paginação'],
  ['leitura', 'Leitura'],
  ['imposicao', 'Imposição'],
  ['capa', 'Capa'],
  ['saida', 'Validação e arquivos'],
] as const;
type Rota = (typeof ROTAS)[number][0];
const rotaAtual = (): Rota => (ROTAS.find(([k]) => k === location.hash.replace('#', ''))?.[0] ?? 'projeto') as Rota;

function renderStatus() {
  const r = S.r;
  const erros = r.constatacoes.filter((c) => c.severidade === 'erro').length;
  const pend = r.constatacoes.filter((c) => c.severidade === 'pendencia').length;
  $('#status').innerHTML = `
    <div class="st-proj"><strong>${esc(S.entrada.projeto.nome)}</strong><span class="mono">v${S.entrada.projeto.versao} · ${esc(MODELOS[S.entrada.modelo].nome)} · ${S.entrada.formato.largura}×${S.entrada.formato.altura} mm</span></div>
    <div class="st-nivel"><span class="pill ${NIVEL_CLASSE[r.nivel]}">${NIVEL_CURTO[r.nivel]}</span>
    ${erros ? `<a class="cnt err" href="#saida">${erros} erro${erros > 1 ? 's' : ''}</a>` : ''}
    ${pend ? `<a class="cnt pend" href="#saida">${pend} pendência${pend > 1 ? 's' : ''}</a>` : ''}</div>`;
}

function render() {
  renderStatus();
  const rota = rotaAtual();
  document.querySelectorAll<HTMLAnchorElement>('#nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.r === rota ? 'page' : 'false'));
  const main = $('#main');
  main.innerHTML = '';
  ({ projeto: vProjeto, grafica: vGrafica, paginacao: vPaginacao, leitura: vLeitura, imposicao: vImposicao, capa: vCapa, saida: vSaida } as Record<Rota, (m: HTMLElement) => void>)[rota](main);
}

// ==========================================================================================
// Formulários

function campo(label: string, input: string, ajuda = '') {
  return `<label class="campo"><span class="rot">${esc(label)}</span>${input}${ajuda ? `<span class="ajuda">${esc(ajuda)}</span>` : ''}</label>`;
}
function sel(id: string, opcoes: Array<[string, string]>, valor: string) {
  return `<select id="${id}">${opcoes.map(([v, t]) => `<option value="${esc(v)}"${v === valor ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
}
function selGrupos(id: string, grupos: Array<[string, Array<[string, string]>]>, valor: string, vazio?: string) {
  return `<select id="${id}">${vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : ''}${grupos.filter(([, o]) => o.length).map(([g, ops]) => `<optgroup label="${esc(g)}">${ops.map(([v, t]) => `<option value="${esc(v)}"${v === valor ? ' selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
function num(id: string, valor: number | undefined | null, extra = '') {
  return `<input id="${id}" type="number" inputmode="decimal" value="${valor ?? ''}" ${extra}>`;
}
function on(id: string, ev: string, fn: (el: HTMLInputElement & HTMLSelectElement) => void) {
  const el = document.getElementById(id) as (HTMLInputElement & HTMLSelectElement) | null;
  el?.addEventListener(ev, () => fn(el));
}
function badge(origem: string) { return `<span class="badge o-${origem}">${ORIGEM_ROT[origem] ?? origem}</span>`; }

const ROT_CAPA: Record<ModeloCapa, string> = {
  autocapa: 'Autocapa (mesmo papel do miolo)', separada_flexivel: 'Capa separada flexível', capa_dura: 'Capa dura (caixa)', folhas_de_capa: 'Folhas de capa (wire-o/espiral)', sem_capa: 'Sem capa',
};
const ROT_MONT: Record<Montagem, string> = { aninhada: 'Cadernos aninhados', alcada: 'Cadernos alçados', folhas: 'Folhas soltas', sanfona: 'Sanfona' };

function opcoesPapel(): Array<[string, Array<[string, string]>]> {
  const p = S.entrada.perfil;
  return [
    [p ? `Gráfica: ${p.grafica}` : 'Gráfica', (p?.papeis ?? []).map((x): [string, string] => [x.id, `${x.nome}${x.calibreUm ? ` · ${x.calibreUm} µm` : ''}`])],
    ['Padrão de mercado (espessura típica)', PAPEIS_REFERENCIA.map((x): [string, string] => [x.id, `${x.nome} · ~${x.calibreUm} µm`])],
  ];
}

// ==========================================================================================
// Importação do PDF (simples, duplas, livreto já imposto)

function analisar(dims: Dim[], W: number, H: number): Analise {
  const perto = (a: number, b: number, t: number) => Math.abs(a - b) <= t;
  let nS = 0, nD = 0;
  for (const d of dims) {
    if (perto(d.alturaMm, H, 1.5) && perto(d.larguraMm, W, 1.5)) nS++;
    else if (perto(d.alturaMm, H, 1.5) && perto(d.larguraMm, 2 * W, 3)) nD++;
  }
  // formato dominante do arquivo
  const cont = new Map<string, number>();
  for (const d of dims) { const k = `${Math.round(d.larguraMm)}x${Math.round(d.alturaMm)}`; cont.set(k, (cont.get(k) ?? 0) + 1); }
  const [dom] = [...cont.entries()].sort((a, b) => b[1] - a[1]);
  const [w0, h0] = (dom?.[0] ?? '0x0').split('x').map(Number) as [number, number];
  const total = dims.length;
  let tipo: Analise['tipo'];
  if (nS + nD < total * 0.8) tipo = 'formato_diferente';
  else if (nD >= total * 0.6 && nS === 0) tipo = 'duplas';
  else if (nD > 0) tipo = 'duplas';
  else tipo = 'simples';
  return { tipo, nSimples: nS, nDuplas: nD, w0, h0, total };
}

/** Constrói o registro de páginas na ordem de leitura a partir do arquivo. */
function construirPaginas(pdf: PdfCarregado, modo: ModoImport): PaginaRegistro[] {
  const W = S.entrada.formato.largura;
  const rtl = S.entrada.direcao === 'rtl';
  const dupla = (d: Dim) => Math.abs(d.larguraMm - 2 * W) <= 3;
  const reg = (indice: number, recorte?: 'esquerda' | 'direita'): PaginaRegistro => ({
    id: `${ARQ}#${indice + 1}${recorte ? recorte[0] : ''}`, tipo: 'conteudo', papel: 'miolo',
    origem: { arquivo: ARQ, indice, ...(recorte ? { recorte } : {}) },
    rotulo: `Arquivo p.${indice + 1}${recorte ? (recorte === 'esquerda' ? ' (esq.)' : ' (dir.)') : ''}`,
  });
  if (modo === 'simples') return pdf.dims.map((d) => reg(d.indice));
  if (modo === 'duplas') {
    const out: PaginaRegistro[] = [];
    for (const d of pdf.dims) {
      if (dupla(d)) {
        const [a, b] = rtl ? (['direita', 'esquerda'] as const) : (['esquerda', 'direita'] as const);
        out.push(reg(d.indice, a), reg(d.indice, b));
      } else out.push(reg(d.indice));
    }
    return out;
  }
  // livreto (pares de impressão de grampo canoa, folha de 4 pp): folha j, lado externo = [N−2j | 1+2j], interno = [2+2j | N−1−2j]
  const N = pdf.dims.length * 2;
  const leitura: PaginaRegistro[] = new Array(N);
  pdf.dims.forEach((d, k) => {
    const j = Math.floor(k / 2);
    const [esq, dir] = k % 2 === 0 ? [N - 2 * j, 1 + 2 * j] : [2 + 2 * j, N - 1 - 2 * j];
    const [le, ld] = rtl ? (['direita', 'esquerda'] as const) : (['esquerda', 'direita'] as const);
    leitura[esq - 1] = reg(d.indice, le);
    leitura[dir - 1] = reg(d.indice, ld);
  });
  return leitura;
}

async function carregarPdf(nome: string, bytes: Uint8Array) {
  progresso(`Lendo ${nome}…`);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const insp = await inspecionarPdf(bytes);
    progresso(`Preparando visualização (${insp.paginas} páginas)…`);
    await abrirPdfjs(bytes);
    const analise = analisar(insp.dimensoes, S.entrada.formato.largura, S.entrada.formato.altura);
    const modo: ModoImport = analise.tipo === 'duplas' ? 'duplas' : 'simples';
    S.pdf = { nome, bytes, paginas: insp.paginas, dims: insp.dimensoes, analise, modo };
    aplicarImportacao(modo, true);
    const semTrim = insp.dimensoes.filter((d) => !d.temTrimBox).length;
    toast(`${nome}: ${insp.paginas} páginas lidas${analise.nDuplas ? ` · ${analise.nDuplas} páginas duplas divididas` : ''}${semTrim ? ` · ${semTrim} sem TrimBox (usada a MediaBox)` : ''}.`);
  } catch (e) {
    toast(`Não foi possível ler o PDF: ${(e as Error).message}`, 'err');
  } finally { progresso(null); }
}

function aplicarImportacao(modo: ModoImport, novoArquivo: boolean) {
  const pdf = S.pdf!;
  pdf.modo = modo;
  const novas = construirPaginas(pdf, modo);
  const conteudoAtual = S.entrada.paginas.filter((p) => p.tipo === 'conteudo').length;
  const brancos = S.entrada.paginas.length - conteudoAtual;
  const preserva = novoArquivo && conteudoAtual === novas.length && brancos > 0;
  mudar((x) => {
    if (preserva) {
      // Mesmo número de páginas de conteúdo: mantém os brancos aprovados e remapeia a origem.
      let k = 0;
      x.paginas = x.paginas.map((p) => (p.tipo === 'branco' ? p : novas[k++]!));
    } else x.paginas = novas;
    x.dimensoesOrigem = pdf.dims;
  }, `PDF ${novoArquivo ? 'importado' : 'reinterpretado'}: ${pdf.nome} (${pdf.paginas} páginas do arquivo → ${novas.length} páginas do livro, ${modo})${preserva ? `; ${brancos} branco(s) aprovado(s) mantido(s)` : ''}`, true);
}

function painelImportacao(): string {
  const p = S.pdf;
  if (!p) return '';
  const a = p.analise;
  const W = S.entrada.formato.largura, H = S.entrada.formato.altura;
  const difer = a.tipo === 'formato_diferente';
  return `<section class="painel imp ${difer ? 'alerta-painel warn' : ''}">
    <h2>Como o arquivo foi lido</h2>
    <p><strong>${esc(p.nome)}</strong> · ${p.paginas} páginas no arquivo → <strong>${S.entrada.paginas.filter((x) => x.tipo === 'conteudo').length} páginas do livro</strong>${a.nDuplas ? ` · ${a.nDuplas} páginas duplas detectadas` : ''}.</p>
    ${difer ? `<div class="alerta warn">As páginas do arquivo têm ${a.w0} × ${a.h0} mm (TrimBox), mas o projeto está em ${W} × ${H} mm. <button id="imp-fmt" class="btn mini">Usar ${a.w0 > a.h0 * 1.25 && a.w0 / 2 < a.h0 ? `${Math.round(a.w0 / 2)} × ${a.h0}` : `${a.w0} × ${a.h0}`} mm no projeto</button></div>` : ''}
    <fieldset class="opcoes-imp"><legend>O arquivo está organizado como:</legend>
      <label><input type="radio" name="imp" value="simples"${p.modo === 'simples' ? ' checked' : ''}> <span><strong>Páginas simples em ordem de leitura</strong> (1, 2, 3…). Formato recomendado.</span></label>
      <label><input type="radio" name="imp" value="duplas"${p.modo === 'duplas' ? ' checked' : ''}> <span><strong>Páginas duplas em ordem de leitura</strong> (1 · 2|3 · 4|5…). Cada dupla é dividida ao meio.</span></label>
      <label><input type="radio" name="imp" value="livreto"${p.modo === 'livreto' ? ' checked' : ''}> <span><strong>Livreto já imposto</strong> (32|1 · 2|31 · 30|3…), exportado como “imprimir livreto”. A plataforma desfaz a imposição.</span></label>
    </fieldset>
    <p class="nota">Confira na Leitura: as páginas devem aparecer na ordem em que o leitor vê o livro.</p>
  </section>`;
}

function ligarImportacao() {
  document.querySelectorAll<HTMLInputElement>('input[name="imp"]').forEach((r) => r.addEventListener('change', () => {
    if (r.checked) { aplicarImportacao(r.value as ModoImport, false); toast('Paginação reconstruída. Confira na Leitura.'); }
  }));
  on('imp-fmt', 'click', () => {
    const a = S.pdf!.analise;
    const dupla = a.w0 > a.h0 * 1.25 && a.w0 / 2 < a.h0;
    mudar((x) => { x.formato = { largura: dupla ? Math.round(a.w0 / 2) : a.w0, altura: a.h0 }; }, 'Formato ajustado ao arquivo', true);
    S.pdf!.analise = analisar(S.pdf!.dims, S.entrada.formato.largura, S.entrada.formato.altura);
    aplicarImportacao(S.pdf!.analise.tipo === 'duplas' ? 'duplas' : 'simples', false);
  });
}

// Verificação do identificador no texto do PDF (créditos e 4ª capa)
let verifTimer = 0;
function agendarVerificacaoTexto() { clearTimeout(verifTimer); verifTimer = window.setTimeout(() => void verificarTexto(), 400); }
async function verificarTexto() {
  const id = S.r?.editorial.identificador;
  if (!pdfjsDoc || !id?.valido || !id.ean13) return;
  const alvo = id.tipo === 'issn' ? id.ean13.slice(3, 10) : id.ean13;
  const contem = async (o: RefOrigem | null | undefined): Promise<boolean | null> => {
    if (!o) return null;
    try {
      const p = await pdfjsDoc!.getPage(o.indice + 1);
      const t = await p.getTextContent();
      const dig = t.items.map((x) => x.str ?? '').join(' ').replace(/[^0-9Xx]/g, '');
      return t.items.length ? dig.includes(alvo) : null;
    } catch { return null; }
  };
  const e = ed();
  const cred = e.paginas.creditos ? origemDaPagina(e.paginas.creditos) : null;
  const ult = S.r.editorial.posicao?.alvo === 'pagina_miolo' ? origemDaPagina(S.r.editorial.posicao.pagina!) : S.r.componentes.capa?.find((p) => p.papel === '4a_capa')?.origem ?? null;
  const novo = { creditos: await contem(cred), quartaCapa: await contem(ult) };
  if (JSON.stringify(novo) !== JSON.stringify(e.textoIdentificador)) {
    e.textoIdentificador = novo;
    recalcular(); render();
  }
}

// ==========================================================================================
// Vista: Projeto

function vProjeto(m: HTMLElement) {
  const e = S.entrada;
  const mod = MODELOS[e.modelo];
  const montagens: Montagem[] = [mod.montagem, ...(mod.montagensAlternativas ?? [])];
  const edi = ed();
  const r = S.r.editorial;
  const capaSeparada = e.capa.modelo !== 'autocapa' && e.capa.modelo !== 'sem_capa';
  m.innerHTML = `
  <header class="sec"><h1>Projeto</h1><p>Defina o produto e carregue o arquivo. Toda medida em milímetros; cada alteração recalcula a paginação, a imposição e a capa.</p></header>
  ${painelImportacao()}
  <section class="painel grid2">
    <div class="grupo">
      <h2>Produto</h2>
      ${campo('Nome do projeto', `<input id="p-nome" value="${esc(e.projeto.nome)}">`)}
      ${campo('Modelo de encadernação', sel('p-modelo', Object.values(MODELOS).map((x) => [x.id, x.nome]), e.modelo))}
      ${montagens.length > 1 ? campo('Montagem do miolo', sel('p-montagem', montagens.map((x) => [x, ROT_MONT[x]]), e.montagem ?? mod.montagem)) : ''}
      <div class="lado">
        ${campo('Largura fechada (mm)', num('p-w', e.formato.largura, 'min="20" step="0.5"'))}
        ${campo('Altura fechada (mm)', num('p-h', e.formato.altura, 'min="20" step="0.5"'))}
      </div>
      ${campo('Leitura', sel('p-dir', [['ltr', 'Esquerda → direita (lombada à esquerda)'], ['rtl', 'Direita → esquerda (lombada à direita)']], e.direcao))}
      ${mod.aceitaEncadernacaoSuperior ? `<label class="check"><input id="p-sup" type="checkbox"${e.encadernacaoSuperior ? ' checked' : ''}> Encadernação na borda superior (calendário, bloco)</label>` : ''}
      <p class="nota">${mod.observacoes.map(esc).join(' ')}</p>
    </div>
    <div class="grupo">
      <h2>Capa</h2>
      ${campo('Modelo de capa', sel('p-capa', mod.capas.map((c) => [c, ROT_CAPA[c]]), e.capa.modelo))}
      ${capaSeparada ? campo('Onde estão as faces da capa', sel('p-capa-fonte', [['no_pdf', 'No mesmo PDF (início e fim)'], ['arquivo_separado', 'Arquivo separado'], ['nao_impressa', 'Capa sem impressão']], e.capa.fonte.fonte)) : ''}
      ${e.capa.fonte.fonte === 'no_pdf' && capaSeparada ? campo('Faces da capa no PDF', sel('p-capa-faces', [['4', '4 faces (1ª, 2ª … 3ª, 4ª)'], ['2', '2 faces (1ª … 4ª; internas sem impressão)']], String(e.capa.fonte.facesNoPdf ?? 4)), 'Declarar evita contar a capa como miolo.') : ''}
      ${mod.orelhas && e.capa.modelo === 'separada_flexivel' ? campo('Orelhas (mm, 0 = sem)', num('p-orelha', e.capa.orelha ?? 0, 'min="0"'), 'Usual: 70 a 100 mm.') : ''}
      ${mod.sobrecapa && e.capa.modelo === 'capa_dura' ? `<label class="check"><input id="p-sobre" type="checkbox"${e.capa.sobrecapa ? ' checked' : ''}> Sobrecapa</label>${e.capa.sobrecapa ? campo('Orelha da sobrecapa (mm)', num('p-sobre-orelha', e.capa.sobrecapaOrelha ?? 80)) : ''}` : ''}
      <h2>Tiragem e cores</h2>
      <div class="lado">
        ${campo('Tiragem (exemplares)', num('p-tir', e.tiragem ?? null, 'min="1" step="1"'))}
        ${campo('Cores do miolo (frente × verso)', `<span class="lado mini">${num('p-cmf', e.cores.mioloFrente, 'min="0" max="12" aria-label="Cores frente"')}${num('p-cmv', e.cores.mioloVerso, 'min="0" max="12" aria-label="Cores verso"')}</span>`)}
      </div>
    </div>
  </section>
  <section class="painel grid2">
    <div class="grupo">
      <h2>Arquivo do livro</h2>
      ${S.pdf ? `<p class="arq"><strong>${esc(S.pdf.nome)}</strong> · ${S.pdf.paginas} páginas</p>` : `<p class="arq">Nenhum PDF carregado. O projeto usa ${e.paginas.filter((p) => p.tipo === 'conteudo').length} páginas simuladas.</p>`}
      <p class="nota">Envie <strong>o arquivo inteiro, em um único PDF, na ordem de leitura</strong>, de preferência com sangria (PDF/X). Não é preciso enviar página por página nem organizar os pares: a plataforma faz isso. Arquivos em páginas duplas ou em livreto já imposto também são reconhecidos.</p>
      <div class="acoes">
        <label class="btn"><input id="p-pdf" type="file" accept="application/pdf" hidden>Carregar PDF</label>
        <button id="p-amostra" class="btn sec">Gerar PDF de exemplo</button>
        ${!S.pdf ? `<span class="lado mini">${num('p-npag', e.paginas.filter((p) => p.tipo === 'conteudo').length, 'min="1" step="1" aria-label="Páginas simuladas"')}<button id="p-sim" class="btn sec">Simular páginas</button></span>` : ''}
      </div>
      <h2>Papéis</h2>
      ${campo('Papel do miolo', selGrupos('p-papel-m', opcoesPapel(), e.selecao.papelMioloId ?? '', 'Informar manualmente'))}
      ${!e.selecao.papelMioloId ? papelManual('m', e.papeis.miolo) : ''}
      ${capaSeparada ? campo('Papel da capa', selGrupos('p-papel-c', opcoesPapel(), e.selecao.papelCapaId ?? '', 'Informar manualmente')) + (!e.selecao.papelCapaId ? papelManual('c', e.papeis.capa) : '') : ''}
      ${mod.guardas ? campo('Papel das guardas', selGrupos('p-papel-g', opcoesPapel(), e.selecao.papelGuardaId ?? '', '—')) : ''}
      <p class="nota">Sem calibre (espessura), lombada e creep ficam pendentes: a gramatura sozinha não determina espessura.</p>
    </div>
    <div class="grupo">
      <h2>Identificação e normas</h2>
      <div class="lado">
        ${campo('Identificador', sel('e-tipo', [['isbn', 'ISBN (livro)'], ['issn', 'ISSN (revista/periódico)'], ['ismn', 'ISMN (partitura)'], ['nenhum', 'Sem identificador']], edi.identificador.tipo))}
        ${edi.identificador.tipo !== 'nenhum' ? campo('Número', `<input id="e-cod" value="${esc(edi.identificador.codigo)}" placeholder="${edi.identificador.tipo === 'isbn' ? '978-65-XXXXX-XX-X' : edi.identificador.tipo === 'issn' ? 'NNNN-NNNN' : '979-0-XXXX-XXXX-X'}" autocomplete="off">`) : ''}
      </div>
      ${r.identificador ? `<p class="id-status ${r.identificador.valido ? 'ok' : 'err'}">${r.identificador.valido ? `Válido · EAN ${r.identificador.ean13}` : esc(r.identificador.mensagens.join(' '))}</p>` : ''}
      ${edi.identificador.tipo === 'issn' ? campo('Nº da edição no código (2 dígitos)', `<input id="e-var" value="${esc(edi.identificador.variante ?? '')}" maxlength="2" inputmode="numeric">`) : ''}
      ${r.codigo ? `<div class="codigo-prev">${svgCodigo(r.codigo)}</div>
      <div class="lado">
        ${campo('Ampliação do código', sel('e-amp', [['0.8', '80% (mínimo GS1)'], ['0.9', '90%'], ['1', '100% (nominal 37,3 × 25,9 mm)'], ['1.2', '120%'], ['1.5', '150%'], ['2', '200% (máximo)']], String(edi.codigoBarras.ampliacao)))}
        ${campo('Posição na 4ª capa', sel('e-pos', [['inferior_direita', 'Inferior, lado da lombada'], ['inferior_esquerda', 'Inferior, lado da frente'], ['inferior_centro', 'Inferior, centro']], edi.codigoBarras.posicao))}
      </div>
      <label class="check"><input id="e-aplicar" type="checkbox"${edi.codigoBarras.aplicarNaCapa ? ' checked' : ''}> Desenhar o código na capa exportada (deixe desmarcado se ele já está na arte)</label>` : ''}
      <h3>Páginas com função editorial (numeração do livro)</h3>
      <div class="lado">
        ${campo('Folha de rosto', num('e-rosto', edi.paginas.folhaRosto ?? null, 'min="1" step="1"'))}
        ${campo('Créditos / ficha', num('e-cred', edi.paginas.creditos ?? null, 'min="1" step="1"'))}
        ${campo('Inícios de capítulo', `<input id="e-caps" value="${esc((edi.paginas.capitulos ?? []).join(', '))}" placeholder="7, 15, 23">`)}
      </div>
      <p class="nota">ABNT NBR 6029: folha de rosto em página ímpar; no verso dela, créditos, ISBN e ficha catalográfica. ISBN e ficha são obrigatórios no livro (Lei 10.753/2003).</p>
    </div>
  </section>
  <section class="painel"><h2>Responsável pelas alterações</h2>
    <div class="lado">${campo('Seu nome (registrado em ajustes e brancos)', `<input id="p-autor" value="${esc(S.autor)}" placeholder="Nome">`)}
    <span class="acoes"><button id="p-reset" class="btn sec">Recomeçar com o exemplo</button></span></div>
  </section>`;

  ligarImportacao();
  on('p-nome', 'change', (el) => mudar((x) => (x.projeto.nome = el.value || 'Projeto')));
  on('p-modelo', 'change', (el) => mudar((x) => {
    x.modelo = el.value as ModeloId;
    const md = MODELOS[x.modelo];
    x.montagem = undefined;
    if (!md.capas.includes(x.capa.modelo)) x.capa.modelo = md.capaPadrao;
    if (!md.aceitaEncadernacaoSuperior) x.encadernacaoSuperior = false;
  }, `Modelo alterado para ${MODELOS[el.value as ModeloId].nome}`));
  on('p-montagem', 'change', (el) => mudar((x) => (x.montagem = el.value as Montagem)));
  on('p-w', 'change', (el) => mudar((x) => (x.formato.largura = Math.max(20, Number(el.value) || x.formato.largura)), 'Formato alterado'));
  on('p-h', 'change', (el) => mudar((x) => (x.formato.altura = Math.max(20, Number(el.value) || x.formato.altura)), 'Formato alterado'));
  on('p-dir', 'change', (el) => mudar((x) => (x.direcao = el.value as 'ltr' | 'rtl')));
  on('p-sup', 'change', (el) => mudar((x) => (x.encadernacaoSuperior = el.checked)));
  on('p-capa', 'change', (el) => mudar((x) => (x.capa.modelo = el.value as ModeloCapa), `Modelo de capa: ${ROT_CAPA[el.value as ModeloCapa]}`));
  on('p-capa-fonte', 'change', (el) => mudar((x) => (x.capa.fonte = { ...x.capa.fonte, fonte: el.value as 'no_pdf' })));
  on('p-capa-faces', 'change', (el) => mudar((x) => (x.capa.fonte = { ...x.capa.fonte, facesNoPdf: Number(el.value) as 2 | 4 })));
  on('p-orelha', 'change', (el) => mudar((x) => (x.capa.orelha = Math.max(0, Number(el.value) || 0))));
  on('p-sobre', 'change', (el) => mudar((x) => (x.capa.sobrecapa = el.checked)));
  on('p-sobre-orelha', 'change', (el) => mudar((x) => (x.capa.sobrecapaOrelha = Number(el.value) || 0)));
  on('p-tir', 'change', (el) => mudar((x) => (x.tiragem = Number(el.value) > 0 ? Math.floor(Number(el.value)) : undefined)));
  on('p-cmf', 'change', (el) => mudar((x) => (x.cores.mioloFrente = Number(el.value) || 0)));
  on('p-cmv', 'change', (el) => mudar((x) => (x.cores.mioloVerso = Number(el.value) || 0)));
  on('p-papel-m', 'change', (el) => mudar((x) => (x.selecao.papelMioloId = el.value || undefined)));
  on('p-papel-c', 'change', (el) => mudar((x) => (x.selecao.papelCapaId = el.value || undefined)));
  on('p-papel-g', 'change', (el) => mudar((x) => (x.selecao.papelGuardaId = el.value || undefined)));
  ligarPapelManual('m'); ligarPapelManual('c');
  on('e-tipo', 'change', (el) => mudar(() => { ed().identificador = { tipo: el.value as DadosEditoriais['identificador']['tipo'], codigo: '' }; }));
  on('e-cod', 'change', (el) => mudar(() => (ed().identificador.codigo = el.value.trim()), `Identificador: ${el.value.trim()}`));
  on('e-var', 'change', (el) => mudar(() => (ed().identificador.variante = el.value.trim())));
  on('e-amp', 'change', (el) => mudar(() => (ed().codigoBarras.ampliacao = Number(el.value))));
  on('e-pos', 'change', (el) => mudar(() => (ed().codigoBarras.posicao = el.value as DadosEditoriais['codigoBarras']['posicao'])));
  on('e-aplicar', 'change', (el) => mudar(() => (ed().codigoBarras.aplicarNaCapa = el.checked)));
  const intOuUndef = (v: string) => (Number(v) > 0 ? Math.floor(Number(v)) : undefined);
  on('e-rosto', 'change', (el) => mudar(() => (ed().paginas.folhaRosto = intOuUndef(el.value))));
  on('e-cred', 'change', (el) => mudar(() => (ed().paginas.creditos = intOuUndef(el.value))));
  on('e-caps', 'change', (el) => mudar(() => (ed().paginas.capitulos = el.value.split(/[^0-9]+/).map(Number).filter((n) => n > 0))));
  on('p-autor', 'change', (el) => { S.autor = el.value.trim(); salvarLocal(); });
  on('p-pdf', 'change', async (el) => { const f = el.files?.[0]; if (f) await carregarPdf(f.name, new Uint8Array(await f.arrayBuffer())); });
  on('p-amostra', 'click', async () => {
    const n = S.entrada.paginas.filter((p) => p.tipo === 'conteudo').length || 30;
    progresso('Gerando PDF de exemplo…');
    const bytes = await pdfAmostra(n, S.entrada.formato.largura, S.entrada.formato.altura, 3);
    await carregarPdf(`exemplo-${n}pp.pdf`, bytes);
  });
  on('p-sim', 'click', () => {
    const n = Math.max(1, Math.floor(Number(($('#p-npag') as HTMLInputElement).value) || 1));
    mudar((x) => (x.paginas = registrarPaginas(ARQ, n)), `Páginas simuladas: ${n}`, true);
  });
  on('p-reset', 'click', () => { S.entrada = entradaInicial(); S.pdf = null; void abrirPdfjs(new Uint8Array()); registrar('Projeto reiniciado com o exemplo'); recalcular(); render(); });
}

function papelManual(k: 'm' | 'c', mat: Material | undefined) {
  return `<div class="lado">${campo('Gramatura (g/m²)', num(`p-g-${k}`, mat?.gramatura.valor ?? null, 'min="1"'))}${campo('Espessura / calibre (µm)', num(`p-cal-${k}`, mat?.calibreUm.valor ?? null, 'min="1"'))}</div>`;
}
function ligarPapelManual(k: 'm' | 'c') {
  const upd = () => mudar((x) => {
    const g = Number(($(`#p-g-${k}`) as HTMLInputElement).value) || null;
    const c = Number(($(`#p-cal-${k}`) as HTMLInputElement).value) || null;
    const mat: Material = {
      id: `manual-${k}`, nome: 'Informado no projeto',
      gramatura: { valor: g, origem: g ? 'projeto' : 'ausente', status: g ? 'informado' : 'pendente' },
      calibreUm: { valor: c, origem: c ? 'projeto' : 'ausente', status: c ? 'informado' : 'pendente' },
    };
    if (k === 'm') x.papeis.miolo = mat; else x.papeis.capa = mat;
  });
  on(`p-g-${k}`, 'change', upd); on(`p-cal-${k}`, 'change', upd);
}

// ==========================================================================================
// Vista: Configuração da gráfica

function vGrafica(m: HTMLElement) {
  const e = S.entrada;
  const p = e.perfil;
  const grupos = [...new Set(REGISTRO.map((d) => d.grupo))];
  const valorTxt = (v: ValorParam | null) => (v === null ? '—' : Array.isArray(v) ? v.join(' / ') : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v));
  const editando = m.dataset.edit ?? '';
  const folhas: Array<[string, Array<[string, string]>]> = [
    [p ? `Gráfica: ${p.grafica}` : 'Gráfica', (p?.folhas ?? []).map((x): [string, string] => [x.id, `${x.nome}${x.fibra ? ` · fibra ${x.fibra}` : ''}`])],
    ['Padrão de mercado', FOLHAS_REFERENCIA.map((x): [string, string] => [x.id, x.nome])],
  ];
  const maquinas: Array<[string, Array<[string, string]>]> = [
    [p ? `Gráfica: ${p.grafica}` : 'Gráfica', (p?.maquinas ?? []).map((x): [string, string] => [x.id, x.nome])],
    ['Padrão de mercado', MAQUINAS_REFERENCIA.map((x): [string, string] => [x.id, x.nome])],
  ];
  m.innerHTML = `
  <header class="sec"><h1>Configuração da gráfica</h1>
  <p>Sem gráfica definida, o projeto usa o <strong>padrão de mercado</strong>: valores usuais na indústria gráfica brasileira para cada modelo. Com ele dá para preparar e exportar os arquivos, que saem marcados para a gráfica confirmar. Quando a gráfica enviar o perfil técnico (ou informar um valor), ele substitui o padrão. A ordem de uso é <strong>ajuste do projeto → gráfica → padrão de mercado → pendente</strong>.</p></header>
  <section class="painel grid2">
    <div class="grupo">
      <h2>Fonte dos parâmetros</h2>
      ${p ? `<dl class="dl">
        <dt>Gráfica</dt><dd>${esc(p.grafica)}</dd><dt>Versão</dt><dd class="mono">v${esc(p.versao)} · ${esc(p.emitidoEm)}</dd>
        <dt>Responsável</dt><dd>${esc(p.responsavel ?? '—')}</dd><dt>Conteúdo</dt><dd>${p.maquinas.length} máquina(s), ${p.folhas.length} folha(s), ${p.papeis.length} papel(éis), ${p.esquemasDobra.length} esquema(s) próprio(s)</dd></dl>
        ${p.observacoes ? `<p class="nota">${esc(p.observacoes)}</p>` : ''}` : `<p><span class="badge o-referencia">Padrão de mercado</span> Nenhum perfil de gráfica importado.</p>`}
      <div class="acoes">
        <label class="btn"><input id="g-imp" type="file" accept="application/json,.json" hidden>Importar perfil da gráfica</label>
        <button id="g-modelo" class="btn sec">Baixar modelo para a gráfica preencher</button>
        ${p ? '<button id="g-exp" class="btn sec">Exportar perfil</button><button id="g-rem" class="btn sec perigo">Voltar ao padrão de mercado</button>' : '<button id="g-exemplo" class="btn sec">Carregar perfil de exemplo</button>'}
      </div>
      <div id="g-erros"></div>
    </div>
    <div class="grupo">
      <h2>Seleção para este projeto</h2>
      ${campo('Máquina', selGrupos('g-maq', maquinas, e.selecao.maquinaId ?? '', '—'))}
      ${campo('Folha do miolo', selGrupos('g-fm', folhas, e.selecao.folhaMioloId ?? '', '—'))}
      ${campo('Folha da capa', selGrupos('g-fc', folhas, e.selecao.folhaCapaId ?? '', 'Mesma do miolo'))}
      <p class="nota">A imposição é derivada pela simulação da dobra (catálogo F4 a F64 e esquemas enviados pela gráfica). Cadernos que não cabem na folha são descartados automaticamente.</p>
    </div>
  </section>
  ${grupos.map((g) => {
    const defs = REGISTRO.filter((d) => d.grupo === g && aplicavel(d, e.modelo));
    if (!defs.length) return '';
    return `<section class="painel"><h2>${esc(g)}</h2><div class="tabela-wrap"><table class="params">
      <thead><tr><th>Parâmetro</th><th class="num">Valor</th><th>Origem</th><th></th></tr></thead><tbody>
      ${defs.map((d) => {
        const v = S.r.parametros.find((x) => x.chave === d.chave);
        const editar = editando === d.chave;
        return `<tr class="${v?.status === 'pendente' ? 'pend' : ''}">
          <td><span class="pnome">${d.critico ? '<abbr title="Crítico para produção" class="crit">●</abbr> ' : ''}${esc(d.rotulo)}</span><span class="ajuda">${esc(d.ajuda)}</span></td>
          <td class="num mono">${esc(valorTxt(v?.valor ?? null))}${d.unidade && v?.valor !== null ? ` <span class="un">${esc(d.unidade)}</span>` : ''}</td>
          <td>${badge(v?.origem ?? 'ausente')}${v?.origem === 'projeto' ? `<span class="ajuda">${esc(v.fonte?.replace('Ajuste no projeto: ', '') ?? '')} · ${esc(v.autor ?? '')}</span>` : ''}</td>
          <td class="acao">${editar ? '' : `<button class="btn mini sec" data-edit="${esc(d.chave)}">Ajustar</button>`}</td></tr>
          ${editar ? `<tr class="editor"><td colspan="4"><form id="g-form" class="lado">
            ${campo('Novo valor', entradaParam(d.chave, v?.valor ?? null))}
            ${campo('Motivo (obrigatório)', '<input id="g-motivo" required placeholder="Ex.: confirmado pela gráfica em 31/10 por e-mail">')}
            <span class="acoes"><button class="btn" type="submit">Salvar ajuste</button><button class="btn sec" type="button" id="g-cancel">Cancelar</button></span></form></td></tr>` : ''}`;
      }).join('')}
      </tbody></table></div></section>`;
  }).join('')}
  <section class="painel"><h2>Ajustes deste projeto</h2>
    ${e.ajustes.length ? `<div class="tabela-wrap"><table><thead><tr><th>Parâmetro</th><th class="num">Valor</th><th>Motivo</th><th>Autor · data</th><th></th></tr></thead><tbody>
    ${e.ajustes.map((a, i) => `<tr><td>${esc(REGISTRO_POR_CHAVE.get(a.chave)?.rotulo ?? a.chave)}</td><td class="num mono">${esc(valorTxt(a.valor))}</td><td>${esc(a.motivo)}</td><td class="mono">${esc(a.autor)} · ${esc(a.data.slice(0, 16).replace('T', ' '))}</td><td><button class="btn mini sec" data-rem="${i}">Desfazer</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="vazio">Nenhum ajuste. Use "Ajustar" em qualquer parâmetro para registrar um valor deste trabalho.</p>'}
  </section>`;

  m.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) => b.addEventListener('click', () => { m.dataset.edit = b.dataset.edit!; vGrafica(m); $('#g-valor')?.focus(); }));
  m.querySelectorAll<HTMLButtonElement>('[data-rem]').forEach((b) => b.addEventListener('click', () => {
    const a = S.entrada.ajustes[Number(b.dataset.rem)]!;
    mudar((x) => x.ajustes.splice(Number(b.dataset.rem), 1), `Ajuste desfeito: ${a.chave} (era ${String(a.valor)})`, true);
  }));
  on('g-cancel', 'click', () => { m.dataset.edit = ''; vGrafica(m); });
  (document.getElementById('g-form') as HTMLFormElement | null)?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const chave = m.dataset.edit!;
    const def = REGISTRO_POR_CHAVE.get(chave)!;
    const motivo = ($('#g-motivo') as HTMLInputElement).value.trim();
    const raw = ($('#g-valor') as HTMLInputElement).value;
    if (!motivo) { toast('Informe o motivo do ajuste.', 'err'); return; }
    let valor: ValorParam;
    if (def.tipo === 'numero') {
      const n = Number(raw.replace(',', '.'));
      if (!Number.isFinite(n) || (def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) { toast(`Valor fora da faixa${def.min !== undefined ? ` (${def.min} a ${def.max})` : ''}.`, 'err'); return; }
      valor = n;
    } else if (def.tipo === 'booleano') valor = raw === 'true';
    else if (def.tipo === 'lista_numeros') {
      const l = raw.split(/[^0-9.]+/).map(Number).filter((x) => x > 0);
      if (!l.length) { toast('Informe uma lista de números (ex.: 32/16/8/4).', 'err'); return; }
      valor = l;
    } else valor = raw.trim();
    const aj: AjusteProjeto = { chave, valor, motivo, autor: S.autor || 'sem nome', data: agora() };
    m.dataset.edit = '';
    mudar((x) => x.ajustes.push(aj), `Ajuste: ${def.rotulo} = ${String(valor)} (${motivo})`, true);
    toast('Ajuste registrado no projeto.');
  });
  on('g-maq', 'change', (el) => mudar((x) => (x.selecao.maquinaId = el.value || undefined), 'Máquina selecionada'));
  on('g-fm', 'change', (el) => mudar((x) => (x.selecao.folhaMioloId = el.value || undefined), 'Folha do miolo selecionada'));
  on('g-fc', 'change', (el) => mudar((x) => (x.selecao.folhaCapaId = el.value || undefined)));
  on('g-modelo', 'click', () => oferecerArquivo('modelo-perfil-grafica.json', JSON.stringify(gerarModeloPerfil(), null, 2)));
  on('g-exp', 'click', () => oferecerArquivo(`perfil-${S.entrada.perfil!.id}-v${S.entrada.perfil!.versao}.json`, JSON.stringify(S.entrada.perfil, null, 2)));
  on('g-rem', 'click', () => mudar((x) => { x.perfil = null; x.selecao = { ...x.selecao, ...SELECAO_REFERENCIA }; }, 'Perfil da gráfica removido: padrão de mercado', true));
  on('g-exemplo', 'click', () => importarPerfil(PERFIL_EXEMPLO));
  on('g-imp', 'change', async (el) => {
    const f = el.files?.[0];
    if (!f) return;
    let dados: unknown;
    try { dados = JSON.parse(await f.text()); } catch { toast('O arquivo não é um JSON válido.', 'err'); return; }
    const { perfil, erros } = validarPerfil(dados);
    if (!perfil) {
      $('#g-erros').innerHTML = `<div class="alerta err"><strong>Perfil recusado: ${erros.length} problema(s).</strong><ul>${erros.slice(0, 20).map((x) => `<li><span class="mono">${esc(x.caminho)}</span>: ${esc(x.mensagem)}</li>`).join('')}</ul></div>`;
      return;
    }
    importarPerfil(perfil);
  });
}

function importarPerfil(p: PerfilGrafica) {
  mudar((x) => {
    x.perfil = p;
    x.selecao = { ...x.selecao, maquinaId: p.maquinas[0]?.id ?? x.selecao.maquinaId, folhaMioloId: p.folhas[0]?.id ?? x.selecao.folhaMioloId };
  }, `Perfil importado: ${p.grafica} v${p.versao}`, true);
  toast(`Perfil de ${p.grafica} (v${p.versao}) importado. Confira os papéis em Projeto.`);
}

function entradaParam(chave: string, atual: ValorParam | null) {
  const d = REGISTRO_POR_CHAVE.get(chave)!;
  const v = atual === null ? '' : Array.isArray(atual) ? atual.join('/') : String(atual);
  if (d.tipo === 'opcao') return sel('g-valor', d.opcoes!.map((o) => [o, o]), v);
  if (d.tipo === 'booleano') return sel('g-valor', [['true', 'sim'], ['false', 'não']], v || 'true');
  if (d.tipo === 'numero') return `<input id="g-valor" type="number" step="any" value="${esc(v)}" ${d.min !== undefined ? `min="${d.min}"` : ''} ${d.max !== undefined ? `max="${d.max}"` : ''} required>`;
  return `<input id="g-valor" value="${esc(v)}" required>`;
}

// ==========================================================================================
// Vista: Paginação

function vPaginacao(m: HTMLElement) {
  const r = S.r;
  const e = S.entrada;
  const pag = r.constatacoes.find((c) => c.codigo === 'PAG-001');
  const modelo = MODELOS[e.modelo];
  const autocapa = e.capa.modelo === 'autocapa';
  const capaNoPdf = !autocapa && e.capa.fonte.fonte === 'no_pdf' && e.capa.modelo !== 'sem_capa';
  m.innerHTML = `
  <header class="sec"><h1>Paginação</h1><p>Ordem de leitura e estrutura física. Nenhuma página é adicionada ou removida sem a sua confirmação.</p></header>
  ${painelImportacao()}
  <section class="painel resumo">
    <div><span class="k">Arquivo</span><span class="v mono">${S.pdf ? `${S.pdf.paginas} pp` : `${e.paginas.filter((p) => p.tipo === 'conteudo').length} pp (sim.)`}</span></div>
    <div><span class="k">Capa</span><span class="v mono">${r.componentes.capa ? `${r.componentes.capa.length} faces` : autocapa ? 'integrada' : '—'}</span></div>
    <div><span class="k">Miolo</span><span class="v mono">${r.componentes.miolo.length} pp</span></div>
    <div><span class="k">Brancos</span><span class="v mono">${r.componentes.miolo.filter((p) => p.tipo === 'branco').length}</span></div>
    <div><span class="k">Montagem</span><span class="v">${ROT_MONT[r.montagem]}</span></div>
    <div><span class="k">Plano</span><span class="v mono">${r.plano.escolhido ? r.plano.escolhido.join(' + ') : 'indefinido'}</span></div>
  </section>
  ${pag ? `<section class="painel alerta-painel err">
    <h2>Paginação incompatível com ${esc(modelo.nome)}</h2>
    <p>${esc(pag.mensagem)}</p>
    <form id="pg-form" class="lado">
      ${campo('Ajuste', sel('pg-op', r.plano.opcoes.filter((o) => o.ajuste !== 0).map((o, i): [string, string] => [String(i), o.descricao]), '0'))}
      ${campo('Posição dos brancos', sel('pg-pos', [['fim', autocapa || capaNoPdf ? 'No fim do miolo (antes da 3ª/4ª capa)' : 'No fim'], ['inicio', autocapa || capaNoPdf ? 'No início do miolo (após 1ª/2ª capa)' : 'No início']], 'fim'))}
      ${campo('Motivo', `<input id="pg-mot" value="Completar ${r.montagem === 'folhas' ? 'folha' : 'caderno'} exigido pelo acabamento">`)}
      <span class="acoes"><button class="btn" type="submit">Aplicar ajuste</button></span>
    </form>
    <p class="nota">Cadernos que não cabem na folha configurada já foram excluídos das opções.</p>
  </section>` : r.plano.escolhido ? `<section class="painel"><h2>Plano de cadernos</h2>
    <p>${r.unidades.map((u) => `<span class="chip mono">${u.indice + 1}: ${u.tamanho} pp · ${esc(u.layout.esquema.id)}</span>`).join(' ')}</p>
    ${r.montagem === 'aninhada' ? '<p class="nota">Aninhados: o caderno 1 é o mais externo; os seguintes entram no centro.</p>' : r.montagem === 'alcada' ? '<p class="nota">Alçados: cadernos empilhados em sequência; as marcas de colação no dorso conferem a ordem.</p>' : ''}
  </section>` : ''}
  <section class="painel"><h2>Páginas do miolo</h2>
    <div class="tabela-wrap"><table class="paginas"><thead><tr><th class="num">Pág.</th><th>Rótulo</th><th>Tipo</th><th>Origem</th><th>Na impressão</th><th></th></tr></thead><tbody>
    ${r.componentes.miolo.map((p, i) => {
      const mp = r.mapa[i];
      return `<tr class="${p.tipo === 'branco' ? 'branco' : ''}${S.pagina === i + 1 ? ' sel' : ''}">
        <td class="num mono">${i + 1}</td><td>${esc(p.papel !== 'miolo' ? p.papel.replace('a_capa', 'ª capa') : p.rotulo ?? '')}${p.motivo ? `<span class="ajuda">${esc(p.motivo)} · ${esc(p.autor ?? '')}</span>` : ''}</td>
        <td>${p.tipo === 'branco' ? '<span class="badge o-referencia">Branco</span>' : 'Conteúdo'}</td>
        <td class="mono">${p.origem ? `arquivo p.${p.origem.indice + 1}${p.origem.recorte ? (p.origem.recorte === 'esquerda' ? ' (esq.)' : ' (dir.)') : ''}` : '—'}</td>
        <td class="mono">${mp?.forma ? `<a href="#imposicao" data-ir="${i + 1}">${esc(mp.forma)} · lado ${mp.lado} · pos. ${(mp.posicao ?? 0) + 1}${mp.rotacao ? ` · ${mp.rotacao}°` : ''}</a>` : mp?.celula ? `cad. ${mp.unidade + 1} · ${mp.celula.face === 'F' ? 'frente' : 'verso'}` : '—'}</td>
        <td>${p.tipo === 'branco' ? `<button class="btn mini sec" data-remb="${esc(p.id)}">Remover</button>` : ''}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    ${r.componentes.capa ? `<h3>Capa (componente separado)</h3><p class="mono">${r.componentes.capa.map((p) => `${p.papel.replace('a_capa', 'ª capa')}: ${p.origem ? `arquivo p.${p.origem.indice + 1}` : 'sem impressão'}`).join(' · ')}</p>` : ''}
  </section>`;

  ligarImportacao();
  m.querySelectorAll<HTMLAnchorElement>('[data-ir]').forEach((a) => a.addEventListener('click', () => irParaPagina(Number(a.dataset.ir))));
  m.querySelectorAll<HTMLButtonElement>('[data-remb]').forEach((b) => b.addEventListener('click', () => mudar((x) => (x.paginas = removerPagina(x.paginas, b.dataset.remb!)), 'Página em branco removida', true)));
  (document.getElementById('pg-form') as HTMLFormElement | null)?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const ops = r.plano.opcoes.filter((o) => o.ajuste !== 0);
    const op = ops[Number(($('#pg-op') as HTMLSelectElement).value)];
    const motivo = ($('#pg-mot') as HTMLInputElement).value.trim();
    if (!op) return;
    if (!motivo) { toast('Informe o motivo.', 'err'); return; }
    const pos = ($('#pg-pos') as HTMLSelectElement).value as 'fim' | 'inicio';
    if (op.ajuste > 0) {
      const n = e.paginas.length;
      const faces = autocapa ? 2 : capaNoPdf ? (e.capa.fonte.facesNoPdf === 2 ? 1 : 2) : 0;
      const posicao: PosicaoBranco = pos === 'inicio' ? (faces ? { tipo: 'apos_indice', indice: faces - 1 } : { tipo: 'inicio' })
        : faces ? { tipo: 'apos_indice', indice: n - faces - 1 } : { tipo: 'fim' };
      mudar((x) => (x.paginas = inserirBrancos(x.paginas, op.ajuste, posicao, motivo, S.autor || 'sem nome', agora())), `${op.ajuste} página(s) em branco inserida(s): ${motivo}`, true);
    } else {
      let rest = -op.ajuste;
      mudar((x) => { for (let i = x.paginas.length - 1; i >= 0 && rest > 0; i--) if (x.paginas[i]!.tipo === 'branco') { x.paginas.splice(i, 1); rest--; } }, `${-op.ajuste} página(s) em branco removida(s)`, true);
    }
    toast(`Plano aplicado: ${op.descricao}`);
  });
}

function irParaPagina(pg: number) {
  S.pagina = pg;
  const mp = S.r.mapa[pg - 1];
  if (mp?.forma) { S.forma = mp.forma; S.lado = mp.lado === 'B' ? 'B' : 'A'; }
  const face = S.r.leitura.faces.find((f) => f.paginaMiolo === pg);
  if (face) {
    const k = S.r.leitura.duplas.findIndex((d) => d.a === face.indice || d.b === face.indice);
    if (k >= 0) S.vista = k;
  }
}

// ==========================================================================================
// Vista: Leitura (leitor com virada de página) e Pares de impressão

function origemDaFace(fi: number | null): RefOrigem | null {
  if (fi === null) return null;
  const f = S.r.leitura.faces[fi - 1];
  if (!f) return null;
  if (f.paginaMiolo) return origemDaPagina(f.paginaMiolo);
  if (f.componente === 'capa' && f.paginaId) {
    const reg = S.r.componentes.capa?.find((p) => p.id === f.paginaId);
    if (reg?.origem && reg.tipo !== 'branco') return reg.origem;
  }
  return null;
}

/** Conteúdo de uma página (miniatura real ou número). Estável: mesma página → mesmo HTML. */
function conteudoPagina(fi: number | null): string {
  if (fi === null) return '';
  const f = S.r.leitura.faces[fi - 1]!;
  const o = origemDaFace(fi);
  pedirThumb(o, true);
  const url = urlThumb(o);
  return `<span class="pnum">${f.paginaMiolo ?? ''}</span>${o ? `<img data-th="${esc(chaveDe(o))}" alt=""${url ? ` src="${url}" class="ok"` : ''}>` : ''}<span class="prot">${esc(f.rotulo)}</span>`;
}

function classePagina(fi: number | null) {
  if (fi === null) return 'pag vazia';
  const f = S.r.leitura.faces[fi - 1]!;
  return `pag${f.tipo === 'branco' ? ' branco' : ''} c-${f.componente}${f.paginaMiolo !== null && f.paginaMiolo === S.pagina ? ' sel' : ''}`;
}

function vLeitura(m: HTMLElement) {
  const r = S.r;
  const rtl = S.entrada.direcao === 'rtl';
  const W = S.entrada.formato.largura, H = S.entrada.formato.altura;
  m.innerHTML = `
  <header class="sec"><h1>Leitura</h1>
  <p>Confira o livro como o leitor o vê e como as páginas se juntam nas folhas.</p></header>
  <div class="segmentos topo-seg" role="tablist">
    <button class="seg${S.modoLeitura === 'leitor' ? ' on' : ''}" data-ml="leitor" role="tab" aria-selected="${S.modoLeitura === 'leitor'}">Como o leitor vê<small>ordem de leitura</small></button>
    <button class="seg${S.modoLeitura === 'pares' ? ' on' : ''}" data-ml="pares" role="tab" aria-selected="${S.modoLeitura === 'pares'}">Como as folhas se juntam<small>pares de impressão</small></button>
  </div>
  <div id="leitura-corpo"></div>`;
  m.querySelectorAll<HTMLButtonElement>('[data-ml]').forEach((b) => b.addEventListener('click', () => { S.modoLeitura = b.dataset.ml as 'leitor' | 'pares'; vLeitura(m); }));
  const corpo = $('#leitura-corpo');
  if (S.modoLeitura === 'pares') { corpo.innerHTML = paresHtml(); ligarPares(corpo); return; }

  const sup = !!S.entrada.encadernacaoSuperior;
  corpo.innerHTML = `
  <section class="painel leitor">
    <p class="nota centro">A primeira página fica sozinha à ${rtl ? 'esquerda' : 'direita'}; depois o livro abre em duplas (2|3, 4|5…). Frente e verso de uma mesma folha nunca aparecem lado a lado.</p>
    <div class="livro${sup ? ' vertical' : ''}" id="livro" style="--ar:${W}/${H}">
      <div class="${classePagina(null)} esq" id="pg-a"></div>
      <div class="${classePagina(null)} dir" id="pg-b"></div>
    </div>
    <div class="nav-leitura">
      <button id="l-prev" class="btn sec">${rtl ? 'Próxima →' : '← Anterior'}</button>
      <span class="mono" id="l-pos"></span>
      <button id="l-next" class="btn sec">${rtl ? '← Anterior' : 'Próxima →'}</button>
    </div>
    <p class="sinc" id="l-sinc"></p>
    ${!S.pdf ? '<p class="nota centro">Sem PDF carregado, as páginas aparecem numeradas. Carregue o PDF ou gere o de exemplo em Projeto.</p>' : ''}
  </section>
  <section class="painel"><h2>Todas as faces</h2>
    <div class="tira" id="tira">${r.leitura.faces.map((f) => `<button class="mini-pg ${f.tipo === 'branco' ? 'branco' : ''} c-${f.componente}" data-face="${f.indice}" title="${esc(f.rotulo)}"><span class="mono">${f.paginaMiolo ?? '·'}</span><span class="r">${esc(f.rotulo.replace('Pág. ', ''))}</span></button>`).join('')}</div>
  </section>`;

  atualizarLeitor(false);
  // botões: "prev"/"next" visuais; em RTL, avançar é para a esquerda
  on('l-prev', 'click', () => navegar(rtl ? +1 : -1));
  on('l-next', 'click', () => navegar(rtl ? -1 : +1));
  $('#livro').addEventListener('click', (ev) => {
    const alvo = (ev.target as HTMLElement).closest<HTMLElement>('.pag');
    if (!alvo || animacao) return;
    const d = S.r.leitura.duplas[S.vista]!;
    const fi = alvo.id === 'pg-a' ? d.a : d.b;
    const f = fi ? S.r.leitura.faces[fi - 1] : null;
    if (f?.paginaMiolo) { S.pagina = f.paginaMiolo; atualizarLeitor(false); }
  });
  let x0 = 0;
  $('#livro').addEventListener('pointerdown', (ev) => { x0 = ev.clientX; });
  $('#livro').addEventListener('pointerup', (ev) => {
    const dx = ev.clientX - x0;
    if (Math.abs(dx) > 40) navegar((dx < 0) !== rtl ? +1 : -1);
  });
  $('#tira').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-face]');
    if (!b) return;
    const fi = Number(b.dataset.face);
    const k = S.r.leitura.duplas.findIndex((x) => x.a === fi || x.b === fi);
    const f = S.r.leitura.faces[fi - 1];
    if (f?.paginaMiolo) S.pagina = f.paginaMiolo;
    if (k >= 0 && k !== S.vista) irParaVista(k); else atualizarLeitor(false);
  });
}

let animacao: Animation | null = null;

function navegar(passo: 1 | -1) {
  const alvo = S.vista + passo;
  if (alvo < 0 || alvo >= S.r.leitura.duplas.length) return;
  irParaVista(alvo);
}

function irParaVista(k: number) {
  if (animacao) animacao.finish();
  const de = S.vista;
  S.vista = k;
  const livro = document.getElementById('livro');
  if (!livro || Math.abs(k - de) !== 1 || reduzMovimento() || livro.classList.contains('vertical')) { atualizarLeitor(false); return; }
  virarFolha(de, k);
}

/** Atualiza as duas páginas estáticas e os indicadores (sem recriar a vista). */
function atualizarLeitor(manterA: boolean, manterB = false) {
  const d = S.r.leitura.duplas[S.vista];
  if (!d) return;
  const a = document.getElementById('pg-a');
  const b = document.getElementById('pg-b');
  if (!a || !b) return;
  const set = (el: HTMLElement, fi: number | null) => {
    const k = String(fi ?? '');
    if (el.dataset.fi !== k) { el.innerHTML = conteudoPagina(fi); el.dataset.fi = k; }
    el.className = `${classePagina(fi)} ${el.id === 'pg-a' ? 'esq' : 'dir'}`;
  };
  if (!manterA) set(a, d.a);
  if (!manterB) set(b, d.b);
  const total = S.r.leitura.duplas.length;
  const rtl = S.entrada.direcao === 'rtl';
  const prev = document.getElementById(rtl ? 'l-next' : 'l-prev') as HTMLButtonElement | null;
  const next = document.getElementById(rtl ? 'l-prev' : 'l-next') as HTMLButtonElement | null;
  if (prev) prev.disabled = S.vista <= 0;
  if (next) next.disabled = S.vista >= total - 1;
  const pos = document.getElementById('l-pos');
  if (pos) {
    const nums = [d.a, d.b].map((fi) => (fi ? S.r.leitura.faces[fi - 1]!.rotulo : null)).filter(Boolean);
    pos.textContent = `Vista ${S.vista + 1} de ${total} · ${nums.join(' | ')}`;
  }
  document.querySelectorAll<HTMLElement>('#tira [data-face]').forEach((el) => {
    const fi = Number(el.dataset.face);
    el.classList.toggle('atual', fi === d.a || fi === d.b);
  });
  const sinc = document.getElementById('l-sinc');
  if (sinc) {
    const mp = S.pagina ? S.r.mapa[S.pagina - 1] : null;
    sinc.innerHTML = mp ? `Página ${S.pagina} selecionada · ${mp.forma ? `<a href="#imposicao">forma ${esc(mp.forma)}, lado ${mp.lado}, posição ${(mp.posicao ?? 0) + 1}${mp.rotacao ? `, girada ${mp.rotacao}°` : ''}</a>` : mp.celula ? `caderno ${mp.unidade + 1}` : 'sem posição'} · ${parDe(S.pagina!)}` : 'Clique numa página para ver com qual página ela divide a folha e onde cai na impressão.';
  }
  // pré-carrega as vistas vizinhas (evita página em branco durante a virada)
  for (const kk of [S.vista - 1, S.vista + 1, S.vista + 2]) {
    const dd = S.r.leitura.duplas[kk];
    if (dd) { pedirThumb(origemDaFace(dd.a)); pedirThumb(origemDaFace(dd.b)); }
  }
}

function parDe(pg: number): string {
  for (const p of paresImpressao()) {
    for (const lado of [p.fora, p.dentro]) if (lado.includes(pg)) return `divide a folha dobrada ${p.folha} com as páginas ${[...p.fora, ...p.dentro].filter((x) => x !== pg && x > 0).join(', ')}`;
  }
  return '';
}

/** Animação de virada: a folha gira 180° em torno da lombada, com sombra. */
function virarFolha(de: number, para: number) {
  const D = S.r.leitura.duplas;
  const velha = D[de]!, nova = D[para]!;
  const avanca = para > de;
  const rtl = S.entrada.direcao === 'rtl';
  // Em LTR, avançar vira a página da direita para a esquerda.
  const viraDireita = avanca !== rtl;
  const livro = document.getElementById('livro')!;
  const frenteFi = viraDireita ? velha.b : velha.a;
  const versoFi = viraDireita ? nova.a : nova.b;
  if (frenteFi === null && versoFi === null) { atualizarLeitor(false); return; }
  const folha = document.createElement('div');
  folha.className = `folha-vira ${viraDireita ? 'da-direita' : 'da-esquerda'}`;
  folha.innerHTML = `<div class="face frente ${classePagina(frenteFi)}">${conteudoPagina(frenteFi)}<i class="sombra"></i></div><div class="face verso ${classePagina(versoFi)}">${conteudoPagina(versoFi)}<i class="sombra"></i></div>`;
  livro.append(folha);
  // Sob a folha: o lado que será descoberto já mostra a nova página; o outro mantém a antiga até a folha pousar.
  if (viraDireita) atualizarLeitor(true, false); else atualizarLeitor(false, true);
  const ang = viraDireita ? -180 : 180;
  animacao = folha.animate(
    [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${ang / 2}deg) translateZ(1px)`, offset: 0.5 }, { transform: `rotateY(${ang}deg)` }],
    { duration: 680, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' },
  );
  folha.querySelectorAll<HTMLElement>('.sombra').forEach((s, i) => s.animate(
    i === 0 ? [{ opacity: 0 }, { opacity: 0.35 }, { opacity: 0.6 }] : [{ opacity: 0.6 }, { opacity: 0.35 }, { opacity: 0 }],
    { duration: 680, easing: 'ease-in-out', fill: 'forwards' },
  ));
  const fim = () => { atualizarLeitor(false); folha.remove(); animacao = null; };
  animacao.onfinish = fim;
  animacao.oncancel = fim;
}

interface ParImpressao { folha: number; caderno: number; fora: [number, number]; dentro: [number, number]; solta: boolean }

/** Pares de impressão: em cada folha dobrada, quais páginas ficam lado a lado (lado de fora e de dentro). */
function paresImpressao(): ParImpressao[] {
  const r = S.r;
  const out: ParImpressao[] = [];
  let n = 0;
  if (r.montagem === 'sanfona') return out;
  const ordem = r.montagem === 'aninhada' ? r.unidades : r.unidades; // aninhada: unidades já vêm da mais externa para a interna
  for (const u of ordem) {
    const L = u.layout.celulas.length;
    const P = u.tamanho;
    if (u.layout.esquema.folds.length === 0) {
      out.push({ folha: ++n, caderno: u.indice + 1, fora: [u.mapa[0]!, 0], dentro: [u.mapa[1]!, 0], solta: true });
      continue;
    }
    for (let k = 0; k < L / 2; k++) {
      // folhas k e L−1−k unidas na lombada: fora = [P−2k | 2k+1], dentro = [2k+2 | P−2k−1]
      out.push({ folha: ++n, caderno: u.indice + 1, fora: [u.mapa[P - 2 * k - 1]!, u.mapa[2 * k]!], dentro: [u.mapa[2 * k + 1]!, u.mapa[P - 2 * k - 2]!], solta: false });
    }
  }
  return out;
}

function miniPg(pg: number) {
  if (!pg) return '<span class="mp vazia"></span>';
  const o = origemDaPagina(pg);
  const url = urlThumb(o);
  pedirThumb(o);
  const br = !o;
  return `<span class="mp${br ? ' br' : ''}${pg === S.pagina ? ' sel' : ''}" data-pg="${pg}"><b>${pg}</b>${o ? `<img data-th="${esc(chaveDe(o))}" alt=""${url ? ` src="${url}" class="ok"` : ''}>` : ''}</span>`;
}

function paresHtml(): string {
  const r = S.r;
  const pares = paresImpressao();
  const N = r.componentes.miolo.length;
  const rtl = S.entrada.direcao === 'rtl';
  const ord = (a: number, b: number) => (rtl ? [b, a] : [a, b]);
  if (r.montagem === 'sanfona') return `<section class="painel"><p>Sanfona: painéis 1 a ${N / 2} na frente da tira e ${N / 2 + 1} a ${N} no verso.</p></section>`;
  if (!pares.length) return `<section class="painel"><p class="vazio">Resolva a paginação para ver como as folhas se juntam.</p></section>`;
  const aninhado = r.montagem === 'aninhada';
  const ilustr = aninhado ? ilustracaoAninhada(pares) : '';
  return `<section class="painel">
    <h2>Como as páginas se juntam na impressão</h2>
    <p>${pares[0]!.solta ? 'Folhas soltas: cada folha tem uma página na frente e a seguinte no verso.' : aninhado
      ? `No livro aberto você vê 2|3, 4|5… Mas, na <strong>folha impressa</strong>, ficam lado a lado as páginas que se encontram depois da dobra: a <strong>primeira com a última</strong> (${N}|1), a segunda com a penúltima (2|${N - 1}) e assim por diante. Em toda folha dobrada, as páginas somam <strong>${N + 1}</strong>.`
      : `Cadernos alçados: cada caderno é dobrado separadamente. Dentro de cada caderno, a primeira página fica com a última do caderno; as páginas de cada folha somam o primeiro + o último número do caderno.`}</p>
    ${ilustr}
  </section>
  <section class="painel"><h2>Folhas dobradas (da mais externa para a mais interna)</h2>
    <div class="pares" style="--ar:${S.entrada.formato.largura}/${S.entrada.formato.altura}">${pares.map((p) => `<article class="par">
      <header><strong>Folha ${p.folha}</strong>${r.unidades.length > 1 ? ` <span class="ajuda">caderno ${p.caderno}</span>` : ''}${!p.solta ? ` <span class="soma mono">${p.fora[0] + p.fora[1]}</span>` : ''}</header>
      ${p.solta ? `<div class="lados"><div><span class="k">Frente</span><div class="dupla-mini">${miniPg(p.fora[0])}</div></div><div><span class="k">Verso</span><div class="dupla-mini">${miniPg(p.dentro[0])}</div></div></div>`
        : `<div class="lados"><div><span class="k">Lado de fora</span><div class="dupla-mini">${ord(p.fora[0], p.fora[1]).map(miniPg).join('')}</div></div>
        <div><span class="k">Lado de dentro</span><div class="dupla-mini">${ord(p.dentro[0], p.dentro[1]).map(miniPg).join('')}</div></div></div>`}
    </article>`).join('')}</div>
    <p class="nota">É a mesma relação da tabela do protótipo original (32|1, 2|31, 30|3…). A vista Imposição mostra essas folhas posicionadas na folha da máquina.</p>
  </section>`;
}

function ilustracaoAninhada(pares: ParImpressao[]): string {
  const lista = pares.slice(0, 12);
  const n = lista.length;
  const passo = 16;                 // distância vertical entre folhas
  const H = 40 + 2 * n * passo + 10;
  const meio = H / 2;
  const xLomb = 90;                  // dobra da folha mais externa
  const xFim = 430;                  // borda da frente
  const linhas = lista.map((p, i) => {
    const yTopo = 20 + i * passo;
    const yBase = H - 20 - i * passo;
    const xDobra = xLomb + i * 9;    // folhas internas dobram mais para dentro
    const r = (yBase - yTopo) / 2;
    return `<path d="M ${xFim} ${yTopo} L ${xDobra + r * 0.6} ${yTopo} Q ${xDobra} ${yTopo} ${xDobra} ${meio} Q ${xDobra} ${yBase} ${xDobra + r * 0.6} ${yBase} L ${xFim} ${yBase}" class="dobra-l"/>
      <text x="${xFim + 8}" y="${yTopo + 4}" class="dobra-t">${p.fora[1]} · ${p.dentro[0]}</text>
      <text x="${xFim + 8}" y="${yBase + 4}" class="dobra-t">${p.dentro[1]} · ${p.fora[0]}</text>`;
  }).join('');
  return `<figure class="ilustra"><svg viewBox="0 0 520 ${H}" role="img" aria-label="Folhas dobradas umas dentro das outras">${linhas}
    <text x="${xLomb - 12}" y="${meio + 4}" class="dobra-t" text-anchor="end">lombada</text>
    <text x="${xFim + 8}" y="12" class="dobra-t sub">página · verso</text></svg>
    <figcaption class="nota">Corte do livro visto de cima: cada linha é uma folha dobrada, uma dentro da outra. Lendo os números de cima para baixo, você percorre o livro em ordem.${pares.length > 12 ? ` Mostrando as 12 folhas mais externas de ${pares.length}.` : ''}</figcaption></figure>`;
}

function ligarPares(c: HTMLElement) {
  c.querySelectorAll<HTMLElement>('[data-pg]').forEach((el) => el.addEventListener('click', () => {
    irParaPagina(Number(el.dataset.pg)); S.modoLeitura = 'leitor'; render();
  }));
}

// ==========================================================================================
// Vista: Imposição

function svgForma(f: Forma, lado: 'A' | 'B', capa: boolean): string {
  const W = f.folha.largura, H = f.folha.altura;
  const lista = lado === 'A' ? f.ladoA : f.ladoB;
  const fmt = capa ? null : S.entrada.formato;
  const area = f.areaImprimivel;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" class="s-folha"/>`);
  parts.push(`<rect x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}" class="s-area"/>`);
  const borda = String(S.r.parametros.find((p) => p.chave === 'maquina.bordaPinca')?.valor ?? 'bottom');
  const tumbleB = lado === 'B' && f.viradaVerso === 'pinca' && !f.mesmaChapa;
  const bp = tumbleB ? ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as Record<string, string>)[borda]! : borda;
  const pv = Number(S.r.parametros.find((p) => p.chave === 'maquina.pinca')?.valor ?? 0);
  const pr = bp === 'bottom' ? [0, H - pv, W, pv] : bp === 'top' ? [0, 0, W, pv] : bp === 'left' ? [0, 0, pv, H] : [W - pv, 0, pv, H];
  parts.push(`<rect x="${pr[0]}" y="${pr[1]}" width="${pr[2]}" height="${pr[3]}" class="s-pinca"/>`);
  parts.push(`<text x="${pr[0]! + (bp === 'left' || bp === 'right' ? pv / 2 : W / 2)}" y="${pr[1]! + (bp === 'top' || bp === 'bottom' ? pv / 2 + 3 : H / 2)}" class="s-pinca-t">PINÇA</text>`);
  for (const p of lista) {
    const c = p.corte;
    parts.push(`<rect x="${c.x - p.sangria.l}" y="${c.y - p.sangria.t}" width="${c.w + p.sangria.l + p.sangria.r}" height="${c.h + p.sangria.t + p.sangria.b}" class="s-sang"/>`);
    const o = capa ? null : origemDaPagina(p.pagina);
    const br = !capa && o === null;
    const sel = !capa && p.pagina === S.pagina;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const pw = fmt ? fmt.largura : c.w, ph = fmt ? fmt.altura : c.h;
    if (o) pedirThumb(o);
    const url = urlThumb(o);
    parts.push(`<g class="s-pg${br ? ' br' : ''}${sel ? ' sel' : ''}" data-pg="${capa ? '' : p.pagina}">
      <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" class="s-corte"/>
      <g transform="translate(${cx} ${cy}) rotate(${p.rotacao})">
        ${o ? `<image data-th="${esc(chaveDe(o))}" href="${url}" x="${-pw / 2}" y="${-ph / 2}" width="${pw}" height="${ph}" preserveAspectRatio="none"/>` : ''}
        <text x="0" y="${o ? ph / 2 - ph * 0.09 : 0}" class="s-num${o ? ' sobre' : ''}" style="font-size:${Math.min(pw, ph) * (o ? 0.16 : 0.32)}px">${capa ? (p.pagina === 1 ? 'externa' : 'interna') : br ? `${p.pagina}` : p.pagina}</text>
        <path d="M ${-pw * 0.08} ${-ph / 2 + ph * 0.1} L 0 ${-ph / 2 + ph * 0.04} L ${pw * 0.08} ${-ph / 2 + ph * 0.1}" class="s-cab"/>
      </g></g>`);
  }
  if (lado === 'A' || f.mesmaChapa) for (const mk of f.marcasA) {
    if (mk.tipo === 'colacao') parts.push(`<rect x="${mk.x1}" y="${mk.y1}" width="${mk.x2 - mk.x1}" height="${mk.y2 - mk.y1}" class="s-col"/>`);
    else parts.push(`<line x1="${mk.x1}" y1="${mk.y1}" x2="${mk.x2}" y2="${mk.y2}" class="s-mk ${mk.tipo}"/>`);
  }
  return `<svg viewBox="-4 -4 ${W + 8} ${H + 8}" class="folha-svg" role="img" aria-label="Folha ${W} por ${H} mm, lado ${lado}">${parts.join('')}</svg>`;
}

function vImposicao(m: HTMLElement) {
  const r = S.r;
  const todas = [...r.formas, ...r.formasCapa];
  const f = todas.find((x) => x.id === S.forma) ?? todas[0];
  const capa = !!f && r.formasCapa.includes(f);
  const lado = f?.mesmaChapa ? 'A' : S.lado;
  const info = (k: string, v: string) => `<div class="info"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  m.innerHTML = `
  <header class="sec"><h1>Imposição</h1><p>Como as páginas são posicionadas na folha que entra na máquina. As páginas de cabeça para baixo e fora de ordem são intencionais: depois de impressa, a folha é dobrada e refilada, e as páginas ficam na ordem de leitura. Para entender os pares, veja <a href="#leitura" id="ir-pares">Leitura → Como as folhas se juntam</a>.</p></header>
  ${f ? `<section class="painel">
    <div class="barra">
      <div class="segmentos" role="tablist">${todas.map((x) => `<button role="tab" class="seg${x.id === f.id ? ' on' : ''}" data-forma="${esc(x.id)}" aria-selected="${x.id === f.id}">${esc(x.id)}<small>${r.formasCapa.includes(x) ? 'capa' : `${x.unidades.length > 1 ? 'cadernos' : 'caderno'} ${x.unidades.map((u) => u + 1).join(',')}`}</small></button>`).join('')}</div>
      ${f.mesmaChapa ? `<span class="chip">Chapa única · ${f.modo === 'virada_lateral' ? 'virada lateral' : 'virada pela pinça'}</span>` : `<div class="segmentos">${(['A', 'B'] as const).map((l) => `<button class="seg${lado === l ? ' on' : ''}" data-lado="${l}">Lado ${l}<small>${l === 'A' ? 'frente da folha' : `verso (virada ${f.viradaVerso === 'lateral' ? 'lateral' : 'pela pinça'})`}</small></button>`).join('')}</div>`}
    </div>
    <div class="folha-wrap">${svgForma(f, lado, capa)}</div>
    <ul class="legenda">
      <li><i class="lg corte"></i>Página (corte final)</li><li><i class="lg sang"></i>Sangria</li><li><i class="lg pinca"></i>Pinça (área sem impressão)</li>
      <li><i class="lg cab"></i>Seta = cabeça (topo) da página</li><li><i class="lg br"></i>Página em branco</li><li><i class="lg mk"></i>Marcas de corte e dobra</li>
    </ul>
    <div class="infos">
      ${info('Folha', `<span class="mono">${f.folha.largura} × ${f.folha.altura} mm</span>`)}
      ${info('Modo', esc(f.modo.replace('_', ' ')))}
      ${info('Posições', `<span class="mono">${f.posicoes.length} · forma ${f.rotacaoForma}°</span>`)}
      ${info('Cópias por folha', `<span class="mono">${Object.values(f.copiasPorFolha)[0] ?? 0}</span>`)}
      ${info('Lombada na folha', esc(f.lombadaNaFolha))}
      ${info('Conteúdo', capa ? 'capa' : f.unidades.map((u) => `caderno ${u + 1}`).join(', '))}
    </div>
  </section>` : `<section class="painel alerta-painel ${r.unidades.length ? 'warn' : 'err'}"><h2>Sem folha de impressão</h2><p>${r.unidades.length ? 'A imposição lógica dos cadernos está pronta, mas falta o formato da folha ou a forma não cabe nela.' : 'Resolva a paginação para gerar a imposição.'}</p><p><a href="#${r.unidades.length ? 'grafica' : 'paginacao'}">${r.unidades.length ? 'Abrir configuração da gráfica' : 'Abrir paginação'}</a></p></section>`}
  ${r.unidades.length && r.unidades[0]!.layout.esquema.folds.length ? `<section class="painel"><h2>Cadernos antes de ir para a folha</h2><p class="nota">Cada caderno desdobrado: frente e verso (verso visto com a folha virada para o lado). Derivado por simulação da dobra e conferido por um verificador físico independente.</p>
    <div class="cadernos">${r.unidades.slice(0, 6).map((u) => cadernoLogico(u)).join('')}</div>${r.unidades.length > 6 ? `<p class="nota">Mostrando 6 de ${r.unidades.length} cadernos.</p>` : ''}</section>` : ''}`;
  m.querySelectorAll<HTMLButtonElement>('[data-forma]').forEach((b) => b.addEventListener('click', () => { S.forma = b.dataset.forma!; render(); }));
  m.querySelectorAll<HTMLButtonElement>('[data-lado]').forEach((b) => b.addEventListener('click', () => { S.lado = b.dataset.lado as 'A' | 'B'; render(); }));
  on('ir-pares', 'click', () => { S.modoLeitura = 'pares'; });
  m.querySelectorAll<SVGGElement>('[data-pg]').forEach((g) => g.addEventListener('click', () => {
    const pg = Number(g.dataset.pg);
    if (pg) { irParaPagina(pg); S.modoLeitura = 'leitor'; location.hash = 'leitura'; }
  }));
}

function cadernoLogico(u: ResultadoMotor['unidades'][number]) {
  const l = u.layout;
  const grade = (face: 'frente' | 'verso') => {
    const cells = [...l.celulas].sort((a, b) => a[face].row - b[face].row || a[face].col - b[face].col);
    return `<div class="grade" style="grid-template-columns:repeat(${l.cols},1fr)">${cells.map((c) => {
      const fp = c[face];
      const g = u.mapa[fp.pagina - 1]!;
      const br = origemDaPagina(g) === null;
      return `<span class="cel${br ? ' br' : ''}${g === S.pagina ? ' sel' : ''}"><b style="transform:rotate(${fp.rotacao}deg)">${g}</b></span>`;
    }).join('')}</div>`;
  };
  return `<figure class="cad"><figcaption class="mono">Caderno ${u.indice + 1} · ${u.tamanho} pp · ${esc(l.esquema.id)}</figcaption>
    <div class="faces"><div><span class="k">Frente</span>${grade('frente')}</div><div><span class="k">Verso</span>${grade('verso')}</div></div></figure>`;
}

// ==========================================================================================
// Vista: Capa

function vCapa(m: HTMLElement) {
  const r = S.r;
  const pl = r.capa.planificacao;
  const sang = pl?.sangria ?? 0;
  const pos = r.editorial.posicao;
  const cod = r.editorial.codigo;
  const svg = pl ? (() => {
    const W = pl.largura, H = pl.altura, s = sang;
    const parts = [`<rect x="${-s}" y="${-s}" width="${W + 2 * s}" height="${H + 2 * s}" class="s-sang"/>`];
    for (const p of pl.paineis) {
      parts.push(`<rect x="${p.x}" y="0" width="${p.largura}" height="${H}" class="pn pn-${p.tipo}"/>`);
      parts.push(`<text x="${p.x + p.largura / 2}" y="${H / 2}" class="pn-t" style="font-size:${Math.max(4, Math.min(12, p.largura / 6))}px">${esc(p.nome)}</text>`);
      parts.push(`<text x="${p.x + p.largura / 2}" y="${H / 2 + Math.max(5, Math.min(14, p.largura / 5))}" class="pn-d" style="font-size:${Math.max(3.5, Math.min(9, p.largura / 7))}px">${n2(p.largura)} mm</text>`);
    }
    for (const l of pl.linhas) {
      if (l.x !== undefined) parts.push(`<line x1="${l.x}" y1="${-s - 6}" x2="${l.x}" y2="${H + s + 6}" class="ln ln-${l.tipo}"/>`);
      if (l.y !== undefined) parts.push(`<line x1="${-s - 6}" y1="${l.y}" x2="${W + s + 6}" y2="${l.y}" class="ln ln-${l.tipo}"/>`);
    }
    if (cod && pos?.alvo === 'planificacao') parts.push(`<g transform="translate(${pos.x} ${pos.y})" class="cod-capa"><rect width="${cod.largura}" height="${cod.altura}" class="cod-fundo"/>${cod.barras.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`).join('')}</g>`);
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" class="corte"/>`);
    return `<svg viewBox="${-s - 10} ${-s - 10} ${W + 2 * s + 20} ${H + 2 * s + 20}" class="capa-svg" role="img" aria-label="Capa planificada">${parts.join('')}</svg>`;
  })() : '';
  const cd = r.capa.capaDura;
  m.innerHTML = `
  <header class="sec"><h1>Capa</h1><p>Planificação calculada a partir do miolo, do papel e dos parâmetros de acabamento. Valores pendentes não são inventados.</p></header>
  ${pl ? `<section class="painel">
    <h2>${esc(pl.componente)} <span class="badge o-${pl.status === 'pendente' ? 'ausente' : pl.status === 'estimado' ? 'referencia' : 'calculado'}">${pl.status}</span></h2>
    <div class="folha-wrap">${svg}</div>
    <div class="infos">
      <div class="info"><span class="k">Aberta</span><span class="v mono">${n2(pl.largura)} × ${n2(pl.altura)} mm</span></div>
      <div class="info"><span class="k">Sangria</span><span class="v mono">${n2(sang)} mm</span></div>
      <div class="info"><span class="k">Lombada</span><span class="v mono">${r.fisica.lombada ? (r.fisica.lombada.valor === null ? 'pendente' : `${n2(r.fisica.lombada.valor)} mm`) : 'não se aplica'}</span></div>
      ${cod && pos ? `<div class="info"><span class="k">Código de barras</span><span class="v mono">${n2(cod.largura, 1)} × ${n2(cod.altura, 1)} mm na 4ª capa</span></div>` : ''}
    </div>
    <ul class="premissas">${pl.premissas.map((x) => `<li class="mono">${esc(x)}</li>`).join('')}</ul>
    ${pl.pendencias.length ? `<div class="alerta warn">Pendências: ${pl.pendencias.map(esc).join(', ')}</div>` : ''}
    <div class="acoes"><button id="c-pdf" class="btn">Baixar capa planificada (PDF)</button></div>
  </section>` : `<section class="painel"><p class="vazio">${S.entrada.capa.modelo === 'autocapa' ? `Autocapa: a capa faz parte do caderno externo (páginas 1, 2 e as duas últimas).${cod && pos ? ` O código de barras vai na página ${pos.pagina} (4ª capa).` : ''}` : r.capa.folhasDeCapa ? 'Folhas de capa: duas folhas no formato do miolo (1ª/2ª e 3ª/4ª), impressas à parte.' : 'Sem capa planificada para este modelo.'}</p></section>`}
  ${cd ? `<section class="painel"><h2>Capa dura: componentes</h2><div class="infos">
    <div class="info"><span class="k">Papelão</span><span class="v mono">${n2(cd.papelao.largura.valor)} × ${n2(cd.papelao.altura.valor)} mm</span></div>
    <div class="info"><span class="k">Cartão de lombada</span><span class="v mono">${n2(cd.papelao.cartaoLombada.valor)} mm</span></div>
    <div class="info"><span class="k">Lombada externa</span><span class="v mono">${n2(cd.lombadaExterna.valor)} mm</span></div></div></section>` : ''}
  ${r.capa.sobrecapa ? `<section class="painel"><h2>Sobrecapa</h2><p class="mono">${n2(r.capa.sobrecapa.largura)} × ${n2(r.capa.sobrecapa.altura)} mm · ${r.capa.sobrecapa.paineis.map((p) => `${esc(p.nome)} ${n2(p.largura)}`).join(' | ')}</p></section>` : ''}`;
  on('c-pdf', 'click', () => void baixarCapa());
}

async function baixarCapa() {
  const pl = S.r.capa.planificacao;
  if (!pl) return;
  try {
    const capa = S.r.componentes.capa;
    const ref = (papel: string) => capa?.find((p) => p.papel === papel && p.origem && p.tipo !== 'branco')?.origem;
    const faces = S.pdf && capa ? { origemBytes: S.pdf.bytes, externa: { primeira: ref('1a_capa'), quarta: ref('4a_capa') }, interna: { segunda: ref('2a_capa'), terceira: ref('3a_capa') } } : undefined;
    const pos = S.r.editorial.posicao;
    const codigo = ed().codigoBarras.aplicarNaCapa && S.r.editorial.codigo && pos?.alvo === 'planificacao' ? { geometria: S.r.editorial.codigo, x: pos.x, y: pos.y } : undefined;
    const bytes = await gerarPdfCapa(pl, S.entrada, S.r, faces, codigo);
    await oferecerArquivo(`${slug()}-capa-planificada.pdf`, bytes);
  } catch (e) { toast((e as Error).message, 'err'); }
}

const slug = () => S.entrada.projeto.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projeto';

// ==========================================================================================
// Vista: Validação e arquivos

function vSaida(m: HTMLElement) {
  const r = S.r;
  const grupos = ['erro', 'pendencia', 'aviso', 'nao_verificavel', 'info'] as const;
  const cons = (c: typeof r.consumo.miolo, nome: string) => c ? `<h3>${nome} <span class="badge o-${c.status === 'calculado' ? 'calculado' : c.status === 'pendente' ? 'ausente' : 'referencia'}">${c.status}</span></h3>
    <div class="tabela-wrap"><table><thead><tr><th>Forma</th><th class="num">Cópias/folha</th><th class="num">Líquidas</th><th class="num">Brutas</th><th class="num">Peso (kg)</th><th class="num">Chapas</th></tr></thead><tbody>
    ${c.linhas.map((l) => `<tr><td class="mono">${esc(l.forma)}</td><td class="num mono">${l.copiasPorFolha}</td><td class="num mono">${l.folhasLiquidas.toLocaleString('pt-BR')}</td><td class="num mono">${l.folhasBrutas.toLocaleString('pt-BR')}</td><td class="num mono">${n2(l.pesoKg)}</td><td class="num mono">${l.chapas}</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td></td><td></td><td class="num mono">${c.totalFolhas.toLocaleString('pt-BR')}</td><td class="num mono">${n2(c.totalPesoKg)}</td><td class="num mono">${c.totalChapas}</td></tr></tbody></table></div>
    <p class="nota">${c.premissas.map(esc).join(' ')} Estimativa de consumo, não orçamento.</p>` : '';
  const semPdf = !S.pdf;
  const bloq = r.nivel === 'bloqueado';
  const codPos = r.editorial.posicao;
  m.innerHTML = `
  <header class="sec"><h1>Validação e arquivos</h1><p>O status depende da origem de cada parâmetro crítico e das verificações. A validação da plataforma não substitui a aprovação da gráfica.</p></header>
  <section class="painel nivel-painel n-${NIVEL_CLASSE[r.nivel]}">
    <span class="pill ${NIVEL_CLASSE[r.nivel]}">${NIVEL_CURTO[r.nivel]}</span>
    <p>${esc(r.rotuloNivel)}</p>
    <p class="mono meta">motor ${r.versaoMotor} · ${r.versaoRegra} · hash ${r.hashEntrada.slice(0, 16)}…</p>
  </section>
  <section class="painel"><h2>Arquivos para a gráfica</h2>
    <div class="arquivos">
      <div class="arq-item destaque"><div><strong>Miolo em ordem de leitura (PDF)</strong><p class="nota">Uma página por página do livro, com sangria, marcas de corte e brancos aprovados. É o arquivo que a maioria das gráficas pede: elas fazem a imposição no próprio sistema.</p></div><button id="x-ordem" class="btn" ${semPdf || !r.plano.escolhido ? 'disabled' : ''}>Baixar</button></div>
      <div class="arq-item"><div><strong>Capa planificada (PDF)</strong><p class="nota">Capa aberta com lombada, vincos e dobras calculados.</p></div><button id="x-capa" class="btn sec" ${!r.capa.planificacao ? 'disabled' : ''}>Baixar</button></div>
      <div class="arq-item"><div><strong>Miolo imposto (PDF)</strong><p class="nota">Folhas da máquina já montadas. Útil para impressão digital, gráficas sem imposição própria e conferência.</p></div><button id="x-pdf" class="btn sec" ${semPdf || !r.formas.length ? 'disabled' : ''}>Baixar</button></div>
      <div class="arq-item"><div><strong>Código de barras (PDF e SVG)</strong><p class="nota">${r.editorial.codigo ? `${esc(r.editorial.rotulo)} · ${n2(r.editorial.codigo.largura, 1)} × ${n2(r.editorial.codigo.altura, 1)} mm` : 'Informe um ISBN/ISSN/ISMN válido em Projeto.'}</p></div><span class="acoes"><button id="x-cod" class="btn sec" ${!r.editorial.codigo ? 'disabled' : ''}>PDF</button><button id="x-codsvg" class="btn sec" ${!r.editorial.codigo ? 'disabled' : ''}>SVG</button></span></div>
    </div>
    ${semPdf ? '<p class="nota">Para gerar os PDFs do miolo, carregue o PDF do livro (ou o de exemplo) em Projeto.</p>' : ''}
    ${!bloq && r.nivel !== 'validado_parametros' ? '<p class="nota">Os arquivos saem com a marcação "padrão de mercado: confirmar parâmetros com a gráfica" fora da área de corte.</p>' : ''}
    ${bloq ? '<p class="nota">Há erros ou pendências: os PDFs saem marcados como prévia bloqueada para produção.</p>' : ''}
    <h3>Documentação</h3>
    <div class="acoes">
      <button id="x-ficha" class="btn sec">Ficha técnica (TXT)</button>
      <button id="x-csv" class="btn sec">Mapa de imposição (CSV)</button>
      <button id="x-json" class="btn sec">Resultado do motor (JSON)</button>
      <button id="x-proj" class="btn sec">Salvar projeto (JSON)</button>
      <label class="btn sec"><input id="x-abrir" type="file" accept=".json,application/json" hidden>Abrir projeto</label>
    </div>
  </section>
  <section class="painel"><h2>Constatações</h2>
    ${grupos.map((g) => {
      const l = r.constatacoes.filter((c) => c.severidade === g);
      if (!l.length) return '';
      return `<div class="sev-grupo"><h3 class="sev s-${g}">${SEV_ROT[g]} <span class="mono">${l.length}</span></h3><ul class="constat">${l.map((c) => `<li class="s-${g}"><span class="cod mono">${esc(c.codigo)}</span><div><p>${esc(c.mensagem)}</p>${c.evidencia ? `<p class="ev mono">${esc(c.evidencia)}</p>` : ''}${c.opcoes?.length ? `<ul class="op">${c.opcoes.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}</div></li>`).join('')}</ul></div>`;
    }).join('')}
  </section>
  <section class="painel grid2">
    <div class="grupo"><h2>Física</h2><div class="infos col">
      <div class="info"><span class="k">Espessura do papel do miolo</span><span class="v mono">${r.fisica.calibreMiolo.valor === null ? 'pendente' : `${n2(r.fisica.calibreMiolo.valor * 1000, 1)} µm`} ${badge(r.fisica.calibreMiolo.origem)}</span></div>
      <div class="info"><span class="k">Espessura do bloco</span><span class="v mono">${r.fisica.espessuraBloco.valor === null ? 'pendente' : `${n2(r.fisica.espessuraBloco.valor)} mm`}</span></div>
      <div class="info"><span class="k">Lombada</span><span class="v mono">${r.fisica.lombada ? (r.fisica.lombada.valor === null ? 'pendente' : `${n2(r.fisica.lombada.valor)} mm`) : 'não se aplica'}</span></div>
      <div class="info"><span class="k">Creep máximo</span><span class="v mono">${n2(r.fisica.creepMaximo, 3)} mm</span></div></div></div>
    <div class="grupo"><h2>Histórico do projeto</h2>
      ${S.eventos.length ? `<ol class="eventos">${S.eventos.slice(0, 12).map((ev) => `<li><span class="mono">${esc(ev.data.slice(0, 16).replace('T', ' '))}</span> ${esc(ev.texto)} <span class="ajuda">${esc(ev.autor)}</span></li>`).join('')}</ol>` : '<p class="vazio">Sem alterações registradas.</p>'}</div>
  </section>
  <section class="painel"><h2>Consumo estimado</h2>${cons(r.consumo.miolo, 'Miolo')}${cons(r.consumo.capa, 'Capa')}${!r.consumo.miolo ? '<p class="vazio">Sem formas de impressão, o consumo não é calculado.</p>' : ''}</section>`;

  const gerar = async (id: string, nome: () => string, fn: () => Promise<Uint8Array>, evento: string) => {
    const b = $(`#${id}`) as HTMLButtonElement;
    const t = b.textContent; b.disabled = true; b.textContent = 'Gerando…';
    try { const bytes = await fn(); registrar(evento); salvarLocal(); await oferecerArquivo(nome(), bytes); } catch (e) { toast((e as Error).message, 'err'); }
    b.disabled = false; b.textContent = t;
  };
  const sang = Number(S.r.parametros.find((p) => p.chave === 'arquivo.sangria')?.valor ?? 3);
  on('x-ordem', 'click', () => gerar('x-ordem', () => `${slug()}-v${S.entrada.projeto.versao}-miolo-ordem-leitura.pdf`,
    () => gerarPdfOrdemLeitura(S.pdf!.bytes, S.entrada, S.r, { marcas: true, sangria: sang, codigo: ed().codigoBarras.aplicarNaCapa && codPos?.alvo === 'pagina_miolo' && S.r.editorial.codigo ? { geometria: S.r.editorial.codigo, pagina: codPos.pagina!, x: codPos.x, y: codPos.y } : undefined }),
    `PDF em ordem de leitura gerado (${S.r.nivel})`));
  on('x-capa', 'click', () => void baixarCapa());
  on('x-pdf', 'click', () => gerar('x-pdf', () => `${slug()}-v${S.entrada.projeto.versao}-miolo-imposto.pdf`, () => gerarPdfImposto(S.pdf!.bytes, S.entrada, S.r, { rotularBrancos: S.r.nivel !== 'validado_parametros' }), `PDF imposto gerado (${S.r.nivel})`));
  on('x-cod', 'click', () => gerar('x-cod', () => `codigo-barras-${S.r.editorial.identificador!.ean13}.pdf`, () => gerarPdfCodigo(S.r.editorial.codigo!, S.r.editorial.rotulo), 'Código de barras exportado'));
  on('x-codsvg', 'click', () => oferecerArquivo(`codigo-barras-${S.r.editorial.identificador!.ean13}.svg`, svgCodigo(S.r.editorial.codigo!)));
  on('x-ficha', 'click', () => oferecerArquivo(`${slug()}-ficha-tecnica.txt`, fichaTecnica(S.entrada, S.r)));
  on('x-csv', 'click', () => oferecerArquivo(`${slug()}-mapa-imposicao.csv`, mapaCsv(S.r)));
  on('x-json', 'click', () => oferecerArquivo(`${slug()}-resultado.json`, JSON.stringify(S.r, null, 2)));
  on('x-proj', 'click', () => oferecerArquivo(`${slug()}-projeto-v${S.entrada.projeto.versao}.json`, JSON.stringify({ formato: 'plataforma-editorial/projeto@1', entrada: S.entrada, eventos: S.eventos }, null, 2)));
  on('x-abrir', 'change', async (el) => {
    const f = el.files?.[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.formato !== 'plataforma-editorial/projeto@1' || !d.entrada) throw new Error('Arquivo não é um projeto desta plataforma.');
      S.entrada = d.entrada; S.entrada.editorial ??= structuredClone(EDITORIAL_PADRAO);
      S.eventos = d.eventos ?? []; S.pdf = null; await abrirPdfjs(new Uint8Array());
      registrar(`Projeto aberto: ${f.name}`); recalcular(); render();
      toast('Projeto aberto. Carregue novamente o PDF do livro para gerar os arquivos.');
    } catch (e) { toast((e as Error).message, 'err'); }
  });
}

// ==========================================================================================
// Início

function iniciar() {
  $('#nav').innerHTML = ROTAS.map(([k, t]) => `<a href="#${k}" data-r="${k}">${t}</a>`).join('');
  recalcular();
  render();
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });
  document.addEventListener('keydown', (ev) => {
    if (rotaAtual() !== 'leitura' || S.modoLeitura !== 'leitor' || (ev.target as HTMLElement).closest('input,select,textarea')) return;
    const rtl = S.entrada.direcao === 'rtl';
    if (ev.key === 'ArrowRight') { ev.preventDefault(); navegar(rtl ? -1 : 1); }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); navegar(rtl ? 1 : -1); }
  });
}

iniciar();
