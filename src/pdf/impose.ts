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

const REG = cmyk(1, 1, 1, 1); // cor de registro (marcas)
const PRETO = cmyk(0, 0, 0, 1);

export interface OpcoesPdf {
  /** Em prévia, páginas em branco recebem um rótulo discreto fora da área útil e o PDF é marcado como prévia. */
  rotularBrancos?: boolean;
}

interface FonteEmb { emb: PDFEmbeddedPage; trimX: number; trimY: number; trimW: number; trimH: number }

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
  const origem = await PDFDocument.load(origemBytes, { updateMetadata: false });
  const dest = await PDFDocument.create();
  const fontes = await prepararFontes(dest, origem);
  const font = await dest.embedFont(StandardFonts.Helvetica);
  const previa = r.nivel !== 'validado_parametros';

  const idxOrigem = (pagina: number): number | null => {
    const reg = r.componentes.miolo[pagina - 1];
    if (!reg || reg.tipo === 'branco' || !reg.origem) return null;
    return reg.origem.indice;
  };

  for (const f of r.formas) {
    const lados: Array<['A' | 'B', Posicionamento[]]> = f.mesmaChapa ? [['A', f.ladoA]] : [['A', f.ladoA], ['B', f.ladoB]];
    for (const [lado, lista] of lados) {
      const W = f.folha.largura, H = f.folha.altura;
      const page = dest.addPage([mmToPt(W), mmToPt(H)]);
      for (const p of lista) {
        const i = idxOrigem(p.pagina);
        if (i === null) continue; // branco: nada é impresso
        const fe = fontes.get(i);
        if (!fe) throw new Error(`Página de origem ${i + 1} inexistente no PDF.`);
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
        `${entrada.projeto.nome} v${entrada.projeto.versao} · forma ${f.id} · ${ladoTxt} · ${f.posicoes.length} pos. · motor ${r.versaoMotor} · ${r.versaoRegra} · ${r.hashEntrada.slice(0, 12)} · ${previa ? 'PRÉVIA — NÃO VALIDADO PARA PRODUÇÃO' : 'validado para os parâmetros informados'}`,
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
  faces?: { origemBytes: Uint8Array; externa: { primeira?: number; quarta?: number }; interna?: { segunda?: number; terceira?: number } },
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
    const origem = await PDFDocument.load(faces.origemBytes, { updateMetadata: false });
    fontes = await prepararFontes(dest, origem);
  }

  const lados: Array<['externa' | 'interna', Record<string, number | undefined>]> = [['externa', faces?.externa ?? {}]];
  if (faces?.interna) lados.push(['interna', faces.interna]);
  if (!faces) lados.push(['interna', {}]);

  for (const [lado, mapaFaces] of lados) {
    const page = dest.addPage([mmToPt(W), mmToPt(H)]);
    const espelhar = lado === 'interna';
    // A face interna é a externa espelhada (painéis em ordem inversa).
    const paineis = espelhar ? pl.paineis.map((p) => ({ ...p, x: pl.largura - p.x - p.largura })) : pl.paineis;
    for (const p of paineis) {
      let fi: number | undefined;
      if (lado === 'externa' && p.nome === '1ª capa') fi = mapaFaces.primeira;
      if (lado === 'externa' && p.nome === '4ª capa') fi = mapaFaces.quarta;
      if (lado === 'interna' && p.nome === '1ª capa') fi = mapaFaces.segunda;
      if (lado === 'interna' && p.nome === '4ª capa') fi = mapaFaces.terceira;
      if (fi !== undefined && fontes?.get(fi)) {
        // Sangria só nas bordas externas da peça; junções com lombada/orelhas recortam no painel.
        const extEsq = p.x <= 1e-6;
        const extDir = p.x + p.largura >= pl.largura - 1e-6;
        desenharPagina(page, H, fontes.get(fi)!, {
          pagina: 0, unidade: 0, posicao: 0, face: 'F', rotacao: 0, creep: { dx: 0, dy: 0 },
          corte: { x: ox + p.x, y: oy, w: p.largura, h: pl.altura },
          sangria: { l: extEsq ? s : 0, r: extDir ? s : 0, t: s, b: s },
        });
      }
      const nomeFace = lado === 'interna' ? p.nome.replace('1ª capa', '2ª capa').replace('4ª capa', '3ª capa').replace('orelha (1ª)', 'orelha (2ª)').replace('orelha (4ª)', 'orelha (3ª)') : p.nome;
      page.drawText(`${nomeFace} — ${p.largura.toFixed(2)} mm`, { x: mmToPt(ox + p.x + 2), y: mmToPt(H - oy + 2), size: 6, font, color: PRETO });
    }
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

/** Lê dimensões e caixas das páginas do PDF de origem (relatório de importação, RF-032). */
export async function inspecionarPdf(bytes: Uint8Array): Promise<{ paginas: number; dimensoes: Array<{ indice: number; larguraMm: number; alturaMm: number; sangriaMm: number; temTrimBox: boolean }> }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
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
