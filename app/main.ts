/**
 * Plataforma de Produção Editorial e Gráfica — interface.
 * A interface só edita a ENTRADA do motor; todo cálculo vem de executarMotor (RN-014).
 * Entregáveis são sempre PDF (nada de JSON/CSV para pessoas).
 */

import { MODELOS, type ModeloCapa, type ModeloId, type Montagem } from '../src/binding/models.js';
import { inserirBrancos, registrarPaginas, removerPagina, type PaginaRegistro, type PosicaoBranco } from '../src/binding/pagination.js';
import type { ParImpressao } from '../src/binding/pares.js';
import type { AjusteProjeto, ValorParam } from '../src/config/profile.js';
import { FOLHAS_REFERENCIA, PAPEIS_REFERENCIA, SELECAO_REFERENCIA } from '../src/config/referencia.js';
import { REGISTRO, REGISTRO_POR_CHAVE, aplicavel } from '../src/config/registry.js';
import type { Material } from '../src/cover/physics.js';
import { EDITORIAL_PADRAO, type DadosEditoriais } from '../src/editorial/normas.js';
import { executarMotor, type EntradaProjeto, type ResultadoMotor } from '../src/engine.js';
import { pdfAmostra } from '../src/pdf/amostra.js';
import { gerarPdfCapa, gerarPdfImposto, gerarPdfLadoALado, gerarPdfOrdemLeitura, gerarPdfTexto, inspecionarPdf, type RefOrigem } from '../src/pdf/impose.js';
import type { Forma } from '../src/press/layout.js';
import { especificacoes, perguntasGrafica } from '../src/report/documentos.js';
import type { Constatacao } from '../src/validate/verify.js';

// ==========================================================================================
// Estado

type Dim = Awaited<ReturnType<typeof inspecionarPdf>>['dimensoes'][number];
type ModoImport = 'simples' | 'duplas' | 'livreto';
interface Analise { tipo: ModoImport | 'formato_diferente'; nDuplas: number; w0: number; h0: number }
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
  modoMontagem: 'folha' | 'capa';
  eventos: Array<{ data: string; autor: string; texto: string }>;
  r: ResultadoMotor;
}

const agora = () => new Date().toISOString();
const ARQ = 'livro.pdf';
const CHAVE_LOCAL = 'pepg.projeto.v4';

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
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify({ entrada: S.entrada, autor: S.autor, eventos: S.eventos })); } catch { /* sem armazenamento */ }
}

const salvo = carregarLocal();
const S: Estado = {
  entrada: salvo?.entrada ?? entradaInicial(),
  pdf: null,
  autor: salvo?.autor ?? '',
  pagina: null, forma: null, lado: 'A', vista: 0, modoLeitura: 'leitor', modoMontagem: 'folha',
  eventos: salvo?.eventos ?? [],
  r: null as unknown as ResultadoMotor,
};
const ed = (): DadosEditoriais => {
  const e = S.entrada.editorial as DadosEditoriais | undefined;
  if (!e || typeof e.temIsbn !== 'boolean' || !e.paginas) S.entrada.editorial = structuredClone(EDITORIAL_PADRAO);
  return S.entrada.editorial!;
};
ed();

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
  const y = window.scrollY;
  fn(S.entrada);
  if (novaVersao) S.entrada.projeto.versao += 1;
  if (evento) registrar(evento);
  recalcular();
  render();
  window.scrollTo({ top: y });
}

// ==========================================================================================
// Utilidades

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n2 = (v: number | null | undefined, c = 1) => (v === null || v === undefined ? '—' : Number(v.toFixed(c)).toLocaleString('pt-BR'));
const reduzMovimento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ORIGEM_ROT: Record<string, string> = { projeto: 'Informado', grafica: 'Gráfica', referencia: 'Padrão de mercado', ausente: 'Falta informar', calculado: 'Calculado' };

let toastTimer = 0;
function toast(msg: string, tipo: 'ok' | 'err' = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.className = 'toast'), 5000);
}
function progresso(msg: string | null) {
  $('#progresso').hidden = !msg;
  if (msg) $('#progresso-txt').textContent = msg;
}

