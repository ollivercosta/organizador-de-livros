/**
 * Geração dos arquivos de produção (RF-018, RF-019, RN-014).
 *
 * - O PDF imposto é gerado EXCLUSIVAMENTE a partir do resultado versionado do motor
 *   (o mesmo mapa exibido no visualizador).
 * - As páginas de origem são incorporadas como Form XObjects (vetor preservado, sem rasterizar).
 * - Alinhamento pela TrimBox de cada página de origem; recorte pela sangria definida por borda.
 * - Toda página gerada leva faixa de identificação com projeto, forma, lado, versão do motor,
 *   versão da regra, hash da entrada e nível de validação.
 */

import {
  PDFDocument, PDFName, StandardFonts, cmyk, popGraphicsState, pushGraphicsState, concatTransformationMatrix,
  rectangle, clip, endPath, drawObject, type PDFPage, type PDFEmbeddedPage, type PDFFont,
} from 'pdf-lib';
import { mmToPt } from '../core/evidence.js';
import type { EntradaProjeto, ResultadoMotor } from '../engine.js';
import type { Forma, Posicionamento } from '../press/layout.js';
import type { Planificacao } from '../cover/cover.js';
import type { GeometriaCodigo } from '../editorial/codigoBarras.js';

const REG = cmyk(1, 1, 1, 1); // cor de registro (marcas)
const PRETO = cmyk(0, 0, 0, 1);

export interface OpcoesPdf {
  /** Em prévia, páginas em branco recebem um rótulo discreto fora da área útil e o PDF é marcado como prévia. */
  rotularBrancos?: boolean;
}

interface FonteEmb { emb: PDFEmbeddedPage; trimX: number; trimY: number; trimW: number; trimH: number }
export type RefOrigem = { indice: number; recorte?: 'esquerda' | 'direita' };

/** Fonte para uma página do arquivo; em páginas duplas divididas, usa a metade da TrimBox. */
function fonteDe(fontes: Map<number, FonteEmb>, ref: RefOrigem): FonteEmb | undefined {
  const f = fontes.get(ref.indice);
  if (!f || !ref.recorte) return f;
  const w = f.trimW / 2;
  return { ...f, trimX: f.trimX + (ref.recorte === 'direita' ? w : 0), trimW: w };
}

async function carregar(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch (e) {
    throw new Error(`Não foi possível ler o PDF (${(e as Error).message}). Exporte novamente como PDF/X ou sem proteção.`);
  }
}

const SELO: Record<string, string> = {
  bloqueado: 'PRÉVIA — BLOQUEADO PARA PRODUÇÃO',
  padrao_mercado: 'PADRÃO DE MERCADO — CONFIRMAR PARÂMETROS COM A GRÁFICA',
  validado_parametros: 'validado para os parâmetros informados',
};

async function prepararFontes(dest: PDFDocument, origem: PDFDocument): Promise<Map<number, FonteEmb>> {
  const out = new Map<number, FonteEmb>();
  const pages = origem.getPages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const media = p.getMediaBox();
    const trim = p.getTrimBox();
    const emb = await dest.embedPage(p, { left: media.x, bottom: media.y, right: media.x + media.width, top: media.y + media.height });
    // Com bounding box = MediaBox, o XObject é desenhado com origem no canto da MediaBox.
    out.set(i, { emb, trimX: trim.x - media.x, trimY: trim.y - media.y, trimW: trim.width, trimH: trim.height });
  }
  return out;
}

