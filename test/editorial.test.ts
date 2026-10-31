import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { registrarPaginas } from '../src/binding/pagination.js';
import { geometriaEan13, modulosComplemento, modulosEan13 } from '../src/editorial/codigoBarras.js';
import { digitoEan13, validarIsbn, validarIsmn, validarIssn } from '../src/editorial/identificadores.js';
import { executarMotor } from '../src/engine.js';
import { pdfAmostra } from '../src/pdf/amostra.js';
import { gerarPdfImposto, gerarPdfOrdemLeitura, inspecionarPdf } from '../src/pdf/impose.js';
import { comBrancos, livroInfantil } from './fixtures.js';

const AGORA = '2026-10-31T12:00:00.000Z';

describe('identificadores', () => {
  it('ISBN-13 válido (exemplo da norma ISO 2108: 978-0-306-40615-7)', () => {
    const v = validarIsbn('978-0-306-40615-7');
    expect(v.valido).toBe(true);
    expect(v.ean13).toBe('9780306406157');
    expect(v.exibicao).toBe('978-0-306-40615-7');
  });
  it('ISBN-13 com dígito errado é recusado e informa o esperado', () => {
    const v = validarIsbn('9780306406158');
    expect(v.valido).toBe(false);
    expect(v.mensagens[0]).toMatch(/esperado 7/);
  });
  it('ISBN-10 0-306-40615-2 → ISBN-13 9780306406157', () => {
    const v = validarIsbn('0-306-40615-2');
    expect(v.valido).toBe(true);
    expect(v.ean13).toBe('9780306406157');
    expect(v.convertidoDeIsbn10).toBe(true);
  });
  it('979-0 é ISMN, não ISBN', () => {
    expect(validarIsbn('9790060115615').valido).toBe(false);
    expect(validarIsmn('979-0-060-11561-5').valido).toBe(true);
  });
  it('ISSN 0317-8471 → EAN 977031784700 + verificador', () => {
    const v = validarIssn('0317-8471', '00');
    expect(v.valido).toBe(true);
    expect(v.ean13).toBe('977031784700' + digitoEan13('977031784700'));
    expect(validarIssn('0317-8472').valido).toBe(false);
  });
});

/** Decodificador independente (tabelas escritas de novo) para conferir o codificador. */
function decodificar(mods: string): string {
  const Lt: Record<string, number> = { '0001101': 0, '0011001': 1, '0010011': 2, '0111101': 3, '0100011': 4, '0110001': 5, '0101111': 6, '0111011': 7, '0110111': 8, '0001011': 9 };
  const Gt: Record<string, number> = { '0100111': 0, '0110011': 1, '0011011': 2, '0100001': 3, '0011101': 4, '0111001': 5, '0000101': 6, '0010001': 7, '0001001': 8, '0010111': 9 };
  const Rt: Record<string, number> = { '1110010': 0, '1100110': 1, '1101100': 2, '1000010': 3, '1011100': 4, '1001110': 5, '1010000': 6, '1000100': 7, '1001000': 8, '1110100': 9 };
  const prim: Record<string, number> = { LLLLLL: 0, LLGLGG: 1, LLGGLG: 2, LLGGGL: 3, LGLLGG: 4, LGGLLG: 5, LGGGLL: 6, LGLGLG: 7, LGLGGL: 8, LGGLGL: 9 };
  expect(mods.length).toBe(95);
  expect(mods.slice(0, 3)).toBe('101'); expect(mods.slice(45, 50)).toBe('01010'); expect(mods.slice(92)).toBe('101');
  let par = ''; let dig = '';
  for (let i = 0; i < 6; i++) { const ch = mods.slice(3 + i * 7, 10 + i * 7); if (ch in Lt) { par += 'L'; dig += Lt[ch]; } else { par += 'G'; dig += Gt[ch]; } }
  for (let i = 0; i < 6; i++) dig += Rt[mods.slice(50 + i * 7, 57 + i * 7)];
  return String(prim[par]) + dig;
}

describe('código de barras EAN-13 (GS1)', () => {
  it('codifica e decodifica 50 ISBNs aleatórios', () => {
    let s = 7;
    for (let k = 0; k < 50; k++) {
      let doze = '978';
      for (let i = 0; i < 9; i++) { s = (s * 1103515245 + 12345) >>> 0; doze += String(s % 10); }
      const ean = doze + digitoEan13(doze);
      expect(decodificar(modulosEan13(ean))).toBe(ean);
    }
  });
  it('tamanho nominal a 100%: 95 módulos de 0,33 mm + margens 11/7 = 37,29 mm', () => {
    const g = geometriaEan13('9780306406157', 1);
    expect(g.largura).toBeCloseTo(37.29, 2);
    const g80 = geometriaEan13('9780306406157', 0.8);
    expect(g80.largura).toBeCloseTo(37.29 * 0.8, 2);
  });
  it('complemento de 5 dígitos começa com 1011 e tem 47 módulos', () => {
    const m = modulosComplemento('52495');
    expect(m.startsWith('1011')).toBe(true);
    expect(m.length).toBe(4 + 5 * 7 + 4 * 2);
  });
});