async function oferecerArquivo(nome: string, dados: Uint8Array) {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (claude?.use) {
    try {
      const dl = (await claude.use('downloads')) as { save(r: { filename: string; data: unknown }): Promise<{ status: string }> } | null;
      if (dl) {
        const r = await dl.save({ filename: nome, data: new Blob([dados as BlobPart]) });
        if (r.status === 'saved') toast(`${nome} salvo.`);
        return;
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') { toast('Download cancelado.'); return; }
      if (code && code !== 'unavailable' && code !== 'not_granted') { toast(`Não foi possível salvar: ${(e as Error).message ?? code}`, 'err'); return; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([dados as BlobPart], { type: 'application/pdf' }));
  a.download = nome;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

// ==========================================================================================
// pdf.js (embutido, worker próprio) e miniaturas

interface PdfJsPage { getViewport(o: { scale: number }): { width: number; height: number }; render(o: unknown): { promise: Promise<void> }; cleanup(): void }
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

const thumbs = new Map<string, string>();
const fila: string[] = [];
let processando = false;
const chaveDe = (o: RefOrigem | null | undefined) => (o ? `${o.indice}|${o.recorte ?? ''}` : '');

async function abrirPdfjs(bytes: Uint8Array | null) {
  for (const u of thumbs.values()) if (u.startsWith('blob:')) URL.revokeObjectURL(u);
  thumbs.clear(); fila.length = 0;
  if (pdfjsDoc) { try { await pdfjsDoc.destroy(); } catch { /* ignora */ } }
  pdfjsDoc = null;
  const lib = pdfjs();
  if (!lib || !bytes || !bytes.length) return;
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
    try {
      const p = await pdfjsDoc.getPage(Number(idxTxt) + 1);
      const vp0 = p.getViewport({ scale: 1 });
      const scale = Math.min((rec ? 1200 : 640) / vp0.width, 900 / vp0.height);
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
      document.querySelectorAll<HTMLElement>(`[data-th="${CSS.escape(k)}"]`).forEach((el) => {
        if (el instanceof HTMLImageElement) { el.src = url; el.classList.add('ok'); } else el.setAttribute('href', url);
      });
    } catch { thumbs.set(k, 'erro'); }
    await new Promise((r) => setTimeout(r, 0));
  }
  processando = false;
}
const urlThumb = (o: RefOrigem | null | undefined) => { const u = thumbs.get(chaveDe(o)); return u && u.startsWith('blob:') ? u : ''; };
const imgThumb = (o: RefOrigem | null | undefined, prioridade = false) => {
  if (!o) return '';
  pedirThumb(o, prioridade);
  const url = urlThumb(o);
  return `<img data-th="${esc(chaveDe(o))}" alt=""${url ? ` src="${url}" class="ok"` : ''}>`;
};
function origemDaPagina(pg: number): RefOrigem | null {
  const reg = S.r.componentes.miolo[pg - 1];
  return reg && reg.tipo !== 'branco' && reg.origem ? reg.origem : null;
}

// ==========================================================================================
// Etapas

const ETAPAS = [
  ['livro', 'Livro', 'Formato e arquivo'],
  ['paginas', 'Páginas', 'Ordem, brancos e regras'],
  ['conferir', 'Conferir', 'Folhear o livro'],
  ['montagem', 'Montagem', 'Folha e capa'],
  ['grafica', 'Gráfica', 'O que ela informou'],
  ['entregar', 'Entregar', 'Baixar os PDFs'],
] as const;
type Etapa = (typeof ETAPAS)[number][0];
const etapaAtual = (): Etapa => (ETAPAS.find(([k]) => k === location.hash.replace('#', ''))?.[0] ?? 'livro') as Etapa;

const problemas = () => S.r.constatacoes.filter((c) => c.severidade === 'erro' || c.severidade === 'pendencia');
function estadoEtapa(k: Etapa): '' | 'feito' | 'atencao' {
  const r = S.r;
  if (k === 'livro') return S.pdf ? 'feito' : '';
  if (k === 'paginas') return r.constatacoes.some((c) => (c.codigo.startsWith('PAG') || c.codigo.startsWith('EDI')) && c.severidade === 'erro') ? 'atencao' : r.plano.escolhido ? 'feito' : 'atencao';
  if (k === 'grafica') return r.nivel === 'validado_parametros' ? 'feito' : '';
  if (k === 'entregar') return problemas().length ? 'atencao' : '';
  return '';
}

function renderStatus() {
  const r = S.r;
  const p = problemas().length;
  const [cls, txt] = p ? ['err', `Falta resolver ${p} ${p > 1 ? 'itens' : 'item'}`] : r.nivel === 'padrao_mercado' ? ['warn', 'Pronto · confirmar com a gráfica'] : ['ok', 'Pronto para enviar'];
  $('#status').innerHTML = `
    <div class="st-proj"><strong>${esc(S.entrada.projeto.nome)}</strong><span>${esc(MODELOS[S.entrada.modelo].nome)} · ${S.entrada.formato.largura} × ${S.entrada.formato.altura} mm · ${r.componentes.miolo.length} páginas</span></div>
    <a class="pill ${cls}" href="#entregar">${txt}</a>`;
  $('#nav').innerHTML = ETAPAS.map(([k, t, d], i) => `<a href="#${k}" data-r="${k}" class="${estadoEtapa(k)}" aria-current="${etapaAtual() === k ? 'page' : 'false'}"><span class="n">${i + 1}</span><span class="t">${t}</span><span class="d">${d}</span></a>`).join('');
}

function render() {
  renderStatus();
  const main = $('#main');
  main.innerHTML = '';
  ({ livro: vLivro, paginas: vPaginas, conferir: vConferir, montagem: vMontagem, grafica: vGrafica, entregar: vEntregar } as Record<Etapa, (m: HTMLElement) => void>)[etapaAtual()](main);
}

function cabecalho(titulo: string, serve: string, passos: string[]) {
  return `<header class="etapa"><h1>${titulo}</h1><p>${serve}</p>${passos.length ? `<ol class="como">${passos.map((p) => `<li>${p}</li>`).join('')}</ol>` : ''}</header>`;
}

// ==========================================================================================
// Componentes de formulário

function campo(label: string, input: string, ajuda = '', largo = false) {
  return `<label class="campo${largo ? ' largo' : ''}"><span class="rot">${esc(label)}</span>${input}${ajuda ? `<span class="ajuda">${ajuda}</span>` : ''}</label>`;
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

const ROT_CAPA: Record<ModeloCapa, string> = {
  autocapa: 'No mesmo papel do miolo (autocapa)', separada_flexivel: 'Separada, flexível (papel mais grosso)', capa_dura: 'Capa dura', folhas_de_capa: 'Folhas de capa (wire-o, espiral)', sem_capa: 'Sem capa',
};
const DESC_MODELO: Partial<Record<ModeloId, string>> = {
  grampo_canoa: 'Folhas dobradas ao meio, uma dentro da outra, presas por grampos na dobra. Ideal para livros finos e revistas.',
  brochura_hotmelt: 'Lombada quadrada colada (hotmelt). Comum em livros de bolso e apostilas.',
  brochura_pur: 'Lombada quadrada com cola PUR: mais resistente e abre melhor.',
  brochura_costurada: 'Cadernos costurados e colados na capa: durável, abre bem.',
  capa_dura_costurada: 'Miolo costurado, capa rígida de papelão revestido.',
  capa_dura_colada: 'Miolo colado, capa rígida de papelão revestido.',
  wire_o: 'Folhas soltas presas por espiral metálica dupla; abre 360°.',
  espiral: 'Folhas soltas presas por espiral plástica.',
  garra_plastica: 'Folhas soltas presas por garra plástica.',
  grampo_lateral: 'Folhas grampeadas na lateral.',
  cartonado: 'Páginas de cartão grosso (livro para bebês).',
  sanfona: 'Tira contínua dobrada em zigue-zague.',
  folhas_soltas: 'Páginas soltas, sem encadernação.',
};
const CORES: Array<[string, string]> = [['4x4', 'Colorido dos dois lados (4×4)'], ['4x0', 'Colorido só na frente (4×0)'], ['1x1', 'Preto dos dois lados (1×1)'], ['1x0', 'Preto só na frente (1×0)']];

function opcoesPapel(): Array<[string, Array<[string, string]>]> {
  const p = S.entrada.perfil;
  return [
    ['Papéis da gráfica', (p?.papeis ?? []).map((x): [string, string] => [x.id, `${x.nome}${x.calibreUm ? ` · ${x.calibreUm} µm` : ''}`])],
    ['Papéis comuns (espessura típica)', PAPEIS_REFERENCIA.map((x): [string, string] => [x.id, x.nome])],
  ];
}

// ==========================================================================================
// Importação do PDF

function analisar(dims: Dim[], W: number, H: number): Analise {
  const perto = (a: number, b: number, t: number) => Math.abs(a - b) <= t;
  let nS = 0, nD = 0;
  for (const d of dims) {
    if (perto(d.alturaMm, H, 1.5) && perto(d.larguraMm, W, 1.5)) nS++;
    else if (perto(d.alturaMm, H, 1.5) && perto(d.larguraMm, 2 * W, 3)) nD++;
  }
  const cont = new Map<string, number>();
  for (const d of dims) { const k = `${Math.round(d.larguraMm)}x${Math.round(d.alturaMm)}`; cont.set(k, (cont.get(k) ?? 0) + 1); }
  const [dom] = [...cont.entries()].sort((a, b) => b[1] - a[1]);
  const [w0, h0] = (dom?.[0] ?? '0x0').split('x').map(Number) as [number, number];
  const tipo: Analise['tipo'] = nS + nD < dims.length * 0.8 ? 'formato_diferente' : nD > 0 ? 'duplas' : 'simples';
  return { tipo, nDuplas: nD, w0, h0 };
}

function construirPaginas(pdf: PdfCarregado, modo: ModoImport): PaginaRegistro[] {
  const W = S.entrada.formato.largura;
  const rtl = S.entrada.direcao === 'rtl';
  const reg = (indice: number, recorte?: 'esquerda' | 'direita'): PaginaRegistro => ({
    id: `${ARQ}#${indice + 1}${recorte ? recorte[0] : ''}`, tipo: 'conteudo', papel: 'miolo',
    origem: { arquivo: ARQ, indice, ...(recorte ? { recorte } : {}) },
    rotulo: `Página ${indice + 1} do arquivo${recorte ? (recorte === 'esquerda' ? ', metade esquerda' : ', metade direita') : ''}`,
  });
  const [l1, l2] = rtl ? (['direita', 'esquerda'] as const) : (['esquerda', 'direita'] as const);
  if (modo === 'simples') return pdf.dims.map((d) => reg(d.indice));
  if (modo === 'duplas') return pdf.dims.flatMap((d) => (Math.abs(d.larguraMm - 2 * W) <= 3 ? [reg(d.indice, l1), reg(d.indice, l2)] : [reg(d.indice)]));
  const N = pdf.dims.length * 2;
  const leitura: PaginaRegistro[] = new Array(N);
  pdf.dims.forEach((d, k) => {
    const j = Math.floor(k / 2);
    const [esq, dir] = k % 2 === 0 ? [N - 2 * j, 1 + 2 * j] : [2 + 2 * j, N - 1 - 2 * j];
    leitura[esq - 1] = reg(d.indice, l1);
    leitura[dir - 1] = reg(d.indice, l2);
  });
  return leitura;
}

async function carregarPdf(nome: string, bytes: Uint8Array) {
  progresso(`Lendo ${nome}…`);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const insp = await inspecionarPdf(bytes);
    progresso(`Preparando a visualização (${insp.paginas} páginas)…`);
    await abrirPdfjs(bytes);
    const analise = analisar(insp.dimensoes, S.entrada.formato.largura, S.entrada.formato.altura);
    S.pdf = { nome, bytes, paginas: insp.paginas, dims: insp.dimensoes, analise, modo: analise.tipo === 'duplas' ? 'duplas' : 'simples' };
    aplicarImportacao(S.pdf.modo, true);
    toast(`${nome}: ${insp.paginas} páginas lidas${analise.nDuplas ? `, ${analise.nDuplas} duplas divididas ao meio` : ''}.`);
  } catch (e) {
    toast(`Não foi possível ler o PDF: ${(e as Error).message}`, 'err');
  } finally { progresso(null); }
}

function aplicarImportacao(modo: ModoImport, novoArquivo: boolean) {
  const pdf = S.pdf!;
  pdf.modo = modo;
  const novas = construirPaginas(pdf, modo);
  const conteudo = S.entrada.paginas.filter((p) => p.tipo === 'conteudo').length;
  const brancos = S.entrada.paginas.length - conteudo;
  const preserva = novoArquivo && conteudo === novas.length && brancos > 0;
  mudar((x) => {
    if (preserva) { let k = 0; x.paginas = x.paginas.map((p) => (p.tipo === 'branco' ? p : novas[k++]!)); } else x.paginas = novas;
    x.dimensoesOrigem = pdf.dims;
  }, `Arquivo ${novoArquivo ? 'carregado' : 'reinterpretado'}: ${pdf.nome}`, true);
}

function ligarArquivo() {
  const zona = document.getElementById('soltar');
  const input = document.getElementById('p-pdf') as HTMLInputElement | null;
  input?.addEventListener('change', async () => { const f = input.files?.[0]; if (f) await carregarPdf(f.name, new Uint8Array(await f.arrayBuffer())); });
  if (zona) {
    zona.addEventListener('dragover', (ev) => { ev.preventDefault(); zona.classList.add('arrastando'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('arrastando'));
    zona.addEventListener('drop', async (ev) => {
      ev.preventDefault(); zona.classList.remove('arrastando');
      const f = ev.dataTransfer?.files[0];
      if (f) await carregarPdf(f.name, new Uint8Array(await f.arrayBuffer()));
    });
  }
  document.querySelectorAll<HTMLInputElement>('input[name="imp"]').forEach((r) => r.addEventListener('change', () => {
    if (r.checked) { aplicarImportacao(r.value as ModoImport, false); toast('Ordem das páginas refeita. Confira em "Conferir".'); }
  }));
  on('imp-fmt', 'click', () => {
    const a = S.pdf!.analise;
    const dupla = a.w0 > a.h0 * 1.25;
    mudar((x) => { x.formato = { largura: dupla ? Math.round(a.w0 / 2) : a.w0, altura: a.h0 }; }, 'Formato ajustado ao arquivo', true);
    S.pdf!.analise = analisar(S.pdf!.dims, S.entrada.formato.largura, S.entrada.formato.altura);
    aplicarImportacao(S.pdf!.analise.tipo === 'duplas' ? 'duplas' : 'simples', false);
  });
  on('p-amostra', 'click', async () => {
    const n = S.entrada.paginas.filter((p) => p.tipo === 'conteudo').length || 30;
    progresso('Gerando PDF de exemplo…');
    await carregarPdf(`exemplo-${n}pp.pdf`, await pdfAmostra(n, S.entrada.formato.largura, S.entrada.formato.altura, 3));
  });
}

function blocoArquivo(): string {
  const p = S.pdf;
  if (!p) {
    return `<label class="soltar" id="soltar"><input id="p-pdf" type="file" accept="application/pdf" hidden>
      <strong>Arraste o PDF do livro aqui ou clique para escolher</strong>
      <span>Um único arquivo com o livro inteiro, na ordem de leitura. Não precisa separar página por página.</span></label>
      <p class="nota">Sem arquivo? <button class="btn link" id="p-amostra" type="button">Use um PDF de exemplo</button> para experimentar.</p>`;
  }
  const a = p.analise;
  const W = S.entrada.formato.largura, H = S.entrada.formato.altura;
  const livro = S.entrada.paginas.filter((x) => x.tipo === 'conteudo').length;
  return `<div class="arquivo-ok"><div><strong>${esc(p.nome)}</strong><span>${p.paginas} páginas no arquivo · ${livro} páginas do livro</span></div>
    <label class="btn sec"><input id="p-pdf" type="file" accept="application/pdf" hidden>Trocar arquivo</label></div>
    ${a.tipo === 'formato_diferente' ? `<div class="faixa warn"><div><strong>O tamanho das páginas não confere</strong><span>O arquivo tem páginas de ${a.w0} × ${a.h0} mm e o projeto está em ${W} × ${H} mm.</span></div><button id="imp-fmt" class="btn">Usar o tamanho do arquivo</button></div>` : ''}
    <fieldset class="opcoes"><legend>Como o arquivo está organizado</legend>
      <label class="opcao"><input type="radio" name="imp" value="simples"${p.modo === 'simples' ? ' checked' : ''}><span>Uma página por vez, em ordem de leitura<small>1, 2, 3, 4… (o mais comum)</small></span></label>
      <label class="opcao"><input type="radio" name="imp" value="duplas"${p.modo === 'duplas' ? ' checked' : ''}><span>Páginas duplas, em ordem de leitura<small>1 · 2|3 · 4|5… cada dupla é dividida ao meio</small></span></label>
      <label class="opcao"><input type="radio" name="imp" value="livreto"${p.modo === 'livreto' ? ' checked' : ''}><span>Livreto já montado para impressão<small>32|1 · 2|31 · 30|3… a plataforma desfaz a montagem</small></span></label>
    </fieldset>`;
}

// ==========================================================================================
// 1. Livro

function vLivro(m: HTMLElement) {
  const e = S.entrada;
  const mod = MODELOS[e.modelo];
  const montagens: Montagem[] = [mod.montagem, ...(mod.montagensAlternativas ?? [])];
  const capaSeparada = e.capa.modelo !== 'autocapa' && e.capa.modelo !== 'sem_capa';
  const corAtual = `${e.cores.mioloFrente}x${e.cores.mioloVerso}`;
  m.innerHTML = `
  ${cabecalho('Livro', 'Diga como é o livro e envie o arquivo. Tudo o que vem depois (páginas, montagem e capa) é calculado a partir daqui.', ['Envie o PDF', 'Escolha a encadernação e o tamanho', 'Escolha o papel'])}
  <section class="cartao"><header><h2>Arquivo do livro</h2></header>${blocoArquivo()}</section>
  <section class="cartao">
    <header><h2>Encadernação e tamanho</h2><p>${esc(DESC_MODELO[e.modelo] ?? '')}</p></header>
    <div class="campos">
      ${campo('Nome do projeto', `<input id="p-nome" value="${esc(e.projeto.nome)}">`)}
      ${campo('Encadernação', sel('p-modelo', Object.values(MODELOS).map((x) => [x.id, x.nome]), e.modelo))}
      ${campo('Largura do livro fechado', num('p-w', e.formato.largura, 'min="20" step="0.5"'), 'em milímetros')}
      ${campo('Altura do livro fechado', num('p-h', e.formato.altura, 'min="20" step="0.5"'), 'em milímetros')}
      ${campo('Sentido de leitura', sel('p-dir', [['ltr', 'Esquerda para a direita'], ['rtl', 'Direita para a esquerda (mangá)']], e.direcao))}
      ${montagens.length > 1 ? campo('Montagem do miolo', sel('p-montagem', montagens.map((x) => [x, x === 'folhas' ? 'Folhas soltas' : 'Cadernos dobrados']), e.montagem ?? mod.montagem)) : ''}
      ${campo('Capa', sel('p-capa', mod.capas.map((c) => [c, ROT_CAPA[c]]), e.capa.modelo))}
      ${capaSeparada ? campo('Onde está a capa', sel('p-capa-fonte', [['no_pdf_4', 'No mesmo PDF: 2 primeiras e 2 últimas páginas'], ['no_pdf_2', 'No mesmo PDF: primeira e última página'], ['arquivo_separado', 'Em outro arquivo']], e.capa.fonte.fonte === 'no_pdf' ? `no_pdf_${e.capa.fonte.facesNoPdf ?? 4}` : 'arquivo_separado')) : ''}
      ${mod.orelhas && e.capa.modelo === 'separada_flexivel' ? campo('Orelhas da capa', num('p-orelha', e.capa.orelha ?? 0, 'min="0"'), 'em mm; 0 = sem orelhas (usual: 70 a 100)') : ''}
      ${mod.sobrecapa && e.capa.modelo === 'capa_dura' ? campo('Sobrecapa', sel('p-sobre', [['nao', 'Sem sobrecapa'], ['sim', 'Com sobrecapa']], e.capa.sobrecapa ? 'sim' : 'nao')) : ''}
    </div>
    ${mod.aceitaEncadernacaoSuperior ? `<label class="check"><input id="p-sup" type="checkbox"${e.encadernacaoSuperior ? ' checked' : ''}> Encadernado na borda de cima (calendário, bloco)</label>` : ''}
  </section>
  <section class="cartao">
    <header><h2>Papel, cores e tiragem</h2><p>A espessura do papel define a lombada e o ajuste de avanço das páginas. Se a gráfica usar outro papel, escolha "Outro" e informe a espessura.</p></header>
    <div class="campos">
      ${campo('Papel do miolo', selGrupos('p-papel-m', opcoesPapel(), e.selecao.papelMioloId ?? '', 'Outro (informar espessura)'))}
      ${!e.selecao.papelMioloId ? campo('Espessura do papel do miolo', num('p-cal-m', e.papeis.miolo?.calibreUm.valor ?? null, 'min="1"'), 'em mícrons (µm), da ficha do papel') : ''}
      ${capaSeparada ? campo('Papel da capa', selGrupos('p-papel-c', opcoesPapel(), e.selecao.papelCapaId ?? '', 'Outro (informar espessura)')) : ''}
      ${capaSeparada && !e.selecao.papelCapaId ? campo('Espessura do papel da capa', num('p-cal-c', e.papeis.capa?.calibreUm.valor ?? null, 'min="1"'), 'em mícrons (µm)') : ''}
      ${mod.guardas ? campo('Papel das guardas', selGrupos('p-papel-g', opcoesPapel(), e.selecao.papelGuardaId ?? '', '—')) : ''}
      ${campo('Cores do miolo', sel('p-cores', CORES, CORES.some(([v]) => v === corAtual) ? corAtual : '4x4'))}
      ${campo('Tiragem', num('p-tir', e.tiragem ?? null, 'min="1" step="1"'), 'quantidade de exemplares')}
    </div>
  </section>
  <details class="tecnico"><summary>Mais opções</summary><div>
    <div class="campos">${campo('Seu nome', `<input id="p-autor" value="${esc(S.autor)}" placeholder="Para o histórico de alterações">`)}</div>
    <div class="acoes"><button id="p-reset" class="btn sec">Recomeçar com o exemplo</button></div>
  </div></details>`;

  ligarArquivo();
  on('p-nome', 'change', (el) => mudar((x) => (x.projeto.nome = el.value || 'Projeto')));
  on('p-modelo', 'change', (el) => mudar((x) => {
    x.modelo = el.value as ModeloId;
    const md = MODELOS[x.modelo];
    x.montagem = undefined;
    if (!md.capas.includes(x.capa.modelo)) x.capa.modelo = md.capaPadrao;
    if (!md.aceitaEncadernacaoSuperior) x.encadernacaoSuperior = false;
  }, `Encadernação: ${MODELOS[el.value as ModeloId].nome}`));
  on('p-montagem', 'change', (el) => mudar((x) => (x.montagem = el.value as Montagem)));
  on('p-w', 'change', (el) => mudar((x) => (x.formato.largura = Math.max(20, Number(el.value) || x.formato.largura)), 'Tamanho alterado'));
  on('p-h', 'change', (el) => mudar((x) => (x.formato.altura = Math.max(20, Number(el.value) || x.formato.altura)), 'Tamanho alterado'));
  on('p-dir', 'change', (el) => mudar((x) => (x.direcao = el.value as 'ltr' | 'rtl')));
  on('p-sup', 'change', (el) => mudar((x) => (x.encadernacaoSuperior = el.checked)));
  on('p-capa', 'change', (el) => mudar((x) => (x.capa.modelo = el.value as ModeloCapa), `Capa: ${ROT_CAPA[el.value as ModeloCapa]}`));
  on('p-capa-fonte', 'change', (el) => mudar((x) => {
    x.capa.fonte = el.value === 'arquivo_separado' ? { fonte: 'arquivo_separado' } : { fonte: 'no_pdf', facesNoPdf: el.value === 'no_pdf_2' ? 2 : 4 };
  }));
  on('p-orelha', 'change', (el) => mudar((x) => (x.capa.orelha = Math.max(0, Number(el.value) || 0))));
  on('p-sobre', 'change', (el) => mudar((x) => { x.capa.sobrecapa = el.value === 'sim'; x.capa.sobrecapaOrelha ??= 80; }));
  on('p-tir', 'change', (el) => mudar((x) => (x.tiragem = Number(el.value) > 0 ? Math.floor(Number(el.value)) : undefined)));
  on('p-cores', 'change', (el) => mudar((x) => { const [f, v] = el.value.split('x').map(Number) as [number, number]; x.cores.mioloFrente = f; x.cores.mioloVerso = v; }));
  on('p-papel-m', 'change', (el) => mudar((x) => (x.selecao.papelMioloId = el.value || undefined)));
  on('p-papel-c', 'change', (el) => mudar((x) => (x.selecao.papelCapaId = el.value || undefined)));
  on('p-papel-g', 'change', (el) => mudar((x) => (x.selecao.papelGuardaId = el.value || undefined)));
  const manual = (k: 'miolo' | 'capa', el: HTMLInputElement) => mudar((x) => {
    const c = Number(el.value) || null;
    const mat: Material = { id: `manual-${k}`, nome: 'Informado', gramatura: { valor: null, origem: 'ausente', status: 'pendente' }, calibreUm: { valor: c, origem: c ? 'projeto' : 'ausente', status: c ? 'informado' : 'pendente' } };
    x.papeis[k] = mat;
  });
  on('p-cal-m', 'change', (el) => manual('miolo', el));
  on('p-cal-c', 'change', (el) => manual('capa', el));
  on('p-autor', 'change', (el) => { S.autor = el.value.trim(); salvarLocal(); });
  on('p-reset', 'click', () => { S.entrada = entradaInicial(); S.pdf = null; void abrirPdfjs(null); registrar('Projeto reiniciado'); recalcular(); render(); });
}

// ==========================================================================================
// 2. Páginas

function inserirBrancoEm(idPagina: string, depois: boolean, motivo: string) {
  const idx = S.entrada.paginas.findIndex((p) => p.id === idPagina);
  if (idx < 0) return;
  const pos: PosicaoBranco = depois ? { tipo: 'apos_indice', indice: idx } : idx === 0 ? { tipo: 'inicio' } : { tipo: 'apos_indice', indice: idx - 1 };
  mudar((x) => (x.paginas = inserirBrancos(x.paginas, 1, pos, motivo, S.autor || 'sem nome', `${agora()}-${Math.random().toString(36).slice(2, 7)}`)), `Página em branco inserida: ${motivo}`, true);
}

function regraLinha(titulo: string, pagina: number | null, c: Constatacao | undefined, semMarcacao: string, informativo = false): string {
  if (pagina === null) return `<li class="regra"><span class="tag neutro">Marcar</span><p><strong>${esc(titulo)}</strong><br><span class="ajuda">${esc(semMarcacao)}</span></p><span></span></li>`;
  if (!c || c.severidade === 'info') return `<li class="regra"><span class="tag ok">OK</span><p><strong>${esc(titulo)}</strong>${informativo ? `<br><span class="ajuda">${esc(semMarcacao)}</span>` : ''}</p><span></span></li>`;
  return `<li class="regra"><span class="tag ${c.severidade === 'erro' ? 'err' : 'warn'}">Corrigir</span><p><strong>${esc(titulo)}</strong><br><span class="ajuda">${esc(c.mensagem)}</span></p>${c.acao ? `<button class="btn mini" data-corrigir="${esc(c.acao.antesDe)}">${esc(c.acao.rotulo)}</button>` : '<span></span>'}</li>`;
}

function vPaginas(m: HTMLElement) {
  const r = S.r, e = S.entrada, edi = ed();
  const W = e.formato.largura, H = e.formato.altura;
  const pag = r.constatacoes.find((c) => c.codigo === 'PAG-001');
  const autocapa = e.capa.modelo === 'autocapa';
  const capaNoPdf = !autocapa && e.capa.fonte.fonte === 'no_pdf' && e.capa.modelo !== 'sem_capa';
  const opsPag = r.plano.opcoes.filter((o) => o.ajuste > 0);
  const melhor = opsPag[0];
  const funcao = (id: string) => (edi.paginas.folhaRostoId === id ? 'rosto' : edi.paginas.creditosId === id ? 'ficha' : (edi.paginas.capitulosIds ?? []).includes(id) ? 'capitulo' : '');
  const regras = r.constatacoes.filter((c) => c.codigo.startsWith('EDI-00') && c.codigo !== 'EDI-005');
  const plano = r.plano.escolhido;
  const capErro = regras.find((c) => c.codigo === 'EDI-003');
  m.innerHTML = `
  ${cabecalho('Páginas', 'Confira a ordem das páginas, inclua páginas em branco onde precisar e marque as páginas especiais. O projeto confere as regras do ISBN e da ABNT e sugere a correção.', ['Complete as páginas que faltam', 'Marque a folha de rosto e a ficha catalográfica', 'Use "+ antes" para empurrar uma página'])}
  ${pag && melhor ? `<div class="faixa err"><div><strong>${melhor.ajuste > 1 ? `Faltam ${melhor.ajuste} páginas` : 'Falta 1 página'} para fechar os cadernos</strong><span>${esc(MODELOS[e.modelo].nome)} exige um total que forme cadernos completos. Hoje são ${r.componentes.miolo.length} páginas; com ${melhor.total} fica certo (${melhor.tamanhos.join(' + ')}).</span></div>
    <button id="pg-completar" class="btn">Completar com ${melhor.ajuste} ${melhor.ajuste > 1 ? 'páginas' : 'página'} em branco</button></div>`
    : plano ? `<div class="faixa ok"><div><strong>${r.componentes.miolo.length} páginas · ${plano.length} caderno${plano.length > 1 ? 's' : ''} de ${[...new Set(plano)].join(', ')}</strong><span>${r.montagem === 'aninhada' ? 'Os cadernos ficam um dentro do outro.' : r.montagem === 'alcada' ? 'Os cadernos são empilhados em sequência.' : 'Folhas soltas.'}</span></div></div>` : ''}
  <section class="cartao">
    <header><h2>Regras do livro (ISBN e ABNT)</h2><p>O número do ISBN e o código de barras vêm da Agência Brasileira do ISBN. O projeto confere <strong>onde</strong> eles ficam: a ficha catalográfica com o ISBN vai no verso da folha de rosto (página par), e o código de barras na 4ª capa.</p></header>
    <label class="check"><input id="e-isbn" type="checkbox"${edi.temIsbn ? ' checked' : ''}> Este livro terá ISBN (aplicar as regras)</label>
    ${edi.temIsbn ? `<ul class="regras">
      ${regraLinha('Folha de rosto numa página ímpar (frente)', r.editorial.numeros.folhaRosto, regras.find((c) => c.codigo === 'EDI-001'), 'Marque na lista abaixo qual página é a folha de rosto.')}
      ${regraLinha('Ficha catalográfica (ISBN) no verso da folha de rosto', r.editorial.numeros.creditos, regras.find((c) => c.codigo === 'EDI-002'), 'Marque na lista abaixo qual página tem a ficha catalográfica.')}
      ${r.editorial.numeros.capitulos.length ? regraLinha('Capítulos começando em página ímpar (à direita)', r.editorial.numeros.capitulos[0]!, capErro, '') : ''}
      ${regraLinha('Espaço para o código de barras na 4ª capa', r.editorial.areaCodigo ? 1 : null, undefined, r.editorial.areaCodigo ? 'Área reservada embaixo, junto à lombada (veja em Montagem → Capa aberta).' : 'Sem 4ª capa calculada.', true)}
    </ul>` : ''}
  </section>
  <section class="cartao">
    <header><h2>Lista de páginas</h2><p>Use <strong>+ antes</strong> ou <strong>+ depois</strong> para incluir uma página em branco em qualquer ponto. Se o total deixar de fechar os cadernos, o aviso aparece no alto.</p></header>
    <div class="lista-pg" style="--ar:${W}/${H}">
      <div class="cab-lista"><span>Pág.</span><span></span><span>Conteúdo</span><span>Função</span><span></span></div>
      ${r.componentes.miolo.map((p, i) => {
        const nome = p.papel !== 'miolo' ? p.papel.replace('1a_capa', '1ª capa').replace('2a_capa', '2ª capa').replace('3a_capa', '3ª capa').replace('4a_capa', '4ª capa') : '';
        const ladoTxt = i % 2 === 0 ? 'frente (à direita)' : 'verso (à esquerda)';
        return `<div class="linha-pg${p.tipo === 'branco' ? ' branco' : ''}${S.pagina === i + 1 ? ' sel' : ''}">
          <span class="num">${i + 1}</span>
          <span class="thumb">${imgThumb(p.tipo === 'branco' ? null : p.origem)}</span>
          <span class="info-pg"><strong>${p.tipo === 'branco' ? 'Página em branco' : esc(nome || p.rotulo || `Página ${i + 1}`)}</strong><span>${ladoTxt}${p.tipo === 'branco' && p.motivo ? ` · ${esc(p.motivo)}` : nome ? ` · ${esc(p.rotulo ?? '')}` : ''}</span></span>
          ${p.tipo === 'branco' ? '<span></span>' : `<select data-fn="${esc(p.id)}" aria-label="Função da página ${i + 1}">${([['', '—'], ['rosto', 'Folha de rosto'], ['ficha', 'Ficha catalográfica (ISBN)'], ['capitulo', 'Início de capítulo']] as Array<[string, string]>).map(([v, t]) => `<option value="${v}"${funcao(p.id) === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`}
          <span class="acoes"><button class="btn mini sec" data-antes="${esc(p.id)}" title="Inserir página em branco antes">+ antes</button><button class="btn mini sec" data-depois="${esc(p.id)}" title="Inserir página em branco depois">+ depois</button>${p.tipo === 'branco' ? `<button class="btn mini sec" data-remb="${esc(p.id)}">Remover</button>` : ''}</span>
        </div>`;
      }).join('')}
    </div>
    ${r.componentes.capa ? `<p class="nota">Capa separada: ${r.componentes.capa.map((p) => `${p.papel.replace('a_capa', 'ª capa')} (${p.origem ? `página ${p.origem.indice + 1} do arquivo` : 'sem impressão'})`).join(' · ')}.</p>` : ''}
  </section>
  ${pag && opsPag.length > 1 ? `<details class="tecnico"><summary>Outras formas de fechar os cadernos</summary><div>
    <div class="campos">${campo('Opção', sel('pg-op', opsPag.map((o, i): [string, string] => [String(i), o.descricao]), '0'))}${campo('Onde incluir', sel('pg-pos', [['fim', autocapa || capaNoPdf ? 'No fim do miolo (antes da contracapa)' : 'No fim'], ['inicio', autocapa || capaNoPdf ? 'No início do miolo (depois da capa)' : 'No início']], 'fim'))}</div>
    <div class="acoes"><button id="pg-aplicar" class="btn sec">Aplicar</button></div></div></details>` : ''}`;

  const completar = (o: typeof melhor, pos: 'fim' | 'inicio') => {
    if (!o) return;
    const n = e.paginas.length;
    const faces = autocapa ? 2 : capaNoPdf ? (e.capa.fonte.facesNoPdf === 2 ? 1 : 2) : 0;
    const posicao: PosicaoBranco = pos === 'inicio' ? (faces ? { tipo: 'apos_indice', indice: faces - 1 } : { tipo: 'inicio' }) : faces ? { tipo: 'apos_indice', indice: n - faces - 1 } : { tipo: 'fim' };
    const txt = o.ajuste > 1 ? `${o.ajuste} páginas em branco incluídas` : '1 página em branco incluída';
    mudar((x) => (x.paginas = inserirBrancos(x.paginas, o.ajuste, posicao, 'Completar os cadernos', S.autor || 'sem nome', `${agora()}-c`)), `${txt} para completar os cadernos`, true);
    toast(`${txt} no fim do miolo.`);
  };
  on('pg-completar', 'click', () => completar(melhor, 'fim'));
  on('pg-aplicar', 'click', () => completar(opsPag[Number(($('#pg-op') as HTMLSelectElement).value)], ($('#pg-pos') as HTMLSelectElement).value as 'fim' | 'inicio'));
  on('e-isbn', 'change', (el) => mudar(() => (ed().temIsbn = el.checked)));
  m.querySelectorAll<HTMLButtonElement>('[data-antes]').forEach((b) => b.addEventListener('click', () => inserirBrancoEm(b.dataset.antes!, false, 'Incluída manualmente')));
  m.querySelectorAll<HTMLButtonElement>('[data-depois]').forEach((b) => b.addEventListener('click', () => inserirBrancoEm(b.dataset.depois!, true, 'Incluída manualmente')));
  m.querySelectorAll<HTMLButtonElement>('[data-remb]').forEach((b) => b.addEventListener('click', () => mudar((x) => (x.paginas = removerPagina(x.paginas, b.dataset.remb!)), 'Página em branco removida', true)));
  m.querySelectorAll<HTMLButtonElement>('[data-corrigir]').forEach((b) => b.addEventListener('click', () => {
    const c = S.r.constatacoes.find((x) => x.acao && x.acao.antesDe === b.dataset.corrigir);
    if (c?.acao) { inserirBrancoEm(c.acao.antesDe, false, c.codigo === 'EDI-003' ? 'Capítulo em página ímpar' : 'Ficha catalográfica no verso da folha de rosto'); toast('Página em branco incluída. Confira o total de páginas no alto.'); }
  }));
  m.querySelectorAll<HTMLSelectElement>('[data-fn]').forEach((s) => s.addEventListener('change', () => mudar(() => {
    const id = s.dataset.fn!;
    const p = ed().paginas;
    if (p.folhaRostoId === id) p.folhaRostoId = undefined;
    if (p.creditosId === id) p.creditosId = undefined;
    p.capitulosIds = (p.capitulosIds ?? []).filter((x) => x !== id);
    if (s.value === 'rosto') p.folhaRostoId = id;
    if (s.value === 'ficha') p.creditosId = id;
    if (s.value === 'capitulo') p.capitulosIds.push(id);
  })));
}

// ==========================================================================================
// 3. Conferir (leitor com virada e pares)

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
function conteudoPagina(fi: number | null): string {
  if (fi === null) return '';
  const f = S.r.leitura.faces[fi - 1]!;
  return `<span class="pnum">${f.paginaMiolo ?? ''}</span>${imgThumb(origemDaFace(fi), true)}<span class="prot">${esc(f.rotulo)}</span>`;
}
function classePagina(fi: number | null) {
  if (fi === null) return 'pag vazia';
  const f = S.r.leitura.faces[fi - 1]!;
  return `pag${f.tipo === 'branco' ? ' branco' : ''}${f.paginaMiolo !== null && f.paginaMiolo === S.pagina ? ' sel' : ''}`;
}

function vConferir(m: HTMLElement) {
  const rtl = S.entrada.direcao === 'rtl';
  const W = S.entrada.formato.largura, H = S.entrada.formato.altura;
  m.innerHTML = `
  ${cabecalho('Conferir', 'Folheie o livro como o leitor vai ver e confira se cada página está no lugar. Em "Como as folhas se juntam" você vê quais páginas ficam lado a lado no papel impresso.', ['Use as setas ou arraste para virar', 'Clique numa página para ver com quais outras ela divide a folha'])}
  <div class="segmentos" role="tablist">
    <button class="seg${S.modoLeitura === 'leitor' ? ' on' : ''}" data-ml="leitor" role="tab">Como o leitor vê<small>ordem de leitura</small></button>
    <button class="seg${S.modoLeitura === 'pares' ? ' on' : ''}" data-ml="pares" role="tab">Como as folhas se juntam<small>lado a lado no papel</small></button>
  </div>
  <div id="corpo"></div>`;
  m.querySelectorAll<HTMLButtonElement>('[data-ml]').forEach((b) => b.addEventListener('click', () => { S.modoLeitura = b.dataset.ml as 'leitor' | 'pares'; vConferir(m); }));
  const corpo = $('#corpo');
  if (S.modoLeitura === 'pares') { corpo.innerHTML = paresHtml(); ligarPares(corpo); return; }
  const sup = !!S.entrada.encadernacaoSuperior;
  corpo.innerHTML = `
  <section class="cartao leitor">
    <p class="nota centro">A primeira página abre sozinha à ${rtl ? 'esquerda' : 'direita'}; depois o livro abre em duplas (2|3, 4|5…).</p>
    <div class="livro${sup ? ' vertical' : ''}" id="livro" style="--ar:${W}/${H}">
      <div class="pag vazia esq" id="pg-a"></div><div class="pag vazia dir" id="pg-b"></div>
    </div>
    <div class="nav-leitura">
      <button id="l-prev" class="btn sec">${rtl ? 'Próxima' : 'Anterior'}</button>
      <span class="mono" id="l-pos"></span>
      <button id="l-next" class="btn sec">${rtl ? 'Anterior' : 'Próxima'}</button>
    </div>
    <p class="sinc" id="l-sinc"></p>
    ${!S.pdf ? '<p class="nota centro">Sem PDF, as páginas aparecem numeradas. Envie o arquivo na etapa Livro.</p>' : ''}
  </section>
  <section class="cartao"><header><h2>Todas as páginas</h2></header>
    <div class="tira" id="tira">${S.r.leitura.faces.map((f) => `<button class="mini-pg ${f.tipo === 'branco' ? 'branco' : ''} c-${f.componente}" data-face="${f.indice}" title="${esc(f.rotulo)}"><span>${f.paginaMiolo ?? '·'}</span><span class="r">${esc(f.rotulo.replace('Pág. ', ''))}</span></button>`).join('')}</div>
  </section>`;
  atualizarLeitor(false);
  on('l-prev', 'click', () => navegar(rtl ? +1 : -1));
  on('l-next', 'click', () => navegar(rtl ? -1 : +1));
  const livro = $('#livro');
  livro.addEventListener('click', (ev) => {
    const alvo = (ev.target as HTMLElement).closest<HTMLElement>('.pag');
    if (!alvo || animacao) return;
    const d = S.r.leitura.duplas[S.vista]!;
    const fi = alvo.id === 'pg-a' ? d.a : d.b;
    const f = fi ? S.r.leitura.faces[fi - 1] : null;
    if (f?.paginaMiolo) { S.pagina = f.paginaMiolo; atualizarLeitor(false); }
  });
  let x0 = 0;
  livro.addEventListener('pointerdown', (ev) => { x0 = ev.clientX; });
  livro.addEventListener('pointerup', (ev) => { const dx = ev.clientX - x0; if (Math.abs(dx) > 40) navegar((dx < 0) !== rtl ? +1 : -1); });
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
  if (alvo >= 0 && alvo < S.r.leitura.duplas.length) irParaVista(alvo);
}
function irParaVista(k: number) {
  if (animacao) animacao.finish();
  const de = S.vista;
  S.vista = k;
  const livro = document.getElementById('livro');
  if (!livro || Math.abs(k - de) !== 1 || reduzMovimento() || livro.classList.contains('vertical')) { atualizarLeitor(false); return; }
  virarFolha(de, k);
}
function atualizarLeitor(manterA: boolean, manterB = false) {
  const d = S.r.leitura.duplas[S.vista];
  const a = document.getElementById('pg-a'), b = document.getElementById('pg-b');
  if (!d || !a || !b) return;
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
  const nums = [d.a, d.b].map((fi) => (fi ? S.r.leitura.faces[fi - 1]!.rotulo.replace('Pág. ', '') : null)).filter(Boolean);
  const pos = document.getElementById('l-pos');
  if (pos) pos.textContent = `${nums.join(' | ')}  ·  ${S.vista + 1}/${total}`;
  document.querySelectorAll<HTMLElement>('#tira [data-face]').forEach((el) => { const fi = Number(el.dataset.face); el.classList.toggle('atual', fi === d.a || fi === d.b); });
  const sinc = document.getElementById('l-sinc');
  if (sinc) sinc.innerHTML = S.pagina ? `Página ${S.pagina} · ${esc(parDe(S.pagina))}` : 'Clique numa página para ver com quais outras ela divide a folha impressa.';
  for (const kk of [S.vista - 1, S.vista + 1, S.vista + 2]) {
    const dd = S.r.leitura.duplas[kk];
    if (dd) { pedirThumb(origemDaFace(dd.a)); pedirThumb(origemDaFace(dd.b)); }
  }
}
function parDe(pg: number): string {
  for (const p of S.r.pares) {
    if ([...p.fora, ...p.dentro].includes(pg)) {
      if (p.solta) return 'folha solta';
      const outras = [...p.fora, ...p.dentro].filter((x) => x !== pg && x > 0);
      return `fica na folha dobrada ${p.folha}, junto com as páginas ${outras.join(', ')}`;
    }
  }
  return '';
}
function virarFolha(de: number, para: number) {
  const D = S.r.leitura.duplas;
  const velha = D[de]!, nova = D[para]!;
  const viraDireita = para > de !== (S.entrada.direcao === 'rtl');
  const livro = document.getElementById('livro')!;
  const frenteFi = viraDireita ? velha.b : velha.a;
  const versoFi = viraDireita ? nova.a : nova.b;
  if (frenteFi === null && versoFi === null) { atualizarLeitor(false); return; }
  const folha = document.createElement('div');
  folha.className = `folha-vira ${viraDireita ? 'da-direita' : 'da-esquerda'}`;
  folha.innerHTML = `<div class="face frente ${classePagina(frenteFi)}">${conteudoPagina(frenteFi)}<i class="sombra"></i></div><div class="face verso ${classePagina(versoFi)}">${conteudoPagina(versoFi)}<i class="sombra"></i></div>`;
  livro.append(folha);
  if (viraDireita) atualizarLeitor(true, false); else atualizarLeitor(false, true);
  const ang = viraDireita ? -180 : 180;
  animacao = folha.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${ang / 2}deg) translateZ(1px)`, offset: 0.5 }, { transform: `rotateY(${ang}deg)` }], { duration: 680, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
  folha.querySelectorAll<HTMLElement>('.sombra').forEach((s, i) => s.animate(i === 0 ? [{ opacity: 0 }, { opacity: 0.35 }, { opacity: 0.6 }] : [{ opacity: 0.6 }, { opacity: 0.35 }, { opacity: 0 }], { duration: 680, easing: 'ease-in-out', fill: 'forwards' }));
  const fim = () => { atualizarLeitor(false); folha.remove(); animacao = null; };
  animacao.onfinish = fim;
  animacao.oncancel = fim;
}

function miniPg(pg: number) {
  if (!pg) return '<span class="mp vazia"></span>';
  const o = origemDaPagina(pg);
  return `<span class="mp${o ? '' : ' br'}${pg === S.pagina ? ' sel' : ''}" data-pg="${pg}"><b>${pg}</b>${imgThumb(o)}</span>`;
}
function paresHtml(): string {
  const r = S.r;
  const N = r.componentes.miolo.length;
  if (r.montagem === 'sanfona') return `<section class="cartao"><p>Sanfona: páginas 1 a ${N / 2} na frente da tira e ${N / 2 + 1} a ${N} no verso.</p></section>`;
  if (!r.pares.length) return `<section class="cartao"><p class="vazio">Complete as páginas (etapa Páginas) para ver como as folhas se juntam.</p></section>`;
  if (r.pares[0]!.solta) return `<section class="cartao"><p>Folhas soltas: cada folha tem uma página na frente e a seguinte no verso (1 e 2, 3 e 4…). Não há pares lado a lado.</p></section>`;
  const aninhado = r.montagem === 'aninhada';
  return `<section class="cartao">
    <header><h2>Como as páginas se juntam no papel</h2>
    <p>${aninhado ? `No livro aberto você vê 2|3, 4|5… No papel impresso, ficam lado a lado as páginas que se encontram depois da dobra: <strong>a primeira com a última</strong> (${N}|1), a segunda com a penúltima (2|${N - 1}) e assim por diante. Em cada folha, os números somam <strong>${N + 1}</strong>. É assim que sai o arquivo "lado a lado" para a gráfica.` : 'Cada caderno é dobrado separadamente. Dentro de cada caderno, a primeira página fica com a última do caderno.'}</p></header>
    ${aninhado ? ilustracao(r.pares) : ''}
  </section>
  <section class="cartao"><header><h2>Folhas dobradas, da mais externa para a mais interna</h2></header>
    <div class="pares" style="--ar:${S.entrada.formato.largura}/${S.entrada.formato.altura}">${r.pares.map((p) => `<article class="par-c">
      <header><strong>Folha ${p.folha}</strong>${r.unidades.length > 1 ? `<span class="ajuda">caderno ${p.caderno}</span>` : ''}<span class="soma">soma ${p.fora[0] + p.fora[1]}</span></header>
      <div class="lados"><div><span class="k">Lado de fora</span><div class="dupla-mini">${p.fora.map(miniPg).join('')}</div></div>
      <div><span class="k">Lado de dentro</span><div class="dupla-mini">${p.dentro.map(miniPg).join('')}</div></div></div>
    </article>`).join('')}</div>
  </section>`;
}
function ilustracao(pares: ParImpressao[]): string {
  const rtl = S.entrada.direcao === 'rtl';
  const lista = pares.slice(0, 12);
  const n = lista.length, passo = 16, H = 40 + 2 * n * passo + 10, meio = H / 2, xL = 90, xF = 430;
  const linhas = lista.map((p, i) => {
    const [fe, fd] = rtl ? [p.fora[1], p.fora[0]] : p.fora;
    const [de, dd] = rtl ? [p.dentro[1], p.dentro[0]] : p.dentro;
    const yT = 20 + i * passo, yB = H - 20 - i * passo, xD = xL + i * 9, rr = (yB - yT) / 2;
    return `<path d="M ${xF} ${yT} L ${xD + rr * 0.6} ${yT} Q ${xD} ${yT} ${xD} ${meio} Q ${xD} ${yB} ${xD + rr * 0.6} ${yB} L ${xF} ${yB}" class="dobra-l"/>
      <text x="${xF + 8}" y="${yT + 4}" class="dobra-t">${fd} · ${de}</text><text x="${xF + 8}" y="${yB + 4}" class="dobra-t">${dd} · ${fe}</text>`;
  }).join('');
  return `<figure class="ilustra"><svg viewBox="0 0 520 ${H}" role="img" aria-label="Folhas dobradas umas dentro das outras">${linhas}
    <text x="${xL - 12}" y="${meio + 4}" class="dobra-t" text-anchor="end">lombada</text><text x="${xF + 8}" y="12" class="dobra-t sub">frente · verso</text></svg>
    <figcaption class="nota">O livro cortado e visto de cima: cada linha é uma folha dobrada, uma dentro da outra. Lendo os números de cima para baixo, você percorre o livro em ordem.</figcaption></figure>`;
}
function ligarPares(c: HTMLElement) {
  c.querySelectorAll<HTMLElement>('[data-pg]').forEach((el) => el.addEventListener('click', () => {
    irParaPagina(Number(el.dataset.pg)); S.modoLeitura = 'leitor'; render();
  }));
}
function irParaPagina(pg: number) {
  S.pagina = pg;
  const mp = S.r.mapa[pg - 1];
  if (mp?.forma) { S.forma = mp.forma; S.lado = mp.lado === 'B' ? 'B' : 'A'; }
  const face = S.r.leitura.faces.find((f) => f.paginaMiolo === pg);
  if (face) { const k = S.r.leitura.duplas.findIndex((d) => d.a === face.indice || d.b === face.indice); if (k >= 0) S.vista = k; }
}

// ==========================================================================================
// 4. Montagem (folha da gráfica e capa)

function svgForma(f: Forma, lado: 'A' | 'B', capa: boolean): string {
  const W = f.folha.largura, H = f.folha.altura;
  const lista = lado === 'A' ? f.ladoA : f.ladoB;
  const fmt = capa ? null : S.entrada.formato;
  const area = f.areaImprimivel;
  const parts: string[] = [`<rect x="0" y="0" width="${W}" height="${H}" class="s-folha"/>`, `<rect x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}" class="s-area"/>`];
  const borda = String(S.r.parametros.find((p) => p.chave === 'maquina.bordaPinca')?.valor ?? 'bottom');
  const bp = lado === 'B' && f.viradaVerso === 'pinca' && !f.mesmaChapa ? ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as Record<string, string>)[borda]! : borda;
  const pv = Number(S.r.parametros.find((p) => p.chave === 'maquina.pinca')?.valor ?? 0);
  const pr = bp === 'bottom' ? [0, H - pv, W, pv] : bp === 'top' ? [0, 0, W, pv] : bp === 'left' ? [0, 0, pv, H] : [W - pv, 0, pv, H];
  parts.push(`<rect x="${pr[0]}" y="${pr[1]}" width="${pr[2]}" height="${pr[3]}" class="s-pinca"/><text x="${pr[0]! + (bp === 'left' || bp === 'right' ? pv / 2 : W / 2)}" y="${pr[1]! + (bp === 'top' || bp === 'bottom' ? pv / 2 + 3 : H / 2)}" class="s-pinca-t">PINÇA</text>`);
  for (const p of lista) {
    const c = p.corte;
    parts.push(`<rect x="${c.x - p.sangria.l}" y="${c.y - p.sangria.t}" width="${c.w + p.sangria.l + p.sangria.r}" height="${c.h + p.sangria.t + p.sangria.b}" class="s-sang"/>`);
    const o = capa ? null : origemDaPagina(p.pagina);
    const br = !capa && o === null;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const pw = fmt ? fmt.largura : c.w, ph = fmt ? fmt.altura : c.h;
    if (o) pedirThumb(o);
    parts.push(`<g class="s-pg${br ? ' br' : ''}${!capa && p.pagina === S.pagina ? ' sel' : ''}" data-pg="${capa ? '' : p.pagina}">
      <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" class="s-corte"/>
      <g transform="translate(${cx} ${cy}) rotate(${p.rotacao})">
        ${o ? `<image data-th="${esc(chaveDe(o))}" href="${urlThumb(o)}" x="${-pw / 2}" y="${-ph / 2}" width="${pw}" height="${ph}" preserveAspectRatio="none"/>` : ''}
        <text x="0" y="${o ? ph / 2 - ph * 0.09 : 0}" class="s-num${o ? ' sobre' : ''}" style="font-size:${Math.min(pw, ph) * (o ? 0.16 : 0.32)}px">${capa ? (p.pagina === 1 ? 'externa' : 'interna') : p.pagina}</text>
        <path d="M ${-pw * 0.08} ${-ph / 2 + ph * 0.1} L 0 ${-ph / 2 + ph * 0.04} L ${pw * 0.08} ${-ph / 2 + ph * 0.1}" class="s-cab"/>
      </g></g>`);
  }
  if (lado === 'A' || f.mesmaChapa) for (const mk of f.marcasA) {
    parts.push(mk.tipo === 'colacao' ? `<rect x="${mk.x1}" y="${mk.y1}" width="${mk.x2 - mk.x1}" height="${mk.y2 - mk.y1}" class="s-col"/>` : `<line x1="${mk.x1}" y1="${mk.y1}" x2="${mk.x2}" y2="${mk.y2}" class="s-mk ${mk.tipo}"/>`);
  }
  return `<svg viewBox="-4 -4 ${W + 8} ${H + 8}" class="folha-svg" role="img" aria-label="Folha ${W} por ${H} mm, lado ${lado}">${parts.join('')}</svg>`;
}

function vMontagem(m: HTMLElement) {
  m.innerHTML = `
  ${cabecalho('Montagem', 'Veja como as páginas ficam na folha que entra na máquina da gráfica e como fica a capa aberta, com a lombada.', ['Escolha a folha ou a capa', 'Clique numa página para conferi-la no livro'])}
  <div class="segmentos" role="tablist">
    <button class="seg${S.modoMontagem === 'folha' ? ' on' : ''}" data-mm="folha">Folha da gráfica<small>páginas montadas</small></button>
    <button class="seg${S.modoMontagem === 'capa' ? ' on' : ''}" data-mm="capa">Capa aberta<small>com lombada</small></button>
  </div><div id="corpo"></div>`;
  m.querySelectorAll<HTMLButtonElement>('[data-mm]').forEach((b) => b.addEventListener('click', () => { S.modoMontagem = b.dataset.mm as 'folha' | 'capa'; vMontagem(m); }));
  const corpo = $('#corpo');
  if (S.modoMontagem === 'capa') { montagemCapa(corpo); return; }
  const r = S.r;
  const todas = [...r.formas, ...r.formasCapa];
  const f = todas.find((x) => x.id === S.forma) ?? todas[0];
  const capa = !!f && r.formasCapa.includes(f);
  const lado = f?.mesmaChapa ? 'A' : S.lado;
  const info = (k: string, v: string) => `<div class="info"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  corpo.innerHTML = f ? `<section class="cartao">
    <header><p>As páginas de cabeça para baixo e fora de ordem são intencionais: depois de impressa, a folha é dobrada e cortada, e as páginas ficam na ordem certa.</p></header>
    <div class="barra">
      <div class="segmentos">${todas.map((x, i) => `<button class="seg${x.id === f.id ? ' on' : ''}" data-forma="${esc(x.id)}">${r.formasCapa.includes(x) ? 'Capa' : `Folha ${i + 1}`}<small>${r.formasCapa.includes(x) ? 'capa aberta' : `caderno ${x.unidades.map((u) => u + 1).join(', ')}`}</small></button>`).join('')}</div>
      ${f.mesmaChapa ? '' : `<div class="segmentos">${(['A', 'B'] as const).map((l) => `<button class="seg${lado === l ? ' on' : ''}" data-lado="${l}">${l === 'A' ? 'Frente' : 'Verso'}<small>${l === 'A' ? 'lado A' : 'lado B'}</small></button>`).join('')}</div>`}
    </div>
    <div class="folha-wrap">${svgForma(f, lado, capa)}</div>
    <ul class="legenda"><li><i class="lg corte"></i>Página</li><li><i class="lg sang"></i>Sangria</li><li><i class="lg pinca"></i>Pinça</li><li><i class="lg cab"></i>Seta: topo da página</li><li><i class="lg br"></i>Em branco</li></ul>
    <div class="infos">${info('Folha', `${f.folha.largura} × ${f.folha.altura} mm`)}${info('Cópias por folha', String(Object.values(f.copiasPorFolha)[0] ?? 0))}${info('Impressão', f.mesmaChapa ? 'mesma chapa nos dois lados' : 'frente e verso')}</div>
  </section>
  ${r.unidades.length && r.unidades[0]!.layout.esquema.folds.length ? `<details class="tecnico"><summary>Cadernos desdobrados (detalhe técnico)</summary><div><div class="cadernos">${r.unidades.slice(0, 6).map(cadernoLogico).join('')}</div></div></details>` : ''}`
    : `<section class="cartao"><p class="vazio">${r.unidades.length ? 'A montagem aparece quando o tamanho da folha de impressão estiver definido (etapa Gráfica).' : 'Complete as páginas (etapa Páginas) para ver a montagem.'}</p></section>`;
  m.querySelectorAll<HTMLButtonElement>('[data-forma]').forEach((b) => b.addEventListener('click', () => { S.forma = b.dataset.forma!; vMontagem(m); }));
  m.querySelectorAll<HTMLButtonElement>('[data-lado]').forEach((b) => b.addEventListener('click', () => { S.lado = b.dataset.lado as 'A' | 'B'; vMontagem(m); }));
  m.querySelectorAll<SVGGElement>('[data-pg]').forEach((g) => g.addEventListener('click', () => { const pg = Number(g.dataset.pg); if (pg) { irParaPagina(pg); S.modoLeitura = 'leitor'; location.hash = 'conferir'; } }));
}

function cadernoLogico(u: ResultadoMotor['unidades'][number]) {
  const l = u.layout;
  const grade = (face: 'frente' | 'verso') => `<div class="grade" style="grid-template-columns:repeat(${l.cols},1fr)">${[...l.celulas].sort((a, b) => a[face].row - b[face].row || a[face].col - b[face].col).map((c) => {
    const g = u.mapa[c[face].pagina - 1]!;
    return `<span class="cel${origemDaPagina(g) === null ? ' br' : ''}${g === S.pagina ? ' sel' : ''}"><b style="transform:rotate(${c[face].rotacao}deg)">${g}</b></span>`;
  }).join('')}</div>`;
  return `<figure class="cad"><figcaption>Caderno ${u.indice + 1} · ${u.tamanho} páginas</figcaption><div class="faces"><div><span class="k">Frente</span>${grade('frente')}</div><div><span class="k">Verso</span>${grade('verso')}</div></div></figure>`;
}

function montagemCapa(corpo: HTMLElement) {
  const r = S.r;
  const pl = r.capa.planificacao;
  const area = r.editorial.areaCodigo;
  if (!pl) {
    corpo.innerHTML = `<section class="cartao"><p>${S.entrada.capa.modelo === 'autocapa' ? `A capa faz parte do miolo: páginas 1 e 2 (1ª e 2ª capa) e as duas últimas (3ª e 4ª capa).${area ? ` Reserve a parte de baixo da página ${area.pagina} (4ª capa), junto à lombada, para o código de barras da Agência ISBN: ${n2(area.w)} × ${n2(area.h)} mm, a 5 mm das bordas.` : ''}` : r.capa.folhasDeCapa ? 'Folhas de capa: duas folhas no tamanho do miolo (1ª/2ª e 3ª/4ª capa), impressas à parte.' : 'Este modelo não tem capa aberta.'}</p></section>`;
    return;
  }
  const W = pl.largura, H = pl.altura, s = pl.sangria;
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
  if (area?.alvo === 'planificacao') parts.push(`<rect x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}" class="area-cod"/><text x="${area.x + area.w / 2}" y="${area.y + area.h / 2}" class="area-cod-t">código de barras</text>`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" class="corte"/>`);
  const cd = r.capa.capaDura;
  const info = (k: string, v: string) => `<div class="info"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  corpo.innerHTML = `<section class="cartao">
    <header><h2>${esc(pl.componente)}</h2><p>Medidas calculadas a partir do número de páginas e da espessura do papel. A área azul tracejada é o lugar reservado para o código de barras que vem da Agência ISBN.</p></header>
    <div class="folha-wrap"><svg viewBox="${-s - 10} ${-s - 10} ${W + 2 * s + 20} ${H + 2 * s + 20}" class="capa-svg" role="img" aria-label="Capa aberta">${parts.join('')}</svg></div>
    <div class="infos">${info('Capa aberta', `${n2(W)} × ${n2(H)} mm`)}${info('Sangria', `${n2(s)} mm`)}${info('Lombada', r.fisica.lombada ? (r.fisica.lombada.valor === null ? 'falta a espessura do papel' : `${n2(r.fisica.lombada.valor, 2)} mm`) : 'não tem')}${cd ? info('Papelão', `${n2(cd.papelao.largura.valor)} × ${n2(cd.papelao.altura.valor)} mm`) : ''}</div>
    ${pl.pendencias.length ? `<div class="faixa warn"><div><strong>Faltam dados para fechar a capa</strong><span>${pl.pendencias.map(esc).join(', ')}</span></div></div>` : ''}
  </section>`;
}

// ==========================================================================================
// 5. Gráfica

/** Perguntas em linguagem da gráfica. Cada resposta vira um ajuste "informado pela gráfica". */
const PERGUNTAS: Array<{ chave: string; rotulo: string; ajuda: string; opcoes?: Array<[string, string]> }> = [
  { chave: 'arquivo.entrega', rotulo: 'Formato de entrega', ajuda: 'Como a gráfica quer receber o miolo.', opcoes: [['lado_a_lado', 'Lado a lado (livreto)'], ['paginas_individuais', 'Páginas individuais'], ['folhas_montadas', 'Folhas já montadas']] },
  { chave: 'arquivo.sangria', rotulo: 'Sangria (mm)', ajuda: 'Quanto a imagem passa da linha de corte.' },
  { chave: 'maquina.pinca', rotulo: 'Margem de pinça (mm)', ajuda: 'Borda da folha que a máquina segura.' },
  { chave: 'cadernos.tamanhos', rotulo: 'Páginas por caderno', ajuda: 'Ex.: 16, 8, 4 (o que a dobradeira faz).' },
  { chave: 'acabamento.canoa.maxPaginas', rotulo: 'Limite de páginas no grampo', ajuda: 'Acima disso a gráfica não grampeia.' },
  { chave: 'acabamento.fresagem', rotulo: 'Fresagem da lombada (mm)', ajuda: 'Quanto é desbastado antes da cola.' },
  { chave: 'acabamento.lombada.acrescimo', rotulo: 'Acréscimo na lombada (mm)', ajuda: 'Cola e capa somadas à espessura.' },
  { chave: 'capaDura.espessuraPapelao', rotulo: 'Espessura do papelão (mm)', ajuda: 'Capa dura.' },
  { chave: 'capaDura.esquadro', rotulo: 'Sobra do papelão (mm)', ajuda: 'Quanto a capa passa do miolo.' },
  { chave: 'capaDura.canal', rotulo: 'Canal (mm)', ajuda: 'Espaço entre a capa e a lombada.' },
  { chave: 'acabamento.furacao.margem', rotulo: 'Margem da furação (mm)', ajuda: 'Faixa ocupada pelos furos.' },
];

function salvarAjuste(chave: string, valor: ValorParam) {
  const def = REGISTRO_POR_CHAVE.get(chave)!;
  const aj: AjusteProjeto = { chave, valor, motivo: 'Informado pela gráfica', autor: S.autor || 'sem nome', data: agora() };
  mudar((x) => { x.ajustes = x.ajustes.filter((a) => a.chave !== chave); x.ajustes.push(aj); }, `${def.rotulo}: ${String(valor)}`, true);
}

function vGrafica(m: HTMLElement) {
  const e = S.entrada;
  const val = (k: string) => S.r.parametros.find((x) => x.chave === k);
  const folhaAtual = `${val('maquina.folha.largura')?.valor ?? ''}x${val('maquina.folha.altura')?.valor ?? ''}`;
  const folhasOp: Array<[string, string]> = [...FOLHAS_REFERENCIA.map((f): [string, string] => [`${f.largura}x${f.altura}`, f.nome]), ['outro', 'Outro tamanho']];
  const ehOutro = !folhasOp.some(([v]) => v === folhaAtual);
  const origem = (k: string) => {
    const v = val(k);
    if (!v) return '';
    return `<span class="origem">${v.origem === 'projeto' ? `<button class="btn link" data-limpar="${k}" type="button" title="Voltar ao padrão de mercado">desfazer</button>` : ''}<span class="badge o-${v.origem}">${ORIGEM_ROT[v.origem]}</span></span>`;
  };
  const param = (id: string, rotulo: string, input: string, ajuda: string, chave: string) =>
    `<div class="param"><label class="rot" for="${id}">${esc(rotulo)}</label>${input}<div class="rodape-campo">${origem(chave)}${ajuda ? `<span class="ajuda">${esc(ajuda)}</span>` : ''}</div></div>`;
  const perguntas = PERGUNTAS.filter((p) => { const d = REGISTRO_POR_CHAVE.get(p.chave); return d && aplicavel(d, e.modelo); });
  m.innerHTML = `
  ${cabecalho('Gráfica', 'Informe o que a gráfica pediu. O que você não souber fica no padrão de mercado, e os arquivos saem com uma observação para a gráfica confirmar.', ['Baixe as perguntas e envie à gráfica', 'Preencha aqui as respostas', 'Os arquivos se ajustam sozinhos'])}
  <div class="faixa"><div><strong>Não sabe o que perguntar?</strong><span>Baixe uma folha com as perguntas certas para este livro e envie por e-mail à gráfica.</span></div><button id="g-perguntas" class="btn">Baixar perguntas (PDF)</button></div>
  <section class="cartao">
    <header><h2>O que a gráfica informou</h2><p>Cada campo mostra de onde vem o valor: <span class="badge o-projeto">Informado</span> (o que você preencheu) ou <span class="badge o-referencia">Padrão de mercado</span>.</p></header>
    <div class="campos">
      ${param('g-folha', 'Folha de impressão', sel('g-folha', folhasOp, ehOutro ? 'outro' : folhaAtual), 'Tamanho do papel na máquina.', 'maquina.folha.largura')}
      ${ehOutro ? param('g-fw', 'Largura × altura (mm)', `<span class="par-campos">${num('g-fw', Number(val('maquina.folha.largura')?.valor ?? 0) || null)}${num('g-fh', Number(val('maquina.folha.altura')?.valor ?? 0) || null)}</span>`, '', 'maquina.folha.altura') : ''}
      ${perguntas.map((p) => {
        const v = val(p.chave);
        const atual = v?.valor === null || v?.valor === undefined ? '' : Array.isArray(v.valor) ? v.valor.join(', ') : String(v.valor);
        const input = p.opcoes ? sel(`q-${p.chave}`, p.opcoes, atual) : `<input id="q-${p.chave}" value="${esc(atual)}" inputmode="decimal">`;
        return param(`q-${p.chave}`, p.rotulo, input, p.ajuda, p.chave);
      }).join('')}
    </div>
  </section>
  <details class="tecnico"><summary>Todos os parâmetros técnicos</summary><div>
    <p class="nota">Lista completa usada nos cálculos, com a origem de cada valor.</p>
    <div class="tabela-wrap"><table><thead><tr><th>Parâmetro</th><th class="num">Valor</th><th>Origem</th></tr></thead><tbody>
    ${REGISTRO.filter((d) => aplicavel(d, e.modelo)).map((d) => { const v = val(d.chave); const t = v?.valor === null || v?.valor === undefined ? '—' : Array.isArray(v.valor) ? v.valor.join(' / ') : String(v.valor); return `<tr><td>${esc(d.rotulo)}<br><span class="ajuda">${esc(d.ajuda)}</span></td><td class="num mono">${esc(t)}${d.unidade && t !== '—' ? ` ${esc(d.unidade)}` : ''}</td><td><span class="badge o-${v?.origem ?? 'ausente'}">${ORIGEM_ROT[v?.origem ?? 'ausente']}</span></td></tr>`; }).join('')}
    </tbody></table></div>
  </div></details>`;

  on('g-perguntas', 'click', async () => oferecerArquivo(`perguntas-para-a-grafica-${slug()}.pdf`, await gerarPdfTexto(`Perguntas para a gráfica — ${S.entrada.projeto.nome}`, perguntasGrafica(S.entrada, S.r))));
  on('g-folha', 'change', (el) => {
    const limpa = (x: EntradaProjeto) => (x.ajustes = x.ajustes.filter((a) => !a.chave.startsWith('maquina.folha')));
    if (el.value === 'outro') {
      mudar((x) => { limpa(x); x.selecao.folhaMioloId = undefined; const d = { motivo: 'Informado pela gráfica', autor: S.autor || 'sem nome', data: agora() }; x.ajustes.push({ chave: 'maquina.folha.largura', valor: 1000, ...d }, { chave: 'maquina.folha.altura', valor: 700, ...d }); });
      return;
    }
    const [w, h] = el.value.split('x').map(Number) as [number, number];
    const ref = FOLHAS_REFERENCIA.find((f) => f.largura === w && f.altura === h);
    mudar((x) => { limpa(x); x.selecao.folhaMioloId = ref?.id; const d = { motivo: 'Informado pela gráfica', autor: S.autor || 'sem nome', data: agora() }; x.ajustes.push({ chave: 'maquina.folha.largura', valor: w, ...d }, { chave: 'maquina.folha.altura', valor: h, ...d }); }, `Folha de impressão: ${ref?.nome ?? el.value}`, true);
  });
  on('g-fw', 'change', (el) => Number(el.value) > 0 && salvarAjuste('maquina.folha.largura', Number(el.value)));
  on('g-fh', 'change', (el) => Number(el.value) > 0 && salvarAjuste('maquina.folha.altura', Number(el.value)));
  for (const p of perguntas) {
    on(`q-${p.chave}`, 'change', (el) => {
      const d = REGISTRO_POR_CHAVE.get(p.chave)!;
      if (d.tipo === 'lista_numeros') { const l = el.value.split(/[^0-9]+/).map(Number).filter((n) => n > 0); if (l.length) salvarAjuste(p.chave, l); else toast('Informe números separados por vírgula, ex.: 16, 8, 4.', 'err'); return; }
      if (d.tipo === 'numero') { const n = Number(el.value.replace(',', '.')); if (!Number.isFinite(n) || (d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) { toast(`Valor fora da faixa (${d.min} a ${d.max}).`, 'err'); return; } salvarAjuste(p.chave, n); return; }
      salvarAjuste(p.chave, el.value);
    });
  }
  m.querySelectorAll<HTMLButtonElement>('[data-limpar]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.limpar!;
    mudar((x) => (x.ajustes = x.ajustes.filter((a) => (k === 'maquina.folha.largura' ? !a.chave.startsWith('maquina.folha') : a.chave !== k))), 'Valor voltou ao padrão', true);
  }));
}

