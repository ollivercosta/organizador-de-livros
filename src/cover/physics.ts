/**
 * Física do produto: calibre, espessura do bloco, lombada, creep.
 *
 * Fórmulas (todas registradas no resultado — RF-022, RNF-001):
 *   calibre (µm) = gramatura (g/m²) × bulk (cm³/g)        [1 cm³/m² = 1 µm]
 *   folhas do bloco = páginas / 2                         [inclui brancos]
 *   espessura do bloco (mm) = folhas × calibre / 1000
 *   lombada brochura (mm) = bloco + 2 × calibre_capa/1000 (se configurado) + acréscimo da gráfica
 *   creep (mm) da folha na profundidade d = d × calibre/1000 × fator
 *     d = nº de folhas dobradas que envolvem a folha na lombada.
 *     No grampo canoa: d_global = folhas dobradas dos cadernos externos + d local (+1 se capa separada).
 *     Deslocamento máximo = (nº total de folhas dobradas − 1) × calibre × fator.
 */

import { arred, calculado, type Proveniencia, type Valor } from '../core/evidence.js';

export interface Material {
  id: string;
  nome: string;
  gramatura: Valor<number>; // g/m²
  calibreUm: Valor<number>; // µm (preferencial)
  bulk?: Valor<number>; // cm³/g (alternativa)
}

export function calibreMm(m: Material): Valor<number> {
  if (m.calibreUm.valor !== null) {
    return { ...m.calibreUm, valor: m.calibreUm.valor / 1000, unidade: 'mm', fonte: `calibre ${m.calibreUm.valor} µm` };
  }
  if (m.bulk && m.bulk.valor !== null && m.gramatura.valor !== null) {
    const v = (m.gramatura.valor * m.bulk.valor) / 1000;
    const r = calculado(arred(v, 5), [m.gramatura, m.bulk], 'mm', `gramatura ${m.gramatura.valor} g/m² × bulk ${m.bulk.valor} cm³/g`);
    return r;
  }
  return { valor: null, origem: 'ausente', status: 'pendente', unidade: 'mm', fonte: 'Calibre não informado (gramatura sozinha não determina espessura).' };
}

export function espessuraBloco(paginas: number, calibre: Valor<number>): Valor<number> {
  if (calibre.valor === null) return { valor: null, origem: 'ausente', status: 'pendente', unidade: 'mm', fonte: 'Depende do calibre do papel do miolo.' };
  const folhas = paginas / 2;
  return calculado(arred(folhas * calibre.valor, 2), [calibre], 'mm', `${folhas} folhas × ${calibre.valor} mm`);
}

export function lombadaBrochura(bloco: Valor<number>, calibreCapa: Valor<number>, incluirCapa: Valor<boolean>, acrescimo: Valor<number>): Valor<number> {
  const entradas: Proveniencia[] = [bloco, acrescimo, incluirCapa];
  if (bloco.valor === null || acrescimo.valor === null || incluirCapa.valor === null) {
    return { valor: null, origem: 'ausente', status: 'pendente', unidade: 'mm', fonte: 'Faltam espessura do bloco, acréscimo de lombada ou regra da capa.' };
  }
  let v = bloco.valor + acrescimo.valor;
  let fonte = `bloco ${bloco.valor} + acréscimo ${acrescimo.valor}`;
  if (incluirCapa.valor) {
    if (calibreCapa.valor === null) return { valor: null, origem: 'ausente', status: 'pendente', unidade: 'mm', fonte: 'Falta calibre da capa.' };
    v += 2 * calibreCapa.valor;
    entradas.push(calibreCapa);
    fonte += ` + 2 × capa ${calibreCapa.valor}`;
  }
  return calculado(arred(v, 2), entradas, 'mm', fonte);
}

export function creepPorProfundidade(calibre: Valor<number>, fator: Valor<number>, ativo: boolean): { fn: (d: number) => number; status: Valor<number> } {
  if (!ativo || calibre.valor === null || fator.valor === null) {
    return { fn: () => 0, status: { valor: 0, origem: 'calculado', status: ativo ? 'pendente' : 'calculado', unidade: 'mm', fonte: ativo ? 'Creep não aplicado: falta calibre ou fator.' : 'Creep desativado.' } };
  }
  const t = calibre.valor * fator.valor;
  return { fn: (d) => arred(d * t, 3), status: calculado(t, [calibre, fator], 'mm/folha', `${calibre.valor} mm × fator ${fator.valor}`) };
}
