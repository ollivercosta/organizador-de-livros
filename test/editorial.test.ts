import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { inserirBrancos, registrarPaginas } from '../src/binding/pagination.js';
import { executarMotor } from '../src/engine.js';
import { pdfAmostra } from '../src/pdf/amostra.js';
import { gerarPdfImposto, gerarPdfLadoALado, gerarPdfOrdemLeitura, inspecionarPdf } from '../src/pdf/impose.js';
import { comBrancos, livroInfantil } from './fixtures.js';

const AGORA = '2026-10-31T12:00:00.000Z';

describe('regras editoriais (ISBN / ABNT NBR 6029)', () => {
  const marcar = (paginas: ReturnType<typeof comBrancos>, rosto?: number, cred?: number, caps: number[] = []) =>
    ({ temIsbn: true, paginas: { folhaRostoId: rosto ? paginas[rosto - 1]!.id : undefined, creditosId: cred ? paginas[cred - 1]!.id : undefined, capitulosIds: caps.map((c) => paginas[c - 1]!.id) } });

  it('ficha catalográfica numa página ímpar: erro com correção "inserir branco antes"', () => {
    const paginas = comBrancos(2);
    const r = executarMotor(livroInfantil({ paginas, editorial: marcar(paginas, undefined, 3) }), AGORA);
    const c = r.constatacoes.find((x) => x.codigo === 'EDI-002')!;
    expect(c.severidade).toBe('erro');
    expect(c.acao).toMatchObject({ tipo: 'inserir_branco', antesDe: paginas[2]!.id, quantidade: 1 });
  });

  it('aplicar a correção leva a ficha para o verso (página par) e o erro some; a marcação segue a página', () => {
    const paginas = comBrancos(2);
    const ed = marcar(paginas, undefined, 3);
    const r0 = executarMotor(livroInfantil({ paginas, editorial: ed }), AGORA);
    const acao = r0.constatacoes.find((x) => x.codigo === 'EDI-002')!.acao!;
    const idx = paginas.findIndex((p) => p.id === acao.antesDe);
    const novas = inserirBrancos(paginas, 1, { tipo: 'apos_indice', indice: idx - 1 }, 'Ficha no verso da folha de rosto', 'teste', AGORA);
    const r1 = executarMotor(livroInfantil({ paginas: novas, editorial: ed }), AGORA);
    expect(r1.editorial.numeros.creditos).toBe(4);
    expect(r1.constatacoes.some((x) => x.codigo === 'EDI-002')).toBe(false);
  });

  it('folha de rosto par e ficha fora do verso são erros; capítulo em página par é aviso', () => {
    const paginas = comBrancos(2);
    const r = executarMotor(livroInfantil({ paginas, editorial: marcar(paginas, 4, 7, [9, 12]) }), AGORA);
    const cods = r.constatacoes.map((c) => c.codigo);
    expect(cods).toContain('EDI-001');
    expect(cods).toContain('EDI-002');
    expect(r.constatacoes.find((c) => c.codigo === 'EDI-003')!.mensagem).toMatch(/12/);
  });

  it('folha de rosto ímpar com ficha no verso: sem erros', () => {
    const paginas = comBrancos(2);
    const r = executarMotor(livroInfantil({ paginas, editorial: marcar(paginas, 3, 4, [5]) }), AGORA);
    expect(r.constatacoes.filter((c) => c.codigo.startsWith('EDI-00') && c.severidade !== 'nao_verificavel' && c.severidade !== 'info')).toEqual([]);
  });

  it('área recomendada para o código de barras da Agência: 4ª capa, junto à lombada, dentro da margem', () => {
    const r = executarMotor(livroInfantil({ paginas: comBrancos(2) }), AGORA);
    const a = r.editorial.areaCodigo!;
    expect(a).toMatchObject({ alvo: 'pagina_miolo', pagina: 32 });
    expect(a.x + a.w).toBeCloseTo(160 - 5, 6);
    expect(a.y + a.h).toBeCloseTo(230 - 5, 6);
  });
});

describe('pares de impressão (lado a lado)', () => {
  it('grampo canoa 32 pp em 2 cadernos de 16: ordem de livreto 32|1, 2|31, 30|3 …, soma 33', () => {
    const r = executarMotor(livroInfantil({ paginas: comBrancos(2) }), AGORA);
    expect(r.pares.length).toBe(8);
    const seq = r.pares.flatMap((p) => [p.fora, p.dentro]);
    const esperado: Array<[number, number]> = [];
    for (let j = 0; j < 8; j++) { esperado.push([32 - 2 * j, 1 + 2 * j]); esperado.push([2 + 2 * j, 31 - 2 * j]); }
    expect(seq).toEqual(esperado);
    expect(r.pares.map((p) => p.profundidade)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('RTL inverte a ordem visual', () => {
    const r = executarMotor(livroInfantil({ paginas: comBrancos(2), direcao: 'rtl' }), AGORA);
    expect(r.pares[0]!.fora).toEqual([1, 32]);
  });
  it('PDF lado a lado: 2 faces por folha dobrada, largura = 2 páginas + sangria + marcas', async () => {
    const bytes = await pdfAmostra(30, 160, 230, 3);
    const e = livroInfantil({ paginas: comBrancos(2) });
    const r = executarMotor(e, AGORA);
    const doc = await PDFDocument.load(await gerarPdfLadoALado(bytes, e, r, { sangria: 3, modo: 'impressao', creepMmPorFolha: 0.1 }));
    expect(doc.getPageCount()).toBe(16);
    const t = doc.getPage(0).getTrimBox();
    expect(t.width * 25.4 / 72).toBeCloseTo(320, 3);
    const leitura = await PDFDocument.load(await gerarPdfLadoALado(bytes, e, r, { sangria: 3, modo: 'leitura' }));
    expect(leitura.getPageCount()).toBe(17);
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