// ==========================================================================================
// 6. Entregar

const slug = () => S.entrada.projeto.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projeto';
const ETAPA_DO_CODIGO = (cod: string): Etapa => (cod.startsWith('PAG') || cod.startsWith('EDI') ? 'paginas' : cod.startsWith('ARQ') || cod.startsWith('CAP') || cod.startsWith('FIS') ? 'livro' : cod.startsWith('MAQ') || cod.startsWith('CFG') ? 'grafica' : 'montagem');

function vEntregar(m: HTMLElement) {
  const r = S.r;
  const probs = problemas();
  const avisos = r.constatacoes.filter((c) => c.severidade === 'aviso');
  const entrega = String(r.parametros.find((p) => p.chave === 'arquivo.entrega')?.valor ?? 'paginas_individuais');
  const semPdf = !S.pdf;
  const temPares = r.pares.length > 0 && !r.pares[0]!.solta;
  const arquivos: Array<{ id: string; titulo: string; desc: string; ok: boolean; motivo?: string; principal?: boolean }> = [
    { id: 'lado', titulo: 'Miolo lado a lado, pronto para imprimir', desc: 'Páginas em pares de impressão (por exemplo 32|1, 2|31…), com sangria e marcas de corte e dobra. Impressas frente e verso e dobradas ao meio, ficam na ordem de leitura.', ok: !semPdf && temPares, motivo: semPdf ? 'Envie o PDF na etapa Livro.' : 'Este modelo usa folhas soltas: envie páginas individuais.', principal: entrega === 'lado_a_lado' },
    { id: 'ordem', titulo: 'Miolo em páginas individuais', desc: 'Uma página por vez, na ordem de leitura, com sangria e marcas de corte. Para gráficas que fazem a montagem no próprio sistema.', ok: !semPdf && !!r.plano.escolhido, motivo: semPdf ? 'Envie o PDF na etapa Livro.' : 'Complete as páginas.', principal: entrega === 'paginas_individuais' },
    { id: 'folhas', titulo: 'Folhas de impressão montadas', desc: 'As folhas inteiras da máquina, já montadas (veja em Montagem).', ok: !semPdf && r.formas.length > 0, motivo: semPdf ? 'Envie o PDF na etapa Livro.' : 'Defina a folha de impressão.', principal: entrega === 'folhas_montadas' },
    { id: 'capa', titulo: 'Capa aberta', desc: 'Capa com 4ª capa, lombada e 1ª capa, com as medidas calculadas.', ok: !!r.capa.planificacao, motivo: 'Neste modelo a capa faz parte do miolo.' },
    { id: 'espec', titulo: 'Especificações do livro', desc: 'Resumo para enviar junto: tamanho, páginas, papel, lombada e acabamento.', ok: true },
    { id: 'revisao', titulo: 'Duplas de leitura, para revisão', desc: 'O livro como o leitor vê (1 · 2|3 · 4|5…), para revisar antes de enviar. Não é para impressão.', ok: !semPdf && !!r.plano.escolhido, motivo: semPdf ? 'Envie o PDF na etapa Livro.' : 'Complete as páginas.' },
  ];
  arquivos.sort((a, b) => Number(!!b.principal) - Number(!!a.principal));
  m.innerHTML = `
  ${cabecalho('Entregar', 'Baixe os arquivos para enviar à gráfica. O arquivo recomendado segue o que a gráfica pediu na etapa Gráfica.', [])}
  ${probs.length ? `<section class="cartao"><header><h2>Antes de enviar</h2><p>Resolva estes itens. Os arquivos ainda podem ser baixados para conferência, marcados como prévia.</p></header>
    <ul class="pendencias">${probs.map((c) => `<li><span class="tag err">${c.severidade === 'erro' ? 'Corrigir' : 'Falta'}</span><span>${esc(c.mensagem)}</span><a class="btn mini sec" href="#${ETAPA_DO_CODIGO(c.codigo)}">Abrir</a></li>`).join('')}</ul></section>`
    : `<div class="faixa ${r.nivel === 'validado_parametros' ? 'ok' : 'warn'}"><div><strong>${r.nivel === 'validado_parametros' ? 'Tudo certo para enviar' : 'Pronto para enviar · peça para a gráfica confirmar'}</strong><span>${r.nivel === 'validado_parametros' ? 'Todos os parâmetros foram informados.' : 'Alguns valores usam o padrão de mercado; os arquivos saem com essa observação fora da área de corte.'}</span></div></div>`}
  <section class="cartao"><header><h2>Arquivos (PDF)</h2></header>
    <div class="arquivos">${arquivos.map((a) => `<div class="arq${a.principal ? ' principal' : ''}"><div>${a.principal ? '<span class="rec">Recomendado para esta gráfica</span><br>' : ''}<strong>${a.titulo}</strong><p>${a.ok ? a.desc : esc(a.motivo ?? '')}</p></div><button class="btn${a.principal ? '' : ' sec'}" data-baixar="${a.id}" ${a.ok ? '' : 'disabled'}>Baixar PDF</button></div>`).join('')}</div>
  </section>
  ${avisos.length ? `<details class="tecnico"><summary>Observações (${avisos.length})</summary><div><ul class="constat">${avisos.map((c) => `<li class="aviso">${esc(c.mensagem)}</li>`).join('')}</ul></div></details>` : ''}
  ${r.consumo.miolo ? `<details class="tecnico"><summary>Estimativa de papel</summary><div>
    <p class="nota">Estimativa para conversar com a gráfica, não é orçamento. ${r.consumo.miolo.premissas.map(esc).join(' ')}</p>
    <div class="infos"><div class="info"><span class="k">Folhas do miolo</span><span class="v mono">${r.consumo.miolo.totalFolhas.toLocaleString('pt-BR')}</span></div>
    <div class="info"><span class="k">Peso do papel</span><span class="v mono">${n2(r.consumo.miolo.totalPesoKg)} kg</span></div>
    ${r.consumo.capa ? `<div class="info"><span class="k">Folhas da capa</span><span class="v mono">${r.consumo.capa.totalFolhas.toLocaleString('pt-BR')}</span></div>` : ''}</div>
  </div></details>` : ''}
  <details class="tecnico"><summary>Detalhes técnicos da verificação</summary><div>
    <ul class="constat">${r.constatacoes.map((c) => `<li class="${c.severidade}"><span class="cod">${esc(c.codigo)}</span>${esc(c.mensagem)}${c.evidencia ? ` <span class="ajuda">${esc(c.evidencia)}</span>` : ''}</li>`).join('')}</ul>
    <p class="nota mono">motor ${r.versaoMotor} · ${r.versaoRegra} · ${r.hashEntrada.slice(0, 16)}</p>
  </div></details>`;

  const sang = Number(r.parametros.find((p) => p.chave === 'arquivo.sangria')?.valor ?? 3);
  const creepFolha = r.fisica.creepPorFolha.valor ?? 0;
  const v = `v${S.entrada.projeto.versao}`;
  const gera: Record<string, [string, () => Promise<Uint8Array>]> = {
    lado: [`${slug()}-${v}-miolo-lado-a-lado.pdf`, () => gerarPdfLadoALado(S.pdf!.bytes, S.entrada, S.r, { sangria: sang, modo: 'impressao', creepMmPorFolha: creepFolha })],
    ordem: [`${slug()}-${v}-miolo-paginas.pdf`, () => gerarPdfOrdemLeitura(S.pdf!.bytes, S.entrada, S.r, { marcas: true, sangria: sang })],
    folhas: [`${slug()}-${v}-folhas-montadas.pdf`, () => gerarPdfImposto(S.pdf!.bytes, S.entrada, S.r, { rotularBrancos: false })],
    capa: [`${slug()}-${v}-capa-aberta.pdf`, () => capaBytes()],
    espec: [`${slug()}-${v}-especificacoes.pdf`, () => gerarPdfTexto(`Especificações do livro — ${S.entrada.projeto.nome}`, especificacoes(S.entrada, S.r))],
    revisao: [`${slug()}-${v}-duplas-de-leitura.pdf`, () => gerarPdfLadoALado(S.pdf!.bytes, S.entrada, S.r, { sangria: sang, modo: 'leitura' })],
  };
  m.querySelectorAll<HTMLButtonElement>('[data-baixar]').forEach((b) => b.addEventListener('click', async () => {
    const [nome, fn] = gera[b.dataset.baixar!]!;
    const t = b.textContent; b.disabled = true; b.textContent = 'Gerando…';
    try { const bytes = await fn(); registrar(`Arquivo gerado: ${nome}`); salvarLocal(); await oferecerArquivo(nome, bytes); } catch (e) { toast((e as Error).message, 'err'); }
    b.disabled = false; b.textContent = t;
  }));
}

async function capaBytes(): Promise<Uint8Array> {
  const capa = S.r.componentes.capa;
  const ref = (papel: string) => capa?.find((p) => p.papel === papel && p.origem && p.tipo !== 'branco')?.origem;
  const faces = S.pdf && capa ? { origemBytes: S.pdf.bytes, externa: { primeira: ref('1a_capa'), quarta: ref('4a_capa') }, interna: { segunda: ref('2a_capa'), terceira: ref('3a_capa') } } : undefined;
  return gerarPdfCapa(S.r.capa.planificacao!, S.entrada, S.r, faces);
}

// ==========================================================================================
// Início

function iniciar() {
  recalcular();
  render();
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });
  document.addEventListener('keydown', (ev) => {
    if (etapaAtual() !== 'conferir' || S.modoLeitura !== 'leitor' || (ev.target as HTMLElement).closest('input,select,textarea')) return;
    const rtl = S.entrada.direcao === 'rtl';
    if (ev.key === 'ArrowRight') { ev.preventDefault(); navegar(rtl ? -1 : 1); }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); navegar(rtl ? 1 : -1); }
  });
}
iniciar();
