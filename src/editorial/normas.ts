/**
 * Conformidade editorial: identificador, código de barras e estrutura do livro.
 *
 * Referências:
 *  - Lei 10.753/2003 (Política Nacional do Livro), art. 6º: ISBN e ficha catalográfica obrigatórios
 *    na editoração do livro. A ficha é elaborada por bibliotecário (registro no CRB).
 *  - Lei 10.994/2004: depósito legal na Biblioteca Nacional.
 *  - ABNT NBR 6029 (apresentação de livros): folha de rosto no anverso (página ímpar);
 *    no verso da folha de rosto, créditos, direitos autorais, ISBN e ficha catalográfica.
 *  - ABNT NBR 12225 (lombada): título no sentido longitudinal, legível de cima para baixo.
 *  - GS1 (EAN-13): ampliação 80%–200%; preto sobre fundo claro; código na 4ª capa.
 *  - Convenção editorial: capítulos e partes começam em página ímpar (recomendação, não norma).
 */

import { MODELOS, type ModeloId } from '../binding/models.js';
import type { Constatacao } from '../validate/verify.js';
import { geometriaEan13, type GeometriaCodigo } from './codigoBarras.js';
import { rotuloImpresso, validarIdentificador, type IdentificadorValidado, type TipoIdentificador } from './identificadores.js';

export type PosicaoCodigo = 'inferior_direita' | 'inferior_esquerda' | 'inferior_centro';

export interface DadosEditoriais {
  identificador: { tipo: TipoIdentificador; codigo: string; variante?: string; complemento?: string };
  codigoBarras: { ampliacao: number; posicao: PosicaoCodigo; aplicarNaCapa: boolean };
  /** Páginas do miolo (numeração do livro) com função editorial. */
  paginas: { folhaRosto?: number; creditos?: number; capitulos?: number[] };
  /** Resultado da busca do identificador no texto do PDF (null = não verificável). */
  textoIdentificador?: { creditos: boolean | null; quartaCapa: boolean | null };
}

export interface PosicaoNaCapa {
  /** Onde fica a 4ª capa: painel da capa planificada, página do miolo (autocapa) ou folha de capa. */
  alvo: 'planificacao' | 'pagina_miolo' | 'folha_capa';
  pagina?: number;
  /** Canto superior esquerdo do código, em mm, no sistema do alvo (planificação: origem no corte). */
  x: number;
  y: number;
}

export interface ResultadoEditorial {
  identificador: IdentificadorValidado | null;
  rotulo: string;
  codigo: GeometriaCodigo | null;
  posicao: PosicaoNaCapa | null;
  constatacoes: Constatacao[];
}

export const EDITORIAL_PADRAO: DadosEditoriais = {
  identificador: { tipo: 'isbn', codigo: '' },
  codigoBarras: { ampliacao: 1, posicao: 'inferior_direita', aplicarNaCapa: false },
  paginas: {},
};

/** Painel da 4ª capa na vista externa da capa (x0, largura) e lado da lombada. */
export interface PainelQuarta { x0: number; largura: number; altura: number; lombadaADireita: boolean; folgaLombada: number }