describe('normas editoriais no motor', () => {
  const base = { paginas: comBrancos(2) };
  it('livro sem ISBN gera aviso de obrigatoriedade (Lei 10.753/2003)', () => {
    const r = executarMotor(livroInfantil(base), AGORA);
    expect(r.constatacoes.some((c) => c.codigo === 'ISBN-002')).toBe(true);
  });
  it('ISBN válido em autocapa: código posicionado na última página, junto à lombada, dentro da margem', () => {
    const r = executarMotor(livroInfantil({ ...base, editorial: { identificador: { tipo: 'isbn', codigo: '978-0-306-40615-7' }, codigoBarras: { ampliacao: 1, posicao: 'inferior_direita', aplicarNaCapa: true }, paginas: {} } }), AGORA);
    expect(r.editorial.posicao).toMatchObject({ alvo: 'pagina_miolo', pagina: 32 });
    const g = r.editorial.codigo!;
    expect(r.editorial.posicao!.x + g.largura).toBeLessThanOrEqual(160 - 5 + 1e-9);
    expect(r.editorial.posicao!.y + g.altura).toBeCloseTo(230 - 5, 6);
  });
  it('brochura: código fora da faixa do vinco de dobradiça', () => {
    const r = executarMotor(livroInfantil({ modelo: 'brochura_pur', paginas: registrarPaginas('m', 160), capa: { modelo: 'separada_flexivel', fonte: { fonte: 'arquivo_separado' } },
      editorial: { identificador: { tipo: 'isbn', codigo: '978-0-306-40615-7' }, codigoBarras: { ampliacao: 1, posicao: 'inferior_direita', aplicarNaCapa: false }, paginas: {} } }, 0), AGORA);
    const p4 = r.capa.planificacao!.paineis.find((p) => p.nome === '4ª capa')!;
    const pos = r.editorial.posicao!;
    expect(pos.x + r.editorial.codigo!.largura).toBeLessThanOrEqual(p4.x + p4.largura - 5 - 6 + 1e-9);
  });
  it('ampliação fora de 80–200% é erro; folha de rosto par e créditos fora do verso são erros', () => {
    const r = executarMotor(livroInfantil({ ...base, editorial: { identificador: { tipo: 'isbn', codigo: '9780306406157' }, codigoBarras: { ampliacao: 0.6, posicao: 'inferior_direita', aplicarNaCapa: false }, paginas: { folhaRosto: 4, creditos: 7, capitulos: [9, 12] } } }), AGORA);
    const cods = r.constatacoes.map((c) => c.codigo);
    expect(cods).toContain('COD-001');
    expect(cods).toContain('EDI-001');
    expect(cods).toContain('EDI-002');
    expect(r.constatacoes.find((c) => c.codigo === 'EDI-003')!.mensagem).toMatch(/12/);
  });
});

describe('páginas duplas divididas e PDF em ordem de leitura', () => {
  it('arquivo em duplas (320 mm) dividido: cada metade confere com 160 mm e gera PDF', async () => {
    // 1 capa simples + 15 duplas + 1 contracapa simples = 32 páginas do livro
    const simples = await pdfAmostra(2, 160, 230, 3);
    const duplas = await pdfAmostra(15, 320, 230, 3);
    const doc = await PDFDocument.create();
    const s = await PDFDocument.load(simples); const d = await PDFDocument.load(duplas);
    const [c1] = await doc.copyPages(s, [0]); doc.addPage(c1!);
    for (const p of await doc.copyPages(d, d.getPageIndices())) doc.addPage(p);
    const [c2] = await doc.copyPages(s, [1]); doc.addPage(c2!);
    const bytes = await doc.save();
    const insp = await inspecionarPdf(bytes);
    const paginas = [] as ReturnType<typeof registrarPaginas>;
    insp.dimensoes.forEach((dm, i) => {
      if (dm.larguraMm > 300) (['esquerda', 'direita'] as const).forEach((rc) => paginas.push({ id: `a#${i + 1}${rc[0]}`, tipo: 'conteudo', papel: 'miolo', origem: { arquivo: 'a', indice: i, recorte: rc } }));
      else paginas.push({ id: `a#${i + 1}`, tipo: 'conteudo', papel: 'miolo', origem: { arquivo: 'a', indice: i } });
    });
    expect(paginas.length).toBe(32);
    const e = livroInfantil({ paginas, dimensoesOrigem: insp.dimensoes });
    const r = executarMotor(e, AGORA);
    expect(r.constatacoes.filter((c) => c.codigo === 'ARQ-001')).toEqual([]);
    expect(r.formas.length).toBeGreaterThan(0);
    const imposto = await PDFDocument.load(await gerarPdfImposto(bytes, e, r));
    expect(imposto.getPageCount()).toBe(r.formas.length * 2);
    const ordem = await PDFDocument.load(await gerarPdfOrdemLeitura(bytes, e, r, { marcas: true, sangria: 3 }));
    expect(ordem.getPageCount()).toBe(32);
    const t = ordem.getPage(0).getTrimBox();
    expect(t.width * 25.4 / 72).toBeCloseTo(160, 3);
  });
});