function desenharPagina(page: PDFPage, H: number, f: FonteEmb, p: Posicionamento) {
  const ptX = mmToPt(p.corte.x);
  const ptY = mmToPt(H - p.corte.y - p.corte.h);
  const ptW = mmToPt(p.corte.w);
  const ptH = mmToPt(p.corte.h);
  // Recorte = caixa de corte + sangria por borda (na vista do lado; y do PDF cresce para cima).
  const cx0 = ptX - mmToPt(p.sangria.l);
  const cy0 = ptY - mmToPt(p.sangria.b);
  const cw = ptW + mmToPt(p.sangria.l + p.sangria.r);
  const ch = ptH + mmToPt(p.sangria.t + p.sangria.b);

  // Rotação visual horária θ  →  rotação matemática φ = −θ (eixo y para cima).
  const phi = (-p.rotacao * Math.PI) / 180;
  const cos = Math.round(Math.cos(phi));
  const sin = Math.round(Math.sin(phi));
  const srcCx = f.trimX + f.trimW / 2;
  const srcCy = f.trimY + f.trimH / 2;
  const dstCx = ptX + ptW / 2 + mmToPt(p.creep.dx);
  const dstCy = ptY + ptH / 2 - mmToPt(p.creep.dy);
  const a = cos, b = sin, c = -sin, d = cos;
  const e = dstCx - (a * srcCx + c * srcCy);
  const g = dstCy - (b * srcCx + d * srcCy);

  const nome = page.node.newXObject('Pg', f.emb.ref);
  page.pushOperators(
    pushGraphicsState(),
    rectangle(cx0, cy0, cw, ch), clip(), endPath(),
    concatTransformationMatrix(a, b, c, d, e, g),
    drawObject(nome),
    popGraphicsState(),
  );
}

function faixa(page: PDFPage, font: PDFFont, W: number, H: number, texto: string, alerta: boolean) {
  const size = 6;
  page.drawText(texto, { x: mmToPt(4), y: mmToPt(1.6), size, font, color: alerta ? cmyk(0, 1, 1, 0) : PRETO });
  void W; void H;
}

export async function gerarPdfImposto(origemBytes: Uint8Array, entrada: EntradaProjeto, r: ResultadoMotor, opts: OpcoesPdf = {}): Promise<Uint8Array> {
  if (!r.formas.length) throw new Error('Não há formas de impressão: resolva as pendências do motor antes de exportar.');
  const origem = await carregar(origemBytes);
  const dest = await PDFDocument.create();
  const fontes = await prepararFontes(dest, origem);
  const font = await dest.embedFont(StandardFonts.Helvetica);
  const previa = r.nivel !== 'validado_parametros';

  const idxOrigem = (pagina: number): RefOrigem | null => {
    const reg = r.componentes.miolo[pagina - 1];
    if (!reg || reg.tipo === 'branco' || !reg.origem) return null;
    return reg.origem;
  };

  for (const f of r.formas) {
    const lados: Array<['A' | 'B', Posicionamento[]]> = f.mesmaChapa ? [['A', f.ladoA]] : [['A', f.ladoA], ['B', f.ladoB]];
    for (const [lado, lista] of lados) {
      const W = f.folha.largura, H = f.folha.altura;
      const page = dest.addPage([mmToPt(W), mmToPt(H)]);
      for (const p of lista) {
        const i = idxOrigem(p.pagina);
        if (i === null) continue; // branco: nada é impresso
        const fe = fonteDe(fontes, i);
        if (!fe) throw new Error(`Página de origem ${i.indice + 1} inexistente no PDF.`);
        desenharPagina(page, H, fe, p);
      }
      // marcas: lado A (e chapa única)
      if (lado === 'A') desenharMarcas(page, f, H);
      if (opts.rotularBrancos) {
        for (const p of lista) if (idxOrigem(p.pagina) === null) {
          page.drawText(`branco p.${p.pagina}`, { x: mmToPt(p.corte.x + 2), y: mmToPt(H - p.corte.y - 6), size: 7, font, color: cmyk(0, 0, 0, 0.4) });
        }
      }
      const ladoTxt = f.mesmaChapa ? `chapa única (${f.modo === 'virada_lateral' ? 'virada lateral' : 'virada pela pinça'})` : `lado ${lado}${lado === 'B' ? ` (virada ${f.viradaVerso === 'lateral' ? 'lateral' : 'pela pinça'})` : ''}`;
      faixa(page, font, W, H,
        `${entrada.projeto.nome} v${entrada.projeto.versao} · forma ${f.id} · ${ladoTxt} · ${f.posicoes.length} pos. · motor ${r.versaoMotor} · ${r.versaoRegra} · ${r.hashEntrada.slice(0, 12)} · ${SELO[r.nivel]}`,
        previa);
    }
  }
  dest.setTitle(`${entrada.projeto.nome} — miolo imposto`);
  dest.setSubject(`${r.versaoRegra} · ${r.hashEntrada}`);
  dest.setProducer(`Plataforma de Produção Editorial ${r.versaoMotor}`);
  dest.setKeywords([r.nivel, r.hashEntrada]);
  return dest.save();
}

