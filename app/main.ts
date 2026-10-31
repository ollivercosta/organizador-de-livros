/**
 * Protótipo da Plataforma de Produção Editorial e Gráfica.
 * A interface só exibe e edita a ENTRADA do motor; todo cálculo vem de executarMotor (RN-014).
 */

import { MODELOS, type ModeloCapa, type ModeloId, type Montagem } from '../src/binding/models.js';
import { inserirBrancos, registrarPaginas, removerPagina, type PosicaoBranco } from '../src/binding/pagination.js';
import { PERFIL_EXEMPLO } from '../src/config/exemplo.js';
import { gerarModeloPerfil, validarPerfil, type AjusteProjeto, type PerfilGrafica, type ValorParam } from '../src/config/profile.js';
import { REGISTRO, REGISTRO_POR_CHAVE, aplicavel } from '../src/config/registry.js';
import type { Material } from '../src/cover/physics.js';
import { executarMotor, type EntradaProjeto, type ResultadoMotor } from '../src/engine.js';
import { pdfAmostra } from '../src/pdf/amostra.js';
import { gerarPdfCapa, gerarPdfImposto, inspecionarPdf } from '../src/pdf/impose.js';
import type { Forma, Posicionamento } from '../src/press/layout.js';
import { fichaTecnica, mapaCsv } from '../src/report/export.js';

// ------------------------------------------------------------------------------------------
// Estado

interface PdfCarregado { nome: string; bytes: Uint8Array; paginas: number }
interface Estado {
  entrada: EntradaProjeto;
  pdf: PdfCarregado | null;
  autor: string;
  pagina: number | null; // página do miolo selecionada
  forma: string | null;
  lado: 'A' | 'B';
  vista: number; // índice da dupla de leitura
  eventos: Array<{ data: string; autor: string; texto: string }>;
  r: ResultadoMotor;
}

const agora = () => new Date().toISOString();
const ARQ = 'livro.pdf';

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
    perfil: PERFIL_EXEMPLO,
    selecao: { maquinaId: 'of-4c', folhaMioloId: '66x96', folhaCapaId: '48x66', papelMioloId: 'couche-fosco-115', papelCapaId: 'triplex-250', papelGuardaId: 'offset-150' },
    ajustes: [],
  };
}

function carregarLocal(): Partial<Estado> | null {
  try {
    const t = localStorage.getItem('pepg.projeto.v2');
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}
function salvarLocal() {
  try {
    localStorage.setItem('pepg.projeto.v2', JSON.stringify({ entrada: S.entrada, autor: S.autor, eventos: S.eventos }));
  } catch { /* armazenamento indisponível: segue sem persistir */ }
}

const salvo = carregarLocal();
const S: Estado = {
  entrada: salvo?.entrada ?? entradaInicial(),
  pdf: null,
  autor: salvo?.autor ?? '',
  pagina: null, forma: null, lado: 'A', vista: 0,
  eventos: salvo?.eventos ?? [],
  r: null as unknown as ResultadoMotor,
};

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
}

// ------------------------------------------------------------------------------------------
// Utilidades de DOM

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n2 = (v: number | null | undefined, c = 2) => (v === null || v === undefined ? '—' : Number(v.toFixed(c)).toLocaleString('pt-BR'));

const ORIGEM_ROT: Record<string, string> = { projeto: 'Projeto', grafica: 'Gráfica', generico: 'Genérico', ausente: 'Pendente', calculado: 'Calculado' };
const SEV_ROT: Record<string, string> = { erro: 'Erro', pendencia: 'Pendência', aviso: 'Aviso', nao_verificavel: 'Não verificável', info: 'Info' };
const NIVEL_CLASSE: Record<string, string> = { bloqueado: 'err', previa_generica: 'warn', validado_parametros: 'ok' };
const NIVEL_CURTO: Record<string, string> = { bloqueado: 'Bloqueado', previa_generica: 'Prévia genérica', validado_parametros: 'Validado p/ parâmetros' };

let toastTimer = 0;
function toast(msg: string, tipo: 'ok' | 'err' = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.className = 'toast'), 4200);
}

// Download: capacidade `downloads` quando publicada; link local quando aberta como arquivo.
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
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ------------------------------------------------------------------------------------------
// Miniaturas reais (pdf.js no thread principal, carregado do cdnjs)

const thumbs = new Map<number, string>();
let pdfjsDoc: { numPages: number; getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; render(o: unknown): { promise: Promise<void> } }> } | null = null;
let filaThumbs: Promise<void> = Promise.resolve();

async function abrirPdfjs(bytes: Uint8Array) {
  const lib = (window as unknown as { pdfjsLib?: { getDocument(o: unknown): { promise: Promise<typeof pdfjsDoc> } } }).pdfjsLib;
  thumbs.clear();
  pdfjsDoc = null;
  if (!lib) return;
  try {
    pdfjsDoc = await lib.getDocument({ data: bytes.slice(0) }).promise;
  } catch { pdfjsDoc = null; }
}

function pedirThumb(indice: number) {
  if (!pdfjsDoc || thumbs.has(indice) || indice >= pdfjsDoc.numPages) return;
  thumbs.set(indice, '');
  filaThumbs = filaThumbs.then(async () => {
    try {
      const p = await pdfjsDoc!.getPage(indice + 1);
      const vp0 = p.getViewport({ scale: 1 });
      const scale = 360 / Math.max(vp0.width, vp0.height);
      const vp = p.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await p.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      thumbs.set(indice, c.toDataURL('image/jpeg', 0.82));
      agendarRender();
    } catch { thumbs.set(indice, 'erro'); }
  });
}

let renderAgendado = 0;
function agendarRender() {
  if (renderAgendado) return;
  renderAgendado = window.setTimeout(() => { renderAgendado = 0; render(); }, 120);
}

/** Página do miolo → índice da página no arquivo de origem (null para brancos). */
function origemDaPagina(pg: number): number | null {
  const reg = S.r.componentes.miolo[pg - 1];
  return reg && reg.tipo !== 'branco' && reg.origem ? reg.origem.indice : null;
}
function thumbDe(indiceOrigem: number | null): string | null {
  if (indiceOrigem === null || !S.pdf) return null;
  pedirThumb(indiceOrigem);
  const t = thumbs.get(indiceOrigem);
  return t && t !== 'erro' ? t : null;
}

// ------------------------------------------------------------------------------------------
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
const rotaAtual = (): Rota => {
  const h = location.hash.replace('#', '');
  return (ROTAS.find(([k]) => k === h)?.[0] ?? 'projeto') as Rota;
};

