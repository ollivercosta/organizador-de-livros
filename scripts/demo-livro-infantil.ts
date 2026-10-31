/**
 * Demonstração ponta a ponta com o livro infantil da seção 20:
 *   cenário A — autocapa (32 pp, 2 brancos aprovados)
 *   cenário B — capa separada triplex (miolo 26 → 28 pp, cadernos 16+8+4) + capa planificada
 * Saída em out/: PDFs impostos, capa, ficha técnica, mapa CSV e resultado JSON.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { inserirBrancos, registrarPaginas } from '../src/binding/pagination.js';
import { executarMotor } from '../src/engine.js';
import { gerarPdfCapa, gerarPdfImposto, inspecionarPdf } from '../src/pdf/impose.js';
import { fichaTecnica, mapaCsv } from '../src/report/export.js';
import { livroInfantil } from '../test/fixtures.js';
import { pdfAmostra } from '../src/pdf/amostra.js';

mkdirSync('out', { recursive: true });

const rotulosA = (i: number) => (i === 0 ? '1ª capa' : i === 1 ? '2ª capa' : i === 28 ? '3ª capa' : i === 29 ? '4ª capa' : i === 27 ? 'Página em branco (original)' : `Miolo`);
const origem = await pdfAmostra(30, 160, 230, 3, rotulosA);
writeFileSync('out/origem-30pp.pdf', origem);
const insp = await inspecionarPdf(origem);

// Cenário A — autocapa
{
  const paginas = inserirBrancos(registrarPaginas('livro.pdf', 30), 2, { tipo: 'antes_da_contracapa' }, 'Completar 2 cadernos de 16 pp (aprovado pelo usuário)', 'Josah', '2026-10-31T12:00:00Z');
  const e = livroInfantil({ paginas, dimensoesOrigem: insp.dimensoes });
  const r = executarMotor(e);
  writeFileSync('out/A-ficha-tecnica.txt', fichaTecnica(e, r));
  writeFileSync('out/A-mapa.csv', mapaCsv(r));
  writeFileSync('out/A-resultado.json', JSON.stringify(r, null, 2));
  writeFileSync('out/A-miolo-imposto.pdf', await gerarPdfImposto(origem, e, r, { rotularBrancos: true }));
  console.log('A:', r.rotuloNivel, '| plano', r.plano.escolhido, '| formas', r.formas.map((f) => f.id).join(','));
}

// Cenário B — capa separada triplex 250 (4 faces no PDF)
{
  const base = registrarPaginas('livro.pdf', 30);
  const e0 = livroInfantil({ capa: { modelo: 'separada_flexivel', fonte: { fonte: 'no_pdf', facesNoPdf: 4 } }, paginas: base, dimensoesOrigem: insp.dimensoes });
  const r0 = executarMotor(e0);
  const pend = r0.constatacoes.find((c) => c.codigo === 'PAG-001');
  console.log('B (antes):', pend?.mensagem, '\n   opções:', pend?.opcoes?.join(' | '));
  // usuário aprova +2 brancos no fim do miolo (antes da 3ª capa, que está nas 2 últimas páginas do arquivo)
  const paginas = inserirBrancos(base, 2, { tipo: 'antes_da_contracapa' }, 'Completar miolo de 28 pp (16+8+4) — aprovado', 'Josah', '2026-10-31T12:05:00Z');
  const e = { ...e0, paginas, projeto: { ...e0.projeto, versao: 2 } };
  const r = executarMotor(e);
  writeFileSync('out/B-ficha-tecnica.txt', fichaTecnica(e, r));
  writeFileSync('out/B-mapa.csv', mapaCsv(r));
  writeFileSync('out/B-miolo-imposto.pdf', await gerarPdfImposto(origem, e, r, { rotularBrancos: true }));
  if (r.capa.planificacao) {
    writeFileSync('out/B-capa-planificada.pdf', await gerarPdfCapa(r.capa.planificacao, e, r, { origemBytes: origem, externa: { primeira: 0, quarta: 29 }, interna: { segunda: 1, terceira: 28 } }));
  }
  console.log('B:', r.rotuloNivel, '| plano', r.plano.escolhido, '| formas', r.formas.map((f) => `${f.id}(${f.posicoes.length}pos)`).join(','), '| capa', r.capa.planificacao?.largura, '×', r.capa.planificacao?.altura);
}