export function avaliarEditorial(
  d: DadosEditoriais | undefined,
  modelo: ModeloId,
  totalMiolo: number,
  quarta: (PainelQuarta & { alvo: PosicaoNaCapa['alvo']; pagina?: number }) | null,
  margemSeguranca: number,
  lombadaMm: number | null,
): ResultadoEditorial {
  const c: Constatacao[] = [];
  const mod = MODELOS[modelo];
  const ehLivro = modelo !== 'folhas_soltas';
  const dados = d ?? EDITORIAL_PADRAO;
  let id: IdentificadorValidado | null = null;
  let codigo: GeometriaCodigo | null = null;
  let posicao: PosicaoNaCapa | null = null;

  const { tipo, codigo: cod } = dados.identificador;
  if (tipo === 'nenhum' || !cod.trim()) {
    if (ehLivro && tipo !== 'nenhum') {
      c.push({ codigo: 'ISBN-002', severidade: 'aviso', mensagem: `${mod.nome}: livro sem ISBN informado. Para comercializar, o ISBN e a ficha catalográfica são obrigatórios (Lei 10.753/2003, art. 6º).`, opcoes: ['Solicitar o ISBN à Agência Brasileira do ISBN', 'Marcar "sem identificador" se for publicação fora do comércio'] });
    }
  } else {
    id = validarIdentificador(tipo, cod, dados.identificador.variante);
    if (!id.valido) c.push({ codigo: 'ISBN-001', severidade: 'erro', mensagem: `${tipo.toUpperCase()} inválido: ${id.mensagens.join(' ')}` });
    else {
      id.mensagens.forEach((m) => c.push({ codigo: 'ISBN-003', severidade: 'info', mensagem: m }));
      if (tipo === 'isbn') c.push({ codigo: 'ISBN-004', severidade: 'nao_verificavel', mensagem: 'Cada formato (brochura, capa dura, e-book) e cada nova edição com alteração exigem ISBN próprio. Reimpressão sem alteração mantém o ISBN.' });
    }
  }

  if (ehLivro && tipo === 'isbn') {
    c.push({ codigo: 'EDI-005', severidade: 'nao_verificavel', mensagem: 'Ficha catalográfica no verso da folha de rosto, elaborada por bibliotecário com registro no CRB. Depósito legal na Biblioteca Nacional após a impressão (Lei 10.994/2004).' });
  }

  // Estrutura (NBR 6029)
  const pg = dados.paginas;
  if (pg.folhaRosto !== undefined) {
    if (pg.folhaRosto < 1 || pg.folhaRosto > totalMiolo) c.push({ codigo: 'EDI-000', severidade: 'erro', mensagem: `Folha de rosto na página ${pg.folhaRosto}, fora do miolo (1–${totalMiolo}).` });
    else if (pg.folhaRosto % 2 === 0) c.push({ codigo: 'EDI-001', severidade: 'erro', mensagem: `Folha de rosto na página ${pg.folhaRosto} (par). Ela deve ficar no anverso, em página ímpar (ABNT NBR 6029).` });
  }
  if (pg.creditos !== undefined) {
    if (pg.folhaRosto !== undefined && pg.creditos !== pg.folhaRosto + 1) c.push({ codigo: 'EDI-002', severidade: 'erro', mensagem: `Página de créditos (${pg.creditos}) não está no verso da folha de rosto (${pg.folhaRosto + 1}).` });
    else if (pg.creditos % 2 === 1) c.push({ codigo: 'EDI-002', severidade: 'erro', mensagem: `Página de créditos (${pg.creditos}) é ímpar; o verso da folha de rosto é página par.` });
  } else if (ehLivro && pg.folhaRosto !== undefined) {
    c.push({ codigo: 'EDI-006', severidade: 'aviso', mensagem: 'Indique a página de créditos (verso da folha de rosto), onde ficam ISBN, direitos e ficha catalográfica.' });
  }
  const capsPares = (pg.capitulos ?? []).filter((p) => p % 2 === 0);
  if (capsPares.length) c.push({ codigo: 'EDI-003', severidade: 'aviso', mensagem: `Capítulo(s) iniciando em página par: ${capsPares.join(', ')}. A convenção editorial é iniciar em página ímpar (direita).` });

  if (dados.textoIdentificador && id?.valido) {
    const t = dados.textoIdentificador;
    if (t.creditos === false) c.push({ codigo: 'EDI-004', severidade: 'aviso', mensagem: `O ${tipo.toUpperCase()} não foi encontrado no texto da página de créditos.` });
    if (t.quartaCapa === false) c.push({ codigo: 'EDI-004', severidade: 'aviso', mensagem: `O ${tipo.toUpperCase()} não foi encontrado no texto da 4ª capa (pode estar só no código de barras como imagem).` });
  }

  // Código de barras
  if (id?.valido && id.ean13) {
    const amp = dados.codigoBarras.ampliacao;
    if (amp < 0.8 || amp > 2) c.push({ codigo: 'COD-001', severidade: 'erro', mensagem: `Ampliação do código de barras ${Math.round(amp * 100)}% fora da faixa GS1 (80% a 200%).` });
    const comp = dados.identificador.complemento?.trim() || (tipo === 'issn' ? (dados.identificador.variante ?? '') : '');
    const complemento = /^\d{2}$|^\d{5}$/.test(comp) ? comp : undefined;
    codigo = geometriaEan13(id.ean13, Math.min(2, Math.max(0.8, amp)), complemento, rotuloImpresso(id));
    if (quarta) {
      const folga = margemSeguranca + quarta.folgaLombada;
      const util = quarta.largura - margemSeguranca - folga;
      if (codigo.largura > util || codigo.altura > quarta.altura - 2 * margemSeguranca) {
        c.push({ codigo: 'COD-002', severidade: 'erro', mensagem: `O código de barras (${codigo.largura.toFixed(1)} × ${codigo.altura.toFixed(1)} mm) não cabe na 4ª capa respeitando a margem de segurança e a folga da lombada.` });
      } else {
        const y = quarta.altura - margemSeguranca - codigo.altura;
        // Na vista da 4ª capa, "direita" é o lado da lombada em LTR.
        const xEsq = quarta.lombadaADireita ? quarta.x0 + margemSeguranca : quarta.x0 + folga;
        const xDir = quarta.lombadaADireita ? quarta.x0 + quarta.largura - folga - codigo.largura : quarta.x0 + quarta.largura - margemSeguranca - codigo.largura;
        const x = dados.codigoBarras.posicao === 'inferior_esquerda' ? xEsq : dados.codigoBarras.posicao === 'inferior_direita' ? xDir : quarta.x0 + (quarta.largura - codigo.largura) / 2;
        posicao = { alvo: quarta.alvo, pagina: quarta.pagina, x, y };
      }
    } else {
      c.push({ codigo: 'COD-003', severidade: 'info', mensagem: 'Sem 4ª capa calculada: o código de barras é exportado à parte para o designer posicionar.' });
    }
    if (dados.codigoBarras.aplicarNaCapa) c.push({ codigo: 'COD-004', severidade: 'info', mensagem: 'O código de barras será desenhado na capa exportada (sobre fundo branco). Não o inclua também na arte para não duplicar.' });
  }

  // Lombada (NBR 12225)
  if (lombadaMm !== null && mod.lombada !== 'sem_lombada' && mod.lombada !== 'mecanica') {
    if (lombadaMm < 5) c.push({ codigo: 'EDI-007', severidade: 'aviso', mensagem: `Lombada de ${lombadaMm.toFixed(1)} mm: estreita para texto legível (usual a partir de ~5 mm). Avalie lombada sem texto.` });
    else c.push({ codigo: 'EDI-008', severidade: 'info', mensagem: 'Texto da lombada no sentido longitudinal, legível de cima para baixo (ABNT NBR 12225): título, autor e editora.' });
  }

  return { identificador: id, rotulo: id ? rotuloImpresso(id) : '', codigo, posicao, constatacoes: c };
}
