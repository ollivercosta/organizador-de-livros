/**
 * Regras editoriais do livro (ISBN e apresentação) — o projeto NÃO gera ISBN nem código de barras:
 * ambos vêm da Agência Brasileira do ISBN. Aqui ficam as REGRAS de posição e a correção da paginação.
 *
 * Referências:
 *  - Lei 10.753/2003 (Política Nacional do Livro), art. 6º: ISBN e ficha catalográfica obrigatórios.
 *  - ABNT NBR 6029: folha de rosto no anverso (página ímpar); no verso dela (página par seguinte):
 *    créditos, direitos autorais, ISBN e ficha catalográfica.
 *  - Ficha catalográfica elaborada por bibliotecário (registro no CRB).
 *  - ISBN e código de barras também na 4ª capa; um ISBN por formato e por edição alterada.
 *  - Lei 10.994/2004: depósito legal na Biblioteca Nacional.
 *  - ABNT NBR 12225: título na lombada no sentido longitudinal, legível de cima para baixo.
 *  - Convenção editorial: capítulos começam em página ímpar.
 *
 * As posições são guardadas pelo ID da página (não pelo número): inserir brancos não perde a marcação.
 */

import { MODELOS, type ModeloId } from '../binding/models.js';
import type { PaginaRegistro } from '../binding/pagination.js';
import type { Constatacao } from '../validate/verify.js';

export interface DadosEditoriais {
  /** O livro terá ISBN (ativa as regras de posição). */
  temIsbn: boolean;
  paginas: { folhaRostoId?: string; creditosId?: string; capitulosIds?: string[] };
}

export const EDITORIAL_PADRAO: DadosEditoriais = { temIsbn: true, paginas: {} };

/** Área recomendada para o código de barras enviado pela Agência ISBN (guia, não o código). */
export interface AreaCodigo { alvo: 'planificacao' | 'pagina_miolo' | 'folha_capa'; pagina?: number; x: number; y: number; w: number; h: number }

export interface ResultadoEditorial {
  numeros: { folhaRosto: number | null; creditos: number | null; capitulos: number[] };
  areaCodigo: AreaCodigo | null;
  constatacoes: Constatacao[];
}

/** Tamanho nominal GS1 do EAN-13 a 100% (com margens de silêncio): 37,29 × 25,93 mm; mínimo 80%. */
export const CODIGO_NOMINAL = { w: 37.29, h: 25.93, minimo: 0.8 };

export interface PainelQuarta { alvo: AreaCodigo['alvo']; pagina?: number; x0: number; largura: number; altura: number; lombadaADireita: boolean; folgaLombada: number }

