/**
 * Identificadores padronizados de publicações.
 *
 *  ISBN (ISO 2108) — livros e publicações monográficas. ISBN-13 com prefixo 978/979;
 *    ISBN-10 (anterior a 2007) é convertido para 978 + 9 dígitos + novo dígito verificador.
 *    Cada formato (brochura, capa dura, e-book) e cada nova edição com alteração recebe ISBN próprio;
 *    reimpressão sem alteração mantém o mesmo. No Brasil, a Lei 10.753/2003 (art. 6º) torna
 *    obrigatórios o ISBN e a ficha catalográfica na editoração do livro.
 *  ISSN (ISO 3297) — publicações seriadas (revistas, periódicos). EAN-13 = 977 + 7 dígitos do ISSN
 *    (sem o verificador) + 2 dígitos de variante/edição + dígito verificador EAN.
 *  ISMN (ISO 10957) — música impressa: 979-0 + 8 dígitos + verificador.
 *
 * A hifenização correta depende das faixas de registrantes publicadas pela agência ISBN;
 * por isso o sistema valida os dígitos e preserva a forma hifenizada informada pelo usuário.
 */

export type TipoIdentificador = 'isbn' | 'issn' | 'ismn' | 'nenhum';

export interface IdentificadorValidado {
  tipo: TipoIdentificador;
  valido: boolean;
  /** 13 dígitos para o código de barras EAN-13. */
  ean13: string | null;
  /** Forma para exibição (com hífens se o usuário informou; senão só dígitos). */
  exibicao: string;
  mensagens: string[];
  convertidoDeIsbn10?: boolean;
}

const so = (s: string) => s.replace(/[^0-9Xx]/g, '').toUpperCase();

export function digitoEan13(doze: string): number {
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10;
}

export function digitoIsbn10(nove: string): string {
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(nove[i]) * (10 - i);
  const d = (11 - (soma % 11)) % 11;
  return d === 10 ? 'X' : String(d);
}

export function digitoIssn(sete: string): string {
  let soma = 0;
  for (let i = 0; i < 7; i++) soma += Number(sete[i]) * (8 - i);
  const d = (11 - (soma % 11)) % 11;
  return d === 10 ? 'X' : String(d);
}

export function validarIsbn(entrada: string): IdentificadorValidado {
  const d = so(entrada);
  const msgs: string[] = [];
  const hifenizado = /-/.test(entrada) ? entrada.trim().toUpperCase().replace(/^ISBN[:\s-]*/i, '') : null;
  if (d.length === 10) {
    if (!/^\d{9}[\dX]$/.test(d)) return { tipo: 'isbn', valido: false, ean13: null, exibicao: entrada, mensagens: ['ISBN-10 deve ter 9 dígitos e o verificador (0–9 ou X).'] };
    if (digitoIsbn10(d.slice(0, 9)) !== d[9]) return { tipo: 'isbn', valido: false, ean13: null, exibicao: entrada, mensagens: [`Dígito verificador do ISBN-10 inválido (esperado ${digitoIsbn10(d.slice(0, 9))}).`] };
    const doze = '978' + d.slice(0, 9);
    const ean = doze + digitoEan13(doze);
    msgs.push(`ISBN-10 convertido para ISBN-13 ${ean}. Livros publicados desde 2007 usam o ISBN-13.`);
    return { tipo: 'isbn', valido: true, ean13: ean, exibicao: ean, mensagens: msgs, convertidoDeIsbn10: true };
  }
  if (d.length !== 13 || !/^\d{13}$/.test(d)) return { tipo: 'isbn', valido: false, ean13: null, exibicao: entrada, mensagens: ['ISBN-13 deve ter 13 dígitos.'] };
  if (!d.startsWith('978') && !d.startsWith('979')) return { tipo: 'isbn', valido: false, ean13: null, exibicao: entrada, mensagens: ['ISBN-13 começa com 978 ou 979.'] };
  if (d.startsWith('9790')) return { tipo: 'isbn', valido: false, ean13: null, exibicao: entrada, mensagens: ['O prefixo 979-0 é reservado ao ISMN (música impressa), não ao ISBN.'] };
  const esperado = digitoEan13(d.slice(0, 12));
  if (esperado !== Number(d[12])) return { tipo: 'isbn', valido: false, ean13: null, exibicao: entrada, mensagens: [`Dígito verificador inválido (esperado ${esperado}).`] };
  if (hifenizado && so(hifenizado) !== d) msgs.push('A forma hifenizada não corresponde aos dígitos.');
  if (hifenizado && hifenizado.split('-').length !== 5) msgs.push('O ISBN-13 hifenizado tem 5 partes (prefixo-grupo-editor-título-verificador). Use a forma fornecida pela agência ISBN.');
  if (!hifenizado) msgs.push('Informe a forma hifenizada fornecida pela Agência Brasileira do ISBN para impressão (ex.: 978-65-XXXX-XXX-X).');
  if (d.startsWith('97865') || d.startsWith('97885')) { /* grupo Brasil */ } else msgs.push('Prefixo de grupo diferente de Brasil (65 ou 85): confira o registro.');
  return { tipo: 'isbn', valido: true, ean13: d, exibicao: hifenizado ?? d, mensagens: msgs };
}