function render() {
  const r = S.r;
  const erros = r.constatacoes.filter((c) => c.severidade === 'erro').length;
  const pend = r.constatacoes.filter((c) => c.severidade === 'pendencia').length;
  $('#status').innerHTML = `
    <div class="st-proj"><strong>${esc(S.entrada.projeto.nome)}</strong><span class="mono">v${S.entrada.projeto.versao} · ${esc(MODELOS[S.entrada.modelo].nome)} · ${S.entrada.formato.largura}×${S.entrada.formato.altura} mm</span></div>
    <div class="st-nivel"><span class="pill ${NIVEL_CLASSE[r.nivel]}">${NIVEL_CURTO[r.nivel]}</span>
    ${erros ? `<a class="cnt err" href="#saida">${erros} erro${erros > 1 ? 's' : ''}</a>` : ''}
    ${pend ? `<a class="cnt pend" href="#saida">${pend} pendência${pend > 1 ? 's' : ''}</a>` : ''}</div>`;
  const rota = rotaAtual();
  document.querySelectorAll<HTMLAnchorElement>('#nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.r === rota ? 'page' : 'false'));
  const main = $('#main');
  main.innerHTML = '';
  ({ projeto: vProjeto, grafica: vGrafica, paginacao: vPaginacao, leitura: vLeitura, imposicao: vImposicao, capa: vCapa, saida: vSaida } as Record<Rota, (m: HTMLElement) => void>)[rota](main);
}

// ------------------------------------------------------------------------------------------
// Componentes de formulário

function campo(label: string, input: string, ajuda = '') {
  return `<label class="campo"><span class="rot">${esc(label)}</span>${input}${ajuda ? `<span class="ajuda">${esc(ajuda)}</span>` : ''}</label>`;
}
function sel(id: string, opcoes: Array<[string, string]>, valor: string) {
  return `<select id="${id}">${opcoes.map(([v, t]) => `<option value="${esc(v)}"${v === valor ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
}
function num(id: string, valor: number | undefined | null, extra = '') {
  return `<input id="${id}" type="number" inputmode="decimal" value="${valor ?? ''}" ${extra}>`;
}
function on(id: string, ev: string, fn: (el: HTMLInputElement & HTMLSelectElement) => void) {
  const el = document.getElementById(id) as (HTMLInputElement & HTMLSelectElement) | null;
  el?.addEventListener(ev, () => fn(el));
}

const ROT_CAPA: Record<ModeloCapa, string> = {
  autocapa: 'Autocapa (mesmo papel do miolo)', separada_flexivel: 'Capa separada flexível', capa_dura: 'Capa dura (caixa)', folhas_de_capa: 'Folhas de capa (wire-o/espiral)', sem_capa: 'Sem capa',
};
const ROT_MONT: Record<Montagem, string> = { aninhada: 'Cadernos aninhados', alcada: 'Cadernos alçados', folhas: 'Folhas soltas', sanfona: 'Sanfona' };

// ------------------------------------------------------------------------------------------
// Vista: Projeto

function vProjeto(m: HTMLElement) {
  const e = S.entrada;
  const mod = MODELOS[e.modelo];
  const montagens: Montagem[] = [mod.montagem, ...(mod.montagensAlternativas ?? [])];
  const papeis = e.perfil?.papeis ?? [];
  const opPapel: Array<[string, string]> = [['', 'Informar manualmente'], ...papeis.map((p): [string, string] => [p.id, `${p.nome}${p.calibreUm ? ` · ${p.calibreUm} µm` : ''}`])];
  m.innerHTML = `
  <header class="sec"><h1>Projeto</h1><p>Defina o produto. Toda medida entra em milímetros e cada alteração recalcula a imposição.</p></header>
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
      ${e.capa.modelo !== 'autocapa' && e.capa.modelo !== 'sem_capa' ? campo('Onde estão as faces da capa', sel('p-capa-fonte', [['no_pdf', 'No PDF do miolo (início e fim)'], ['arquivo_separado', 'Arquivo separado'], ['nao_impressa', 'Capa sem impressão']], e.capa.fonte.fonte)) : ''}
      ${e.capa.fonte.fonte === 'no_pdf' && e.capa.modelo !== 'autocapa' && e.capa.modelo !== 'sem_capa' ? campo('Faces da capa no PDF', sel('p-capa-faces', [['4', '4 faces (1ª, 2ª … 3ª, 4ª)'], ['2', '2 faces (1ª … 4ª; internas sem impressão)']], String(e.capa.fonte.facesNoPdf ?? 4)), 'Declarar evita contar capa como miolo (RN-006).') : ''}
      ${mod.orelhas && e.capa.modelo === 'separada_flexivel' ? campo('Orelhas (mm, 0 = sem)', num('p-orelha', e.capa.orelha ?? 0, 'min="0"')) : ''}
      ${mod.sobrecapa && e.capa.modelo === 'capa_dura' ? `<label class="check"><input id="p-sobre" type="checkbox"${e.capa.sobrecapa ? ' checked' : ''}> Sobrecapa</label>${e.capa.sobrecapa ? campo('Orelha da sobrecapa (mm)', num('p-sobre-orelha', e.capa.sobrecapaOrelha ?? 80)) : ''}` : ''}
      <h2>Tiragem e cores</h2>
      <div class="lado">
        ${campo('Tiragem (exemplares)', num('p-tir', e.tiragem ?? null, 'min="1" step="1"'))}
        ${campo('Cores miolo (frente × verso)', `<span class="lado mini">${num('p-cmf', e.cores.mioloFrente, 'min="0" max="12"')}${num('p-cmv', e.cores.mioloVerso, 'min="0" max="12"')}</span>`)}
      </div>
    </div>
  </section>
  <section class="painel grid2">
    <div class="grupo">
      <h2>Papéis</h2>
      ${campo('Papel do miolo', sel('p-papel-m', opPapel, e.selecao.papelMioloId ?? ''))}
      ${!e.selecao.papelMioloId ? papelManual('m', e.papeis.miolo) : ''}
      ${e.capa.modelo !== 'autocapa' && e.capa.modelo !== 'sem_capa' ? campo('Papel da capa', sel('p-papel-c', opPapel, e.selecao.papelCapaId ?? '')) + (!e.selecao.papelCapaId ? papelManual('c', e.papeis.capa) : '') : ''}
      ${mod.guardas ? campo('Papel das guardas', sel('p-papel-g', opPapel, e.selecao.papelGuardaId ?? '')) : ''}
      <p class="nota">Papéis vêm do perfil da gráfica. Gramatura sozinha não determina espessura: sem calibre, lombada e creep ficam pendentes.</p>
    </div>
    <div class="grupo">
      <h2>Arquivo de origem</h2>
      ${S.pdf ? `<p class="arq"><strong>${esc(S.pdf.nome)}</strong> · ${S.pdf.paginas} páginas</p>` : `<p class="arq">Nenhum PDF carregado — o projeto usa ${e.paginas.filter((p) => p.tipo === 'conteudo').length} páginas simuladas.</p>`}
      <div class="acoes">
        <label class="btn"><input id="p-pdf" type="file" accept="application/pdf" hidden>Carregar PDF</label>
        <button id="p-amostra" class="btn sec">Gerar PDF de exemplo</button>
        ${!S.pdf ? `<span class="lado mini">${num('p-npag', e.paginas.filter((p) => p.tipo === 'conteudo').length, 'min="1" step="1" aria-label="Páginas simuladas"')}<button id="p-sim" class="btn sec">Simular páginas</button></span>` : ''}
      </div>
      <p class="nota">O PDF fica apenas neste navegador. Páginas na ordem de leitura; TrimBox e BleedBox são lidas para conferir formato e sangria.</p>
      <h2>Responsável pelas alterações</h2>
      ${campo('Seu nome (registrado em ajustes e brancos)', `<input id="p-autor" value="${esc(S.autor)}" placeholder="Nome">`)}
      <div class="acoes"><button id="p-reset" class="btn sec">Restaurar exemplo</button></div>
    </div>
  </section>`;

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
  on('p-autor', 'change', (el) => { S.autor = el.value.trim(); salvarLocal(); });
  on('p-pdf', 'change', async (el) => { const f = el.files?.[0]; if (f) await carregarPdf(f.name, new Uint8Array(await f.arrayBuffer())); });
  on('p-amostra', 'click', async () => {
    const n = S.entrada.paginas.filter((p) => p.tipo === 'conteudo').length || 30;
    const bytes = await pdfAmostra(n, S.entrada.formato.largura, S.entrada.formato.altura, 3);
    await carregarPdf(`exemplo-${n}pp.pdf`, bytes);
  });
  on('p-sim', 'click', () => {
    const n = Math.max(1, Math.floor(Number(($('#p-npag') as HTMLInputElement).value) || 1));
    mudar((x) => (x.paginas = registrarPaginas(ARQ, n)), `Páginas simuladas: ${n}`, true);
  });
  on('p-reset', 'click', () => { S.entrada = entradaInicial(); S.pdf = null; thumbs.clear(); pdfjsDoc = null; registrar('Projeto restaurado para o exemplo'); recalcular(); render(); });
}

function papelManual(k: 'm' | 'c', mat: Material | undefined) {
  return `<div class="lado">${campo('Gramatura (g/m²)', num(`p-g-${k}`, mat?.gramatura.valor ?? null, 'min="1"'))}${campo('Calibre (µm)', num(`p-cal-${k}`, mat?.calibreUm.valor ?? null, 'min="1"'))}</div>`;
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

async function carregarPdf(nome: string, bytes: Uint8Array) {
  try {
    const insp = await inspecionarPdf(bytes);
    S.pdf = { nome, bytes, paginas: insp.paginas };
    await abrirPdfjs(bytes);
    const conteudoAtual = S.entrada.paginas.filter((p) => p.tipo === 'conteudo').length;
    const preserva = conteudoAtual === insp.paginas;
    const brancosAntes = S.entrada.paginas.length - conteudoAtual;
    mudar((x) => {
      if (preserva) {
        // Mesmo número de páginas de conteúdo: mantém a estrutura aprovada (brancos) e remapeia a origem.
        let k = 0;
        x.paginas = x.paginas.map((p) => (p.tipo === 'branco' ? p : { ...p, id: `${ARQ}#${k + 1}`, origem: { arquivo: ARQ, indice: k }, rotulo: `Pág. ${++k} de ${nome}` }));
      } else {
        x.paginas = registrarPaginas(ARQ, insp.paginas).map((p) => ({ ...p, rotulo: `Pág. ${p.origem!.indice + 1} de ${nome}` }));
      }
      x.dimensoesOrigem = insp.dimensoes;
    }, `PDF importado: ${nome} (${insp.paginas} páginas)${preserva && brancosAntes ? `; ${brancosAntes} branco(s) aprovado(s) mantido(s)` : ''}`, true);
    const semTrim = insp.dimensoes.filter((d) => !d.temTrimBox).length;
    toast(`${nome}: ${insp.paginas} páginas importadas${preserva && brancosAntes ? ` · ${brancosAntes} branco(s) aprovado(s) mantido(s)` : !preserva && brancosAntes ? ` · paginação refeita: o número de páginas mudou, revise os brancos` : ''}${semTrim ? ` · ${semTrim} sem TrimBox (usada a MediaBox)` : ''}.`);
  } catch (e) {
    toast(`Não foi possível ler o PDF: ${(e as Error).message}`, 'err');
  }
}

// ------------------------------------------------------------------------------------------
// Vista: Configuração da gráfica

function badge(origem: string) {
  return `<span class="badge o-${origem}">${ORIGEM_ROT[origem] ?? origem}</span>`;
}

function vGrafica(m: HTMLElement) {
  const e = S.entrada;
  const p = e.perfil;
  const grupos = [...new Set(REGISTRO.map((d) => d.grupo))];
  const valorTxt = (v: ValorParam | null) => (v === null ? '—' : Array.isArray(v) ? v.join(' / ') : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v));
  const editando = (m.dataset.edit ?? '') as string;
  m.innerHTML = `
  <header class="sec"><h1>Configuração da gráfica</h1>
  <p>A gráfica envia um perfil técnico (arquivo JSON). Ele preenche máquinas, folhas, papéis, esquemas de dobra e tolerâncias. Quando faltar algo ou a gráfica informar outro valor para este trabalho, ajuste no projeto com o motivo. A ordem de uso é: <strong>ajuste do projeto → perfil da gráfica → valor genérico → pendente</strong>.</p></header>
  <section class="painel grid2">
    <div class="grupo">
      <h2>Perfil importado</h2>
      ${p ? `<dl class="dl">
        <dt>Gráfica</dt><dd>${esc(p.grafica)}</dd><dt>Versão</dt><dd class="mono">v${esc(p.versao)} · ${esc(p.emitidoEm)}</dd>
        <dt>Responsável</dt><dd>${esc(p.responsavel ?? '—')}</dd><dt>Conteúdo</dt><dd>${p.maquinas.length} máquina(s), ${p.folhas.length} folha(s), ${p.papeis.length} papel(éis), ${p.esquemasDobra.length} esquema(s) próprio(s)</dd></dl>
        ${p.observacoes ? `<p class="nota">${esc(p.observacoes)}</p>` : ''}` : '<p class="vazio">Nenhum perfil importado. Sem ele, só é possível prévia genérica com ajustes manuais.</p>'}
      <div class="acoes">
        <label class="btn"><input id="g-imp" type="file" accept="application/json,.json" hidden>Importar perfil da gráfica</label>
        <button id="g-modelo" class="btn sec">Baixar modelo para a gráfica preencher</button>
        ${p ? '<button id="g-exp" class="btn sec">Exportar perfil</button><button id="g-rem" class="btn sec perigo">Remover perfil</button>' : ''}
      </div>
      <div id="g-erros"></div>
    </div>
    <div class="grupo">
      <h2>Seleção para este projeto</h2>
      ${campo('Máquina', sel('g-maq', [['', '—'], ...(p?.maquinas ?? []).map((x): [string, string] => [x.id, x.nome])], e.selecao.maquinaId ?? ''))}
      ${campo('Folha do miolo', sel('g-fm', [['', '—'], ...(p?.folhas ?? []).map((x): [string, string] => [x.id, `${x.nome} · fibra ${x.fibra ?? '?'}`])], e.selecao.folhaMioloId ?? ''))}
      ${campo('Folha da capa', sel('g-fc', [['', 'Mesma do miolo'], ...(p?.folhas ?? []).map((x): [string, string] => [x.id, x.nome])], e.selecao.folhaCapaId ?? ''))}
      <p class="nota">Esquemas de dobra disponíveis: catálogo base (F4, F8-AR, F8-PAR, F12-MX, F16-AR, F16-PAR, F24-MX, F32-AR, F64-AR)${p?.esquemasDobra.length ? ` e da gráfica (${p.esquemasDobra.map((x) => esc(x.id)).join(', ')})` : ''}. Toda imposição é derivada por simulação da dobra.</p>
    </div>
  </section>
  ${grupos.map((g) => {
    const defs = REGISTRO.filter((d) => d.grupo === g && aplicavel(d, e.modelo));
    if (!defs.length) return '';
    return `<section class="painel"><h2>${esc(g)}</h2><div class="tabela-wrap"><table class="params">
      <thead><tr><th>Parâmetro</th><th class="num">Valor</th><th>Origem</th><th></th></tr></thead><tbody>
      ${defs.map((d) => {
        const v = S.r.parametros.find((x) => x.chave === d.chave);
        const ed = editando === d.chave;
        return `<tr class="${v?.status === 'pendente' ? 'pend' : ''}">
          <td><span class="pnome">${d.critico ? '<abbr title="Crítico para produção" class="crit">●</abbr> ' : ''}${esc(d.rotulo)}</span><span class="ajuda">${esc(d.ajuda)}</span></td>
          <td class="num mono">${esc(valorTxt(v?.valor ?? null))}${d.unidade && v?.valor !== null ? ` <span class="un">${esc(d.unidade)}</span>` : ''}</td>
          <td>${badge(v?.origem ?? 'ausente')}${v?.origem === 'projeto' ? `<span class="ajuda">${esc(v.fonte?.replace('Ajuste no projeto: ', '') ?? '')} · ${esc(v.autor ?? '')}</span>` : ''}</td>
          <td class="acao">${ed ? '' : `<button class="btn mini sec" data-edit="${esc(d.chave)}">Ajustar</button>`}</td></tr>
          ${ed ? `<tr class="editor"><td colspan="4"><form id="g-form" class="lado">
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
  const form = document.getElementById('g-form') as HTMLFormElement | null;
  form?.addEventListener('submit', (ev) => {
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
  on('g-rem', 'click', () => mudar((x) => { x.perfil = null; x.selecao = {}; }, 'Perfil da gráfica removido', true));
  on('g-imp', 'change', async (el) => {
    const f = el.files?.[0];
    if (!f) return;
    let dados: unknown;
    try { dados = JSON.parse(await f.text()); } catch { toast('O arquivo não é um JSON válido.', 'err'); return; }
    const { perfil, erros } = validarPerfil(dados);
    if (!perfil) {
      $('#g-erros').innerHTML = `<div class="alerta err"><strong>Perfil recusado — ${erros.length} problema(s):</strong><ul>${erros.slice(0, 20).map((x) => `<li><span class="mono">${esc(x.caminho)}</span>: ${esc(x.mensagem)}</li>`).join('')}</ul></div>`;
      return;
    }
    importarPerfil(perfil);
  });
}

function importarPerfil(p: PerfilGrafica) {
  mudar((x) => {
    x.perfil = p;
    x.selecao = {
      maquinaId: p.maquinas[0]?.id, folhaMioloId: p.folhas[0]?.id, folhaCapaId: undefined,
      papelMioloId: undefined, papelCapaId: undefined, papelGuardaId: undefined,
    };
  }, `Perfil importado: ${p.grafica} v${p.versao}`, true);
  toast(`Perfil de ${p.grafica} (v${p.versao}) importado. Selecione papéis no Projeto.`);
}

function entradaParam(chave: string, atual: ValorParam | null) {
  const d = REGISTRO_POR_CHAVE.get(chave)!;
  const v = atual === null ? '' : Array.isArray(atual) ? atual.join('/') : String(atual);
  if (d.tipo === 'opcao') return sel('g-valor', d.opcoes!.map((o) => [o, o]), v);
  if (d.tipo === 'booleano') return sel('g-valor', [['true', 'sim'], ['false', 'não']], v || 'true');
  if (d.tipo === 'numero') return `<input id="g-valor" type="number" step="any" value="${esc(v)}" ${d.min !== undefined ? `min="${d.min}"` : ''} ${d.max !== undefined ? `max="${d.max}"` : ''} required>`;
  return `<input id="g-valor" value="${esc(v)}" required>`;
}

// ------------------------------------------------------------------------------------------
// Vista: Paginação

function vPaginacao(m: HTMLElement) {
  const r = S.r;
  const e = S.entrada;
  const pag = r.constatacoes.find((c) => c.codigo === 'PAG-001');
  const modelo = MODELOS[e.modelo];
  const autocapa = e.capa.modelo === 'autocapa';
  const capaNoPdf = !autocapa && e.capa.fonte.fonte === 'no_pdf' && e.capa.modelo !== 'sem_capa';
  const posPadrao: PosicaoBranco['tipo'] = autocapa || capaNoPdf ? 'antes_da_contracapa' : 'fim';
  m.innerHTML = `
  <header class="sec"><h1>Paginação</h1><p>Ordem de leitura do arquivo e estrutura física. Nenhuma página é adicionada ou removida sem a sua confirmação.</p></header>
  <section class="painel resumo">
    <div><span class="k">Arquivo</span><span class="v mono">${e.paginas.length} pp</span></div>
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
      ${campo('Posição dos brancos', sel('pg-pos', [['fim', autocapa || capaNoPdf ? 'No fim do miolo (antes da 3ª/4ª capa)' : 'No fim'], ['inicio', autocapa || capaNoPdf ? 'No início do miolo (após 1ª/2ª capa)' : 'No início']], posPadrao === 'antes_da_contracapa' ? 'fim' : posPadrao))}
      ${campo('Motivo', `<input id="pg-mot" value="Completar ${r.montagem === 'folhas' ? 'folha' : 'caderno'} exigido pelo acabamento">`)}
      <span class="acoes"><button class="btn" type="submit">Aplicar ajuste</button></span>
    </form>
    <p class="nota">Cadernos que não cabem na folha configurada já foram excluídos das opções. Remover conteúdo exige nova versão do arquivo.</p>
  </section>` : r.plano.escolhido ? `<section class="painel"><h2>Plano de cadernos</h2>
    <p>${r.plano.escolhido.length} unidade(s): ${r.unidades.map((u) => `<span class="chip mono">${u.indice + 1}: ${u.tamanho} pp · ${esc(u.layout.esquema.id)}</span>`).join(' ')}</p>
    ${r.montagem === 'aninhada' ? '<p class="nota">Aninhados: o caderno 1 é o mais externo; os seguintes entram no centro.</p>' : r.montagem === 'alcada' ? '<p class="nota">Alçados: cadernos empilhados em sequência; marcas de colação no dorso conferem a ordem.</p>' : ''}
  </section>` : ''}
  <section class="painel"><h2>Páginas do miolo</h2>
    <div class="tabela-wrap"><table class="paginas"><thead><tr><th class="num">Pág.</th><th>Rótulo</th><th>Tipo</th><th>Origem</th><th>Na imposição</th><th></th></tr></thead><tbody>
    ${r.componentes.miolo.map((p, i) => {
      const mp = r.mapa[i];
      return `<tr class="${p.tipo === 'branco' ? 'branco' : ''}${S.pagina === i + 1 ? ' sel' : ''}">
        <td class="num mono">${i + 1}</td><td>${esc(p.papel !== 'miolo' ? p.papel.replace('a_capa', 'ª capa') : p.rotulo ?? '')}${p.motivo ? `<span class="ajuda">${esc(p.motivo)} · ${esc(p.autor ?? '')}</span>` : ''}</td>
        <td>${p.tipo === 'branco' ? '<span class="badge o-generico">Branco</span>' : 'Conteúdo'}</td>
        <td class="mono">${p.origem ? `arquivo p.${p.origem.indice + 1}` : '—'}</td>
        <td class="mono">${mp?.forma ? `<a href="#imposicao" data-ir="${i + 1}">${esc(mp.forma)} · ${mp.lado} · pos ${(mp.posicao ?? 0) + 1}${mp.rotacao ? ` · ${mp.rotacao}°` : ''}</a>` : mp?.celula ? `cad. ${mp.unidade + 1} · ${mp.celula.face === 'F' ? 'frente' : 'verso'} (${mp.celula.col + 1},${mp.celula.row + 1})` : '—'}</td>
        <td>${p.tipo === 'branco' ? `<button class="btn mini sec" data-remb="${esc(p.id)}">Remover</button>` : ''}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    ${r.componentes.capa ? `<h3>Capa (componente separado)</h3><p class="mono">${r.componentes.capa.map((p) => `${p.papel.replace('a_capa', 'ª capa')}: ${p.origem ? `arquivo p.${p.origem.indice + 1}` : 'sem impressão'}`).join(' · ')}</p>` : ''}
  </section>`;

  m.querySelectorAll<HTMLAnchorElement>('[data-ir]').forEach((a) => a.addEventListener('click', () => irParaPagina(Number(a.dataset.ir))));
  m.querySelectorAll<HTMLButtonElement>('[data-remb]').forEach((b) => b.addEventListener('click', () => {
    // O branco pode estar no registro do arquivo (antes da separação capa/miolo)
    mudar((x) => (x.paginas = removerPagina(x.paginas, b.dataset.remb!)), 'Página em branco removida', true);
  }));
  const f = document.getElementById('pg-form') as HTMLFormElement | null;
  f?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const ops = r.plano.opcoes.filter((o) => o.ajuste !== 0);
    const op = ops[Number(($('#pg-op') as HTMLSelectElement).value)];
    const motivo = ($('#pg-mot') as HTMLInputElement).value.trim();
    if (!op) return;
    if (!motivo) { toast('Informe o motivo.', 'err'); return; }
    const pos = ($('#pg-pos') as HTMLSelectElement).value as PosicaoBranco['tipo'];
    if (op.ajuste > 0) {
      // A posição é relativa ao arquivo (as faces da capa no PDF continuam nas extremidades).
      // Faces da capa no PDF ficam nas extremidades: os brancos entram sempre dentro do miolo.
      const n = e.paginas.length;
      const facesIni = autocapa ? 2 : capaNoPdf ? (e.capa.fonte.facesNoPdf === 2 ? 1 : 2) : 0;
      const facesFim = autocapa ? 2 : capaNoPdf ? (e.capa.fonte.facesNoPdf === 2 ? 1 : 2) : 0;
      const posicao: PosicaoBranco = pos === 'inicio' ? (facesIni ? { tipo: 'apos_indice', indice: facesIni - 1 } : { tipo: 'inicio' })
        : facesFim ? { tipo: 'apos_indice', indice: n - facesFim - 1 } : { tipo: 'fim' };
      mudar((x) => (x.paginas = inserirBrancos(x.paginas, op.ajuste, posicao, motivo, S.autor || 'sem nome', agora())),
        `${op.ajuste} página(s) em branco inserida(s): ${motivo}`, true);
    } else {
      let rest = -op.ajuste;
      mudar((x) => {
        for (let i = x.paginas.length - 1; i >= 0 && rest > 0; i--) if (x.paginas[i]!.tipo === 'branco') { x.paginas.splice(i, 1); rest--; }
      }, `${-op.ajuste} página(s) em branco removida(s)`, true);
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

// ------------------------------------------------------------------------------------------
// Vista: Leitura

function paginaVisual(faceIdx: number | null) {
  const W = S.entrada.formato.largura, H = S.entrada.formato.altura;
  if (faceIdx === null) return `<div class="pg vazia" style="aspect-ratio:${W}/${H}"></div>`;
  const f = S.r.leitura.faces[faceIdx - 1]!;
  let thumb: string | null = null;
  if (f.paginaMiolo) thumb = thumbDe(origemDaPagina(f.paginaMiolo));
  else if (f.componente === 'capa' && f.paginaId) {
    const reg = S.r.componentes.capa?.find((p) => p.id === f.paginaId);
    if (reg?.origem && reg.tipo !== 'branco') thumb = thumbDe(reg.origem.indice);
  }
  const sel = f.paginaMiolo !== null && f.paginaMiolo === S.pagina;
  return `<button class="pg ${f.tipo === 'branco' ? 'branco' : ''} c-${f.componente}${sel ? ' sel' : ''}" style="aspect-ratio:${W}/${H}" data-pm="${f.paginaMiolo ?? ''}" aria-label="${esc(f.rotulo)}">
    ${thumb ? `<img src="${thumb}" alt="">` : `<span class="pnum">${f.paginaMiolo ?? ''}</span>`}
    <span class="prot">${esc(f.rotulo)}</span></button>`;
}

function vLeitura(m: HTMLElement) {
  const r = S.r;
  const d = r.leitura.duplas;
  const k = S.vista;
  const dupla = d[k];
  const rtl = S.entrada.direcao === 'rtl';
  const sup = S.entrada.encadernacaoSuperior;
  const mp = S.pagina ? r.mapa[S.pagina - 1] : null;
  m.innerHTML = `
  <header class="sec"><h1>Leitura</h1><p>O livro na ordem de leitura, como o leitor o abre. A primeira página fica sozinha à ${rtl ? 'esquerda' : 'direita'}; frente e verso da mesma folha nunca aparecem lado a lado.</p></header>
  <section class="painel leitor">
    <div class="dupla ${sup ? 'vertical' : ''}" style="--w:${S.entrada.formato.largura};--h:${S.entrada.formato.altura}">
      ${paginaVisual(dupla?.a ?? null)}${paginaVisual(dupla?.b ?? null)}
    </div>
    <div class="nav-leitura">
      <button id="l-prev" class="btn sec" ${k <= 0 ? 'disabled' : ''}>← Anterior</button>
      <span class="mono">Vista ${k + 1} de ${d.length}</span>
      <button id="l-next" class="btn sec" ${k >= d.length - 1 ? 'disabled' : ''}>Próxima →</button>
    </div>
    ${mp ? `<p class="sinc">Página ${S.pagina} selecionada · ${mp.forma ? `<a href="#imposicao">forma ${esc(mp.forma)}, lado ${mp.lado}, posição ${(mp.posicao ?? 0) + 1}${mp.rotacao ? `, girada ${mp.rotacao}°` : ''}</a>` : mp.celula ? `caderno ${mp.unidade + 1}, ${mp.celula.face === 'F' ? 'frente' : 'verso'} da folha` : 'sem posição'}</p>` : '<p class="sinc">Clique numa página para ver onde ela cai na folha impressa.</p>'}
    ${!S.pdf ? '<p class="nota">Sem PDF carregado, as páginas aparecem numeradas. Carregue um PDF ou gere o de exemplo em Projeto.</p>' : ''}
  </section>
  <section class="painel"><h2>Todas as faces</h2>
    <div class="tira">${r.leitura.faces.map((f) => paginaMini(f.indice)).join('')}</div>
  </section>`;
  on('l-prev', 'click', () => { S.vista = Math.max(0, S.vista - 1); render(); });
  on('l-next', 'click', () => { S.vista = Math.min(d.length - 1, S.vista + 1); render(); });
  m.querySelectorAll<HTMLButtonElement>('[data-pm]').forEach((b) => b.addEventListener('click', () => {
    const pm = Number(b.dataset.pm);
    if (pm) { irParaPagina(pm); render(); }
  }));
  m.querySelectorAll<HTMLButtonElement>('[data-face]').forEach((b) => b.addEventListener('click', () => {
    const fi = Number(b.dataset.face);
    const kk = d.findIndex((x) => x.a === fi || x.b === fi);
    if (kk >= 0) S.vista = kk;
    const f = r.leitura.faces[fi - 1];
    if (f?.paginaMiolo) S.pagina = f.paginaMiolo;
    render();
  }));
}

function paginaMini(fi: number) {
  const f = S.r.leitura.faces[fi - 1]!;
  const dupla = S.r.leitura.duplas[S.vista];
  const atual = dupla && (dupla.a === fi || dupla.b === fi);
  return `<button class="mini-pg ${f.tipo === 'branco' ? 'branco' : ''} c-${f.componente}${atual ? ' atual' : ''}" data-face="${fi}" title="${esc(f.rotulo)}"><span class="mono">${f.paginaMiolo ?? '·'}</span><span class="r">${esc(f.rotulo.replace('Pág. ', ''))}</span></button>`;
}

// ------------------------------------------------------------------------------------------
// Vista: Imposição

function svgForma(f: Forma, lado: 'A' | 'B', capa: boolean): string {
  const W = f.folha.largura, H = f.folha.altura;
  const lista = lado === 'A' ? f.ladoA : f.ladoB;
  const fmt = capa ? null : S.entrada.formato;
  const area = f.areaImprimivel;
  const pin = S.entrada.perfil ? 0 : 0; void pin;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" class="s-folha"/>`);
  parts.push(`<rect x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}" class="s-area"/>`);
  // faixa de pinça (lado A: borda configurada; lado B em virada pela pinça: borda oposta)
  const borda = (S.r.parametros.find((p) => p.chave === 'maquina.bordaPinca')?.valor ?? 'bottom') as string;
  const tumbleB = lado === 'B' && f.viradaVerso === 'pinca' && !f.mesmaChapa;
  const bp = tumbleB ? ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as Record<string, string>)[borda]! : borda;
  const pv = Number(S.r.parametros.find((p) => p.chave === 'maquina.pinca')?.valor ?? 0);
  const pr = bp === 'bottom' ? [0, H - pv, W, pv] : bp === 'top' ? [0, 0, W, pv] : bp === 'left' ? [0, 0, pv, H] : [W - pv, 0, pv, H];
  parts.push(`<rect x="${pr[0]}" y="${pr[1]}" width="${pr[2]}" height="${pr[3]}" class="s-pinca"/>`);
  parts.push(`<text x="${pr[0]! + (bp === 'left' || bp === 'right' ? pv / 2 : W / 2)}" y="${pr[1]! + (bp === 'top' || bp === 'bottom' ? pv / 2 + 3 : H / 2)}" class="s-pinca-t">PINÇA</text>`);
  for (const p of lista) {
    const c = p.corte;
    parts.push(`<rect x="${c.x - p.sangria.l}" y="${c.y - p.sangria.t}" width="${c.w + p.sangria.l + p.sangria.r}" height="${c.h + p.sangria.t + p.sangria.b}" class="s-sang"/>`);
    const idx = capa ? null : origemDaPagina(p.pagina);
    const br = !capa && idx === null;
    const sel = !capa && p.pagina === S.pagina;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const pw = fmt ? fmt.largura : c.w, ph = fmt ? fmt.altura : c.h;
    const th = capa ? null : thumbDe(idx);
    parts.push(`<g class="s-pg${br ? ' br' : ''}${sel ? ' sel' : ''}" data-pg="${capa ? '' : p.pagina}">
      <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" class="s-corte"/>
      <g transform="translate(${cx} ${cy}) rotate(${p.rotacao})">
        ${th ? `<image href="${th}" x="${-pw / 2}" y="${-ph / 2}" width="${pw}" height="${ph}" preserveAspectRatio="none"/>` : ''}
        <text x="0" y="${th ? ph / 2 - 8 : 0}" class="s-num${th ? ' sobre' : ''}" style="font-size:${Math.min(pw, ph) * (th ? 0.12 : 0.32)}px">${capa ? (p.pagina === 1 ? 'externa' : 'interna') : br ? `${p.pagina}·br` : p.pagina}</text>
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
  m.innerHTML = `
  <header class="sec"><h1>Imposição</h1><p>Cada página na folha de impressão, na vista de cada lado. A seta indica a cabeça da página. Clique numa página para conferir na Leitura.</p></header>
  ${f ? `<section class="painel">
    <div class="barra">
      <div class="segmentos" role="tablist">${todas.map((x) => `<button role="tab" class="seg${x.id === f.id ? ' on' : ''}" data-forma="${esc(x.id)}" aria-selected="${x.id === f.id}">${esc(x.id)}<small>${r.formasCapa.includes(x) ? 'capa' : `${x.posicoes.length} pos.`}</small></button>`).join('')}</div>
      ${f.mesmaChapa ? `<span class="chip">Chapa única · ${f.modo === 'virada_lateral' ? 'virada lateral' : 'virada pela pinça'}</span>` : `<div class="segmentos">${(['A', 'B'] as const).map((l) => `<button class="seg${lado === l ? ' on' : ''}" data-lado="${l}">Lado ${l}${l === 'B' ? `<small>virada ${f.viradaVerso === 'lateral' ? 'lateral' : 'pinça'}</small>` : '<small>frente</small>'}</button>`).join('')}</div>`}
    </div>
    <div class="folha-wrap">${svgForma(f, lado, capa)}</div>
    <dl class="dl linha">
      <dt>Folha</dt><dd class="mono">${f.folha.largura} × ${f.folha.altura} mm</dd>
      <dt>Modo</dt><dd>${esc(f.modo.replace('_', ' '))}</dd>
      <dt>Posições</dt><dd class="mono">${f.posicoes.length} · forma ${f.rotacaoForma}°</dd>
      <dt>Cópias por folha</dt><dd class="mono">${Object.values(f.copiasPorFolha)[0] ?? 0}</dd>
      <dt>Lombada na folha</dt><dd>${f.lombadaNaFolha}</dd>
      <dt>Unidades</dt><dd class="mono">${capa ? 'capa' : f.unidades.map((u) => `cad. ${u + 1}`).join(', ')}</dd>
    </dl>
  </section>` : `<section class="painel alerta-painel ${r.unidades.length ? 'warn' : 'err'}"><h2>Sem folha de impressão</h2><p>${r.unidades.length ? 'A imposição lógica dos cadernos está pronta, mas falta o formato da folha (perfil da gráfica ou ajuste no projeto) ou a forma não cabe nela.' : 'Resolva a paginação para gerar a imposição.'}</p>${r.unidades.length ? '<p><a href="#grafica">Abrir configuração da gráfica</a></p>' : '<p><a href="#paginacao">Abrir paginação</a></p>'}</section>`}
  ${r.unidades.length ? `<section class="painel"><h2>Cadernos (imposição lógica)</h2><p class="nota">Derivada por simulação da dobra e conferida por um oráculo físico independente. Verso na vista de virada lateral.</p>
    <div class="cadernos">${uniqueUnits().map((u) => cadernoLogico(u)).join('')}</div></section>` : ''}`;
  m.querySelectorAll<HTMLButtonElement>('[data-forma]').forEach((b) => b.addEventListener('click', () => { S.forma = b.dataset.forma!; render(); }));
  m.querySelectorAll<HTMLButtonElement>('[data-lado]').forEach((b) => b.addEventListener('click', () => { S.lado = b.dataset.lado as 'A' | 'B'; render(); }));
  m.querySelectorAll<SVGGElement>('[data-pg]').forEach((g) => g.addEventListener('click', () => {
    const pg = Number(g.dataset.pg);
    if (pg) { irParaPagina(pg); location.hash = 'leitura'; }
  }));
}

function uniqueUnits() {
  const u = S.r.unidades;
  return u.length > 6 ? u.slice(0, 6) : u;
}

function cadernoLogico(u: ResultadoMotor['unidades'][number]) {
  const l = u.layout;
  const grade = (face: 'frente' | 'verso') => {
    const cells = [...l.celulas].sort((a, b) => a[face].row - b[face].row || a[face].col - b[face].col);
    return `<div class="grade" style="grid-template-columns:repeat(${l.cols},1fr)">${cells.map((c) => {
      const fp = c[face];
      const g = u.mapa[fp.pagina - 1]!;
      const br = origemDaPagina(g) === null;
      return `<span class="cel${br ? ' br' : ''}${g === S.pagina ? ' sel' : ''}" style="transform:rotate(${fp.rotacao}deg)">${g}</span>`;
    }).join('')}</div>`;
  };
  return `<figure class="cad"><figcaption class="mono">Caderno ${u.indice + 1} · ${u.tamanho} pp · ${esc(l.esquema.id)}</figcaption>
    <div class="faces"><div><span class="k">Frente</span>${grade('frente')}</div><div><span class="k">Verso</span>${grade('verso')}</div></div></figure>`;
}

// ------------------------------------------------------------------------------------------
// Vista: Capa

function vCapa(m: HTMLElement) {
  const r = S.r;
  const pl = r.capa.planificacao;
  const sang = pl?.sangria ?? 0;
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
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" class="corte"/>`);
    return `<svg viewBox="${-s - 10} ${-s - 10} ${W + 2 * s + 20} ${H + 2 * s + 20}" class="capa-svg" role="img" aria-label="Capa planificada">${parts.join('')}</svg>`;
  })() : '';
  const cd = r.capa.capaDura;
  m.innerHTML = `
  <header class="sec"><h1>Capa</h1><p>Planificação calculada a partir do miolo, do papel e dos parâmetros da gráfica. Valores pendentes não são inventados.</p></header>
  ${pl ? `<section class="painel">
    <h2>${esc(pl.componente)} <span class="badge o-${pl.status === 'pendente' ? 'ausente' : pl.status === 'estimado' ? 'generico' : 'calculado'}">${pl.status}</span></h2>
    <div class="folha-wrap">${svg}</div>
    <dl class="dl linha"><dt>Aberta</dt><dd class="mono">${n2(pl.largura)} × ${n2(pl.altura)} mm</dd><dt>Sangria</dt><dd class="mono">${n2(sang)} mm</dd>
      <dt>Lombada</dt><dd class="mono">${r.fisica.lombada ? (r.fisica.lombada.valor === null ? 'pendente' : `${n2(r.fisica.lombada.valor)} mm (${r.fisica.lombada.status})`) : 'não se aplica'}</dd></dl>
    <ul class="premissas">${pl.premissas.map((x) => `<li class="mono">${esc(x)}</li>`).join('')}</ul>
    ${pl.pendencias.length ? `<div class="alerta warn">Pendências: ${pl.pendencias.map(esc).join(', ')}</div>` : ''}
    <div class="acoes"><button id="c-pdf" class="btn">Baixar capa planificada (PDF)</button></div>
  </section>` : `<section class="painel"><p class="vazio">${S.entrada.capa.modelo === 'autocapa' ? 'Autocapa: a capa faz parte do primeiro caderno (páginas 1, 2 e as duas últimas).' : r.capa.folhasDeCapa ? 'Folhas de capa: duas folhas no formato do miolo (1ª/2ª e 3ª/4ª), impressas à parte.' : 'Sem capa planificada para este modelo.'}</p></section>`}
  ${cd ? `<section class="painel"><h2>Capa dura — componentes</h2><dl class="dl linha">
    <dt>Papelão</dt><dd class="mono">${n2(cd.papelao.largura.valor)} × ${n2(cd.papelao.altura.valor)} mm</dd>
    <dt>Cartão de lombada</dt><dd class="mono">${n2(cd.papelao.cartaoLombada.valor)} mm</dd>
    <dt>Lombada externa</dt><dd class="mono">${n2(cd.lombadaExterna.valor)} mm</dd></dl></section>` : ''}
  ${r.capa.sobrecapa ? `<section class="painel"><h2>Sobrecapa</h2><p class="mono">${n2(r.capa.sobrecapa.largura)} × ${n2(r.capa.sobrecapa.altura)} mm · ${r.capa.sobrecapa.paineis.map((p) => `${esc(p.nome)} ${n2(p.largura)}`).join(' | ')}</p></section>` : ''}`;
  on('c-pdf', 'click', async () => {
    try {
      const capa = S.r.componentes.capa;
      const idx = (papel: string) => capa?.find((p) => p.papel === papel && p.origem && p.tipo !== 'branco')?.origem?.indice;
      const faces = S.pdf && capa ? { origemBytes: S.pdf.bytes, externa: { primeira: idx('1a_capa'), quarta: idx('4a_capa') }, interna: { segunda: idx('2a_capa'), terceira: idx('3a_capa') } } : undefined;
      const bytes = await gerarPdfCapa(pl!, S.entrada, S.r, faces);
      await oferecerArquivo(`${slug()}-capa-planificada.pdf`, bytes);
    } catch (e) { toast((e as Error).message, 'err'); }
  });
}

const slug = () => S.entrada.projeto.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projeto';

// ------------------------------------------------------------------------------------------
// Vista: Validação e arquivos

function vSaida(m: HTMLElement) {
  const r = S.r;
  const grupos = ['erro', 'pendencia', 'aviso', 'nao_verificavel', 'info'] as const;
  const cons = (c: typeof r.consumo.miolo, nome: string) => c ? `<h3>${nome} <span class="badge o-${c.status === 'calculado' ? 'calculado' : c.status === 'pendente' ? 'ausente' : 'generico'}">${c.status}</span></h3>
    <div class="tabela-wrap"><table><thead><tr><th>Forma</th><th class="num">Cópias/folha</th><th class="num">Líquidas</th><th class="num">Brutas</th><th class="num">Peso (kg)</th><th class="num">Chapas</th></tr></thead><tbody>
    ${c.linhas.map((l) => `<tr><td class="mono">${esc(l.forma)}</td><td class="num mono">${l.copiasPorFolha}</td><td class="num mono">${l.folhasLiquidas.toLocaleString('pt-BR')}</td><td class="num mono">${l.folhasBrutas.toLocaleString('pt-BR')}</td><td class="num mono">${n2(l.pesoKg)}</td><td class="num mono">${l.chapas}</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td></td><td></td><td class="num mono">${c.totalFolhas.toLocaleString('pt-BR')}</td><td class="num mono">${n2(c.totalPesoKg)}</td><td class="num mono">${c.totalChapas}</td></tr></tbody></table></div>
    <p class="nota">${c.premissas.map(esc).join(' ')} Estimativa de consumo, não orçamento.</p>` : '';
  m.innerHTML = `
  <header class="sec"><h1>Validação e arquivos</h1><p>O status de saída depende da origem de cada parâmetro crítico e das verificações. A validação da plataforma não substitui a aprovação da gráfica.</p></header>
  <section class="painel nivel-painel n-${NIVEL_CLASSE[r.nivel]}">
    <span class="pill ${NIVEL_CLASSE[r.nivel]}">${NIVEL_CURTO[r.nivel]}</span>
    <p>${esc(r.rotuloNivel)}</p>
    <p class="mono meta">motor ${r.versaoMotor} · ${r.versaoRegra} · hash ${r.hashEntrada.slice(0, 16)}…</p>
  </section>
  <section class="painel"><h2>Arquivos</h2>
    <div class="acoes">
      <button id="x-pdf" class="btn" ${!r.formas.length || !S.pdf ? 'disabled' : ''}>${r.nivel === 'validado_parametros' ? 'Baixar miolo imposto (PDF)' : 'Baixar prévia do miolo imposto (PDF)'}</button>
      <button id="x-ficha" class="btn sec">Ficha técnica (TXT)</button>
      <button id="x-csv" class="btn sec">Mapa de imposição (CSV)</button>
      <button id="x-json" class="btn sec">Resultado do motor (JSON)</button>
      <button id="x-proj" class="btn sec">Projeto (JSON)</button>
      <label class="btn sec"><input id="x-abrir" type="file" accept=".json,application/json" hidden>Abrir projeto</label>
    </div>
    ${!S.pdf ? '<p class="nota">Para gerar o PDF imposto, carregue o PDF de origem (ou o de exemplo) em Projeto.</p>' : ''}
    ${r.nivel !== 'validado_parametros' && r.formas.length ? '<p class="nota">A prévia leva a marcação "PRÉVIA — NÃO VALIDADO PARA PRODUÇÃO" em cada folha.</p>' : ''}
  </section>
  <section class="painel"><h2>Constatações</h2>
    ${grupos.map((g) => {
      const l = r.constatacoes.filter((c) => c.severidade === g);
      if (!l.length) return '';
      return `<div class="sev-grupo"><h3 class="sev s-${g}">${SEV_ROT[g]} <span class="mono">${l.length}</span></h3><ul class="constat">${l.map((c) => `<li class="s-${g}"><span class="cod mono">${esc(c.codigo)}</span><div><p>${esc(c.mensagem)}</p>${c.evidencia ? `<p class="ev mono">${esc(c.evidencia)}</p>` : ''}${c.opcoes?.length ? `<ul class="op">${c.opcoes.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}</div></li>`).join('')}</ul></div>`;
    }).join('')}
  </section>
  <section class="painel grid2">
    <div class="grupo"><h2>Física</h2><dl class="dl">
      <dt>Calibre miolo</dt><dd class="mono">${r.fisica.calibreMiolo.valor === null ? 'pendente' : `${n2(r.fisica.calibreMiolo.valor * 1000, 1)} µm`} ${badge(r.fisica.calibreMiolo.origem)}</dd>
      <dt>Espessura do bloco</dt><dd class="mono">${r.fisica.espessuraBloco.valor === null ? 'pendente' : `${n2(r.fisica.espessuraBloco.valor)} mm`}</dd>
      <dt>Lombada</dt><dd class="mono">${r.fisica.lombada ? (r.fisica.lombada.valor === null ? 'pendente' : `${n2(r.fisica.lombada.valor)} mm`) : 'não se aplica'}</dd>
      <dt>Creep máximo</dt><dd class="mono">${n2(r.fisica.creepMaximo, 3)} mm</dd></dl></div>
    <div class="grupo"><h2>Histórico do projeto</h2>
      ${S.eventos.length ? `<ol class="eventos">${S.eventos.slice(0, 12).map((ev) => `<li><span class="mono">${esc(ev.data.slice(0, 16).replace('T', ' '))}</span> ${esc(ev.texto)} <span class="ajuda">${esc(ev.autor)}</span></li>`).join('')}</ol>` : '<p class="vazio">Sem alterações registradas.</p>'}</div>
  </section>
  <section class="painel"><h2>Consumo estimado</h2>${cons(r.consumo.miolo, 'Miolo')}${cons(r.consumo.capa, 'Capa')}${!r.consumo.miolo ? '<p class="vazio">Sem formas de impressão, o consumo não é calculado.</p>' : ''}</section>`;

  on('x-pdf', 'click', async () => {
    const b = $('#x-pdf') as HTMLButtonElement;
    b.disabled = true; b.textContent = 'Gerando…';
    try {
      const bytes = await gerarPdfImposto(S.pdf!.bytes, S.entrada, S.r, { rotularBrancos: S.r.nivel !== 'validado_parametros' });
      registrar(`PDF imposto gerado (${S.r.nivel}, ${S.r.hashEntrada.slice(0, 12)})`);
      salvarLocal();
      await oferecerArquivo(`${slug()}-v${S.entrada.projeto.versao}-miolo-${S.r.nivel === 'validado_parametros' ? 'imposto' : 'previa'}.pdf`, bytes);
    } catch (e) { toast((e as Error).message, 'err'); }
    render();
  });
  on('x-ficha', 'click', () => oferecerArquivo(`${slug()}-ficha-tecnica.txt`, fichaTecnica(S.entrada, S.r)));
  on('x-csv', 'click', () => oferecerArquivo(`${slug()}-mapa-imposicao.csv`, mapaCsv(S.r)));
  on('x-json', 'click', () => oferecerArquivo(`${slug()}-resultado.json`, JSON.stringify(S.r, null, 2)));
  on('x-proj', 'click', () => oferecerArquivo(`${slug()}-projeto-v${S.entrada.projeto.versao}.json`, JSON.stringify({ formato: 'plataforma-editorial/projeto@1', entrada: S.entrada, eventos: S.eventos }, null, 2)));
  on('x-abrir', 'change', async (el) => {
    const f = el.files?.[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.formato !== 'plataforma-editorial/projeto@1' || !d.entrada) throw new Error('Arquivo não é um projeto desta plataforma.');
      S.entrada = d.entrada; S.eventos = d.eventos ?? []; S.pdf = null; thumbs.clear(); pdfjsDoc = null;
      registrar(`Projeto aberto: ${f.name}`); recalcular(); render();
      toast('Projeto aberto. Carregue novamente o PDF de origem para gerar arquivos.');
    } catch (e) { toast((e as Error).message, 'err'); }
  });
}

// ------------------------------------------------------------------------------------------
// Início

function iniciar() {
  $('#nav').innerHTML = ROTAS.map(([k, t]) => `<a href="#${k}" data-r="${k}">${t}</a>`).join('');
  recalcular();
  render();
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });
  document.addEventListener('keydown', (ev) => {
    if (rotaAtual() !== 'leitura' || (ev.target as HTMLElement).closest('input,select,textarea')) return;
    const rtl = S.entrada.direcao === 'rtl';
    if (ev.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) { S.vista = Math.min(S.r.leitura.duplas.length - 1, S.vista + 1); render(); }
    if (ev.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) { S.vista = Math.max(0, S.vista - 1); render(); }
  });
}

iniciar();