function desenharMarcas(page: PDFPage, f: Forma, H: number) {
  for (const m of f.marcasA) {
    if (m.tipo === 'colacao') {
      page.drawRectangle({ x: mmToPt(m.x1), y: mmToPt(H - m.y2), width: mmToPt(m.x2 - m.x1), height: mmToPt(m.y2 - m.y1), color: PRETO });
      continue;
    }
    page.drawLine({
      start: { x: mmToPt(m.x1), y: mmToPt(H - m.y1) }, end: { x: mmToPt(m.x2), y: mmToPt(H - m.y2) },
      thickness: 0.25, color: REG, dashArray: m.tipo === 'dobra' ? [2, 1.5] : undefined,
    });
  }
}

/** Gabarito da capa planificada (e composição das faces quando fornecidas). */
export async function gerarPdfCapa(
  pl: Planificacao,
  entrada: EntradaProjeto,
  r: ResultadoMotor,
  faces?: { origemBytes: Uint8Array; externa: { primeira?: RefOrigem; quarta?: RefOrigem }; interna?: { segunda?: RefOrigem; terceira?: RefOrigem } },
  codigo?: { geometria: GeometriaCodigo; x: number; y: number },
): Promise<Uint8Array> {
  const dest = await PDFDocument.create();
  const font = await dest.embedFont(StandardFonts.Helvetica);
  const m = 15; // margem para marcas e textos
  const s = pl.sangria;
  const W = pl.largura + 2 * s + 2 * m;
  const H = pl.altura + 2 * s + 2 * m;
  const ox = m + s; const oy = m + s; // origem do corte (vista de tela)

  let fontes: Map<number, FonteEmb> | null = null;
  if (faces) {
    const origem = await carregar(faces.origemBytes);
    fontes = await prepararFontes(dest, origem);
  }

  const lados: Array<['externa' | 'interna', Record<string, RefOrigem | undefined>]> = [['externa', faces?.externa ?? {}]];
  if (faces?.interna) lados.push(['interna', faces.interna]);
  if (!faces) lados.push(['interna', {}]);

  for (const [lado, mapaFaces] of lados) {
    const page = dest.addPage([mmToPt(W), mmToPt(H)]);
    const espelhar = lado === 'interna';
    // A face interna é a externa espelhada (painéis em ordem inversa).
    const paineis = espelhar ? pl.paineis.map((p) => ({ ...p, x: pl.largura - p.x - p.largura })) : pl.paineis;
    for (const p of paineis) {
      let fi: RefOrigem | undefined;
      if (lado === 'externa' && p.nome === '1ª capa') fi = mapaFaces.primeira;
      if (lado === 'externa' && p.nome === '4ª capa') fi = mapaFaces.quarta;
      if (lado === 'interna' && p.nome === '1ª capa') fi = mapaFaces.segunda;
      if (lado === 'interna' && p.nome === '4ª capa') fi = mapaFaces.terceira;
      if (fi !== undefined && fontes && fonteDe(fontes, fi)) {
        // Sangria só nas bordas externas da peça; junções com lombada/orelhas recortam no painel.
        const extEsq = p.x <= 1e-6;
        const extDir = p.x + p.largura >= pl.largura - 1e-6;
        desenharPagina(page, H, fonteDe(fontes, fi)!, {
          pagina: 0, unidade: 0, posicao: 0, face: 'F', rotacao: 0, creep: { dx: 0, dy: 0 },
          corte: { x: ox + p.x, y: oy, w: p.largura, h: pl.altura },
          sangria: { l: extEsq ? s : 0, r: extDir ? s : 0, t: s, b: s },
        });
      }
      const nomeFace = lado === 'interna' ? p.nome.replace('1ª capa', '2ª capa').replace('4ª capa', '3ª capa').replace('orelha (1ª)', 'orelha (2ª)').replace('orelha (4ª)', 'orelha (3ª)') : p.nome;
      page.drawText(`${nomeFace} — ${p.largura.toFixed(2)} mm`, { x: mmToPt(ox + p.x + 2), y: mmToPt(H - oy + 2), size: 6, font, color: PRETO });
    }
    if (codigo && lado === 'externa') desenharCodigo(page, H, codigo.geometria, ox + codigo.x, oy + codigo.y, font);
    // Linhas: corte (contorno), dobras e vincos
    const ly = (y: number) => mmToPt(H - y);
    page.drawRectangle({ x: mmToPt(ox), y: ly(oy + pl.altura), width: mmToPt(pl.largura), height: mmToPt(pl.altura), borderColor: REG, borderWidth: 0.25 });
    for (const l of pl.linhas) {
      if (l.x === undefined) continue;
      const x = espelhar ? pl.largura - l.x : l.x;
      page.drawLine({ start: { x: mmToPt(ox + x), y: ly(oy - s - 1) }, end: { x: mmToPt(ox + x), y: ly(oy - s - 8) }, thickness: 0.25, color: REG, dashArray: l.tipo === 'corte' ? undefined : [2, 1.5] });
      page.drawLine({ start: { x: mmToPt(ox + x), y: ly(oy + pl.altura + s + 1) }, end: { x: mmToPt(ox + x), y: ly(oy + pl.altura + s + 8) }, thickness: 0.25, color: REG, dashArray: l.tipo === 'corte' ? undefined : [2, 1.5] });
      page.drawText(l.tipo, { x: mmToPt(ox + x + 0.8), y: ly(oy + pl.altura + s + 11), size: 5, font, color: PRETO });
    }
    page.drawText(`${pl.componente} · face ${lado} · ${pl.largura.toFixed(2)} × ${pl.altura.toFixed(2)} mm + sangria ${s} mm · ${r.versaoRegra} · ${r.hashEntrada.slice(0, 12)} · ${pl.status === 'pendente' ? 'PENDENTE: ' + pl.pendencias.join(', ') : r.rotuloNivel}`,
      { x: mmToPt(4), y: mmToPt(2), size: 6, font, color: pl.status === 'pendente' ? cmyk(0, 1, 1, 0) : PRETO });
  }
  dest.setTitle(`${entrada.projeto.nome} — ${pl.componente}`);
  dest.setProducer(`Plataforma de Produção Editorial ${r.versaoMotor}`);
  return dest.save();
}