export function avaliarEditorial(
  d: DadosEditoriais | undefined,
  modelo: ModeloId,
  miolo: readonly PaginaRegistro[],
  quarta: PainelQuarta | null,
  margemSeguranca: number,
  lombadaMm: number | null,
): ResultadoEditorial {
  const c: Constatacao[] = [];
  const dados = d ?? EDITORIAL_PADRAO;
  const mod = MODELOS[modelo];
  const num = (id?: string) => { if (!id) return null; const i = miolo.findIndex((p) => p.id === id); return i < 0 ? null : i + 1; };
  const rosto = num(dados.paginas.folhaRostoId);
  const cred = num(dados.paginas.creditosId);
  const caps = (dados.paginas.capitulosIds ?? []).map(num).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const idDe = (n: number) => miolo[n - 1]?.id ?? '';

  if (dados.temIsbn) {
    if (rosto !== null && rosto % 2 === 0) {
      c.push({
        codigo: 'EDI-001', severidade: 'erro',
        mensagem: `A folha de rosto está na página ${rosto}, que é verso (par). Ela deve ficar numa página ímpar (frente), com a ficha catalográfica atrás.`,
        evidencia: 'ABNT NBR 6029',
        acao: { tipo: 'inserir_branco', antesDe: idDe(rosto), quantidade: 1, rotulo: `Inserir 1 página em branco antes da página ${rosto}` },
      });
    }
    if (cred !== null) {
      const esperado = rosto !== null && rosto % 2 === 1 ? rosto + 1 : null;
      if (esperado !== null && cred !== esperado) {
        c.push({
          codigo: 'EDI-002', severidade: 'erro',
          mensagem: `A ficha catalográfica (ISBN) está na página ${cred}; ela deve ficar no verso da folha de rosto, na página ${esperado}.`,
          evidencia: 'ABNT NBR 6029',
          ...(cred % 2 === 1 ? { acao: { tipo: 'inserir_branco' as const, antesDe: idDe(cred), quantidade: 1, rotulo: `Inserir 1 página em branco antes da página ${cred}` } } : {}),
        });
      } else if (esperado === null && cred % 2 === 1) {
        c.push({
          codigo: 'EDI-002', severidade: 'erro',
          mensagem: `A ficha catalográfica (ISBN) está na página ${cred}, uma frente (ímpar). Ela fica no verso da folha de rosto, numa página par.`,
          evidencia: 'ABNT NBR 6029',
          acao: { tipo: 'inserir_branco', antesDe: idDe(cred), quantidade: 1, rotulo: `Inserir 1 página em branco antes da página ${cred}` },
        });
      }
    } else {
      c.push({ codigo: 'EDI-006', severidade: 'aviso', mensagem: 'Marque a página da ficha catalográfica (com o ISBN) na lista de páginas, para o projeto conferir a posição.' });
    }
    c.push({ codigo: 'EDI-005', severidade: 'nao_verificavel', mensagem: 'O ISBN e a ficha catalográfica são obrigatórios no livro (Lei 10.753/2003). A ficha é feita por bibliotecário (CRB). O ISBN e o código de barras vêm da Agência Brasileira do ISBN e vão também na 4ª capa. Cada formato (brochura, capa dura, e-book) e cada nova edição com alteração têm ISBN próprio. Após imprimir, faça o depósito legal na Biblioteca Nacional (Lei 10.994/2004).' });
  }

  const capsPares = caps.filter((p) => p % 2 === 0);
  for (const p of capsPares) {
    c.push({
      codigo: 'EDI-003', severidade: 'aviso',
      mensagem: `O capítulo da página ${p} começa numa página par (à esquerda). O costume editorial é começar na página ímpar (à direita).`,
      acao: { tipo: 'inserir_branco', antesDe: idDe(p), quantidade: 1, rotulo: `Inserir 1 página em branco antes da página ${p}` },
    });
  }

  // Área recomendada para o código de barras (fornecido pela Agência ISBN) na 4ª capa.
  let areaCodigo: AreaCodigo | null = null;
  if (dados.temIsbn && quarta) {
    const w = CODIGO_NOMINAL.w, h = CODIGO_NOMINAL.h;
    const folga = margemSeguranca + quarta.folgaLombada;
    if (w + margemSeguranca + folga <= quarta.largura && h + 2 * margemSeguranca <= quarta.altura) {
      const x = quarta.lombadaADireita ? quarta.x0 + quarta.largura - folga - w : quarta.x0 + folga;
      areaCodigo = { alvo: quarta.alvo, pagina: quarta.pagina, x, y: quarta.altura - margemSeguranca - h, w, h };
    } else {
      c.push({ codigo: 'COD-002', severidade: 'aviso', mensagem: 'A 4ª capa é pequena para o código de barras no tamanho nominal; o mínimo permitido é 80% (29,8 × 20,7 mm).' });
    }
  }

  if (lombadaMm !== null && mod.lombada !== 'sem_lombada' && mod.lombada !== 'mecanica') {
    if (lombadaMm < 5) c.push({ codigo: 'EDI-007', severidade: 'aviso', mensagem: `A lombada tem ${lombadaMm.toFixed(1)} mm: estreita para texto legível (o usual é a partir de uns 5 mm). Considere deixá-la sem texto.` });
    else c.push({ codigo: 'EDI-008', severidade: 'info', mensagem: 'Texto da lombada no comprimento, para ser lido de cima para baixo: título, autor e editora (ABNT NBR 12225).' });
  }

  return { numeros: { folhaRosto: rosto, creditos: cred, capitulos: caps }, areaCodigo, constatacoes: c };
}