export function validarIssn(entrada: string, variante = '00'): IdentificadorValidado {
  const d = so(entrada);
  if (!/^\d{7}[\dX]$/.test(d)) return { tipo: 'issn', valido: false, ean13: null, exibicao: entrada, mensagens: ['ISSN tem 8 caracteres (NNNN-NNNC).'] };
  const esp = digitoIssn(d.slice(0, 7));
  if (esp !== d[7]) return { tipo: 'issn', valido: false, ean13: null, exibicao: entrada, mensagens: [`Dígito verificador do ISSN inválido (esperado ${esp}).`] };
  const v = /^\d{2}$/.test(variante) ? variante : '00';
  const doze = '977' + d.slice(0, 7) + v;
  return { tipo: 'issn', valido: true, ean13: doze + digitoEan13(doze), exibicao: `${d.slice(0, 4)}-${d.slice(4)}`, mensagens: ['O número da edição vai no complemento de 2 dígitos do código de barras.'] };
}

export function validarIsmn(entrada: string): IdentificadorValidado {
  let d = so(entrada.replace(/^M/i, '9790'));
  if (d.length === 9 && /^\d{9}$/.test(d)) d = '9790' + d; // forma antiga M-XXXX-XXXX
  if (!/^9790\d{9}$/.test(d)) return { tipo: 'ismn', valido: false, ean13: null, exibicao: entrada, mensagens: ['ISMN-13 começa com 979-0 e tem 13 dígitos.'] };
  const esp = digitoEan13(d.slice(0, 12));
  if (esp !== Number(d[12])) return { tipo: 'ismn', valido: false, ean13: null, exibicao: entrada, mensagens: [`Dígito verificador inválido (esperado ${esp}).`] };
  return { tipo: 'ismn', valido: true, ean13: d, exibicao: entrada.trim(), mensagens: [] };
}

export function validarIdentificador(tipo: TipoIdentificador, codigo: string, variante?: string): IdentificadorValidado {
  if (tipo === 'isbn') return validarIsbn(codigo);
  if (tipo === 'issn') return validarIssn(codigo, variante);
  if (tipo === 'ismn') return validarIsmn(codigo);
  return { tipo: 'nenhum', valido: true, ean13: null, exibicao: '', mensagens: [] };
}

/** Rótulo impresso acima do código (ex.: "ISBN 978-65-…"). */
export function rotuloImpresso(v: IdentificadorValidado): string {
  return v.tipo === 'isbn' ? `ISBN ${v.exibicao}` : v.tipo === 'issn' ? `ISSN ${v.exibicao}` : v.tipo === 'ismn' ? `ISMN ${v.exibicao}` : '';
}