/** Desenha o EAN-13 vetorial (barras 100% K sobre fundo branco) com origem (x, y) em mm de tela. */
export function desenharCodigo(page: PDFPage, H: number, g: GeometriaCodigo, x: number, y: number, font: PDFFont) {
  page.drawRectangle({ x: mmToPt(x), y: mmToPt(H - y - g.altura), width: mmToPt(g.largura), height: mmToPt(g.altura), color: cmyk(0, 0, 0, 0) });
  for (const b of g.barras) page.drawRectangle({ x: mmToPt(x + b.x), y: mmToPt(H - y - b.y - b.h), width: mmToPt(b.w), height: mmToPt(b.h), color: PRETO });
  for (const t of g.textos) {
    const size = mmToPt(t.tamanho);
    const w = font.widthOfTextAtSize(t.texto, size);
    const dx = t.ancora === 'middle' ? -w / 2 : t.ancora === 'end' ? -w : 0;
    page.drawText(t.texto, { x: mmToPt(x + t.x) + dx, y: mmToPt(H - y - t.y), size, font, color: PRETO });
  }
}

/** Código de barras isolado (PDF vetorial) para o designer posicionar na arte. */
export async function gerarPdfCodigo(g: GeometriaCodigo, titulo: string): Promise<Uint8Array> {
  const dest = await PDFDocument.create();
  const font = await dest.embedFont(StandardFonts.Helvetica);
  const page = dest.addPage([mmToPt(g.largura), mmToPt(g.altura)]);
  desenharCodigo(page, g.altura, g, 0, 0, font);
  dest.setTitle(titulo);
  return dest.save();
}

/**
 * PDF para a gráfica em ORDEM DE LEITURA: uma página do PDF por página do livro (brancos incluídos),
 * MediaBox = corte + sangria + área de marcas, TrimBox/BleedBox definidas, marcas de corte opcionais.
 * É o formato que a maioria das gráficas pede, pois elas fazem a imposição no próprio fluxo (RIP).
 */
export async function gerarPdfOrdemLeitura(origemBytes: Uint8Array, entrada: EntradaProjeto, r: ResultadoMotor, opts: { marcas: boolean; sangria: number; codigo?: { geometria: GeometriaCodigo; pagina: number; x: number; y: number } }): Promise<Uint8Array> {
  const origem = await carregar(origemBytes);
  const dest = await PDFDocument.create();
  const fontes = await prepararFontes(dest, origem);
  const font = await dest.embedFont(StandardFonts.Helvetica);
  const W = entrada.formato.largura, Hp = entrada.formato.altura, s = opts.sangria;
  const m = opts.marcas ? 10 : 0;
  const PW = W + 2 * (s + m), PH = Hp + 2 * (s + m);
  r.componentes.miolo.forEach((reg, i) => {
    const page = dest.addPage([mmToPt(PW), mmToPt(PH)]);
    page.setTrimBox(mmToPt(s + m), mmToPt(s + m), mmToPt(W), mmToPt(Hp));
    page.setBleedBox(mmToPt(m), mmToPt(m), mmToPt(W + 2 * s), mmToPt(Hp + 2 * s));
    if (reg.tipo !== 'branco' && reg.origem) {
      const fe = fonteDe(fontes, reg.origem);
      if (fe) {
        // Página dividida de uma dupla: não há sangria real no lado da lombada.
        const lomb = reg.origem.recorte ? ((i + 1) % 2 === 1) === (entrada.direcao === 'ltr') ? 'l' : 'r' : null;
        desenharPagina(page, PH, fe, {
          pagina: i + 1, unidade: 0, posicao: 0, face: 'F', rotacao: 0, creep: { dx: 0, dy: 0 },
          corte: { x: s + m, y: s + m, w: W, h: Hp },
          sangria: { l: lomb === 'l' ? 0 : s, r: lomb === 'r' ? 0 : s, t: s, b: s },
        });
      }
    }
    if (opts.codigo && opts.codigo.pagina === i + 1) desenharCodigo(page, PH, opts.codigo.geometria, s + m + opts.codigo.x, s + m + opts.codigo.y, font);
    if (opts.marcas) {
      const x0 = s + m, y0 = s + m, L = 5, off = s + 1.5;
      const ln = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: mmToPt(x1), y: mmToPt(PH - y1) }, end: { x: mmToPt(x2), y: mmToPt(PH - y2) }, thickness: 0.25, color: REG });
      for (const x of [x0, x0 + W]) { ln(x, y0 - off - L, x, y0 - off); ln(x, y0 + Hp + off, x, y0 + Hp + off + L); }
      for (const y of [y0, y0 + Hp]) { ln(x0 - off - L, y, x0 - off, y); ln(x0 + W + off, y, x0 + W + off + L, y); }
      page.drawText(`${entrada.projeto.nome} · p. ${i + 1}/${r.componentes.miolo.length}${reg.tipo === 'branco' ? ' (branco)' : ''} · ${SELO[r.nivel]}`, { x: mmToPt(2), y: mmToPt(1.5), size: 5, font, color: PRETO });
    }
  });
  dest.setTitle(`${entrada.projeto.nome} — miolo em ordem de leitura`);
  dest.setSubject(`${r.versaoRegra} · ${r.hashEntrada}`);
  dest.setProducer(`Plataforma de Produção Editorial ${r.versaoMotor}`);
  return dest.save();
}

/** Lê dimensões e caixas das páginas do PDF de origem (relatório de importação, RF-032). */
export async function inspecionarPdf(bytes: Uint8Array): Promise<{ paginas: number; dimensoes: Array<{ indice: number; larguraMm: number; alturaMm: number; sangriaMm: number; temTrimBox: boolean }> }> {
  const doc = await carregar(bytes);
  const dims = doc.getPages().map((p, i) => {
    const t = p.getTrimBox();
    const b = p.getBleedBox();
    const temTrim = p.node.get(PDFName.of('TrimBox')) !== undefined;
    const sang = Math.min(t.x - b.x, t.y - b.y, b.x + b.width - (t.x + t.width), b.y + b.height - (t.y + t.height));
    const k = 25.4 / 72;
    return { indice: i, larguraMm: t.width * k, alturaMm: t.height * k, sangriaMm: Math.max(0, sang * k), temTrimBox: temTrim };
  });
  return { paginas: dims.length, dimensoes: dims };
}
