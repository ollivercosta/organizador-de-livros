/**
 * Verificações estruturais da imposição (independentes da forma como foi calculada).
 */

import type { UnidadeMontagem } from '../binding/assembly.js';
import { verificarCaderno } from '../fold/oracle3d.js';
import type { SignatureLayout } from '../fold/simulate.js';
import type { Forma } from '../press/layout.js';

export type Severidade = 'erro' | 'aviso' | 'pendencia' | 'nao_verificavel' | 'info';

export interface Constatacao {
  codigo: string;
  severidade: Severidade;
  mensagem: string;
  evidencia?: string;
  /** Sugestões de resolução (ex.: planos de cadernos). */
  opcoes?: string[];
  /** Correção que a interface pode aplicar com um clique (com confirmação do usuário). */
  acao?: { tipo: 'inserir_branco'; antesDe: string; quantidade: number; rotulo: string };
}

/** Regras locais de um caderno (sem simular): frente/verso consecutivos e soma na lombada. */
export function regrasLocais(l: SignatureLayout): string[] {
  const erros: string[] = [];
  const P = l.paginas;
  const visto = new Set<number>();
  for (const c of l.celulas) {
    for (const p of [c.frente.pagina, c.verso.pagina]) {
      if (visto.has(p)) erros.push(`página local ${p} duplicada`);
      visto.add(p);
    }
    // Mesma folha: páginas 2k−1 e 2k
    const a = Math.min(c.frente.pagina, c.verso.pagina);
    const b = Math.max(c.frente.pagina, c.verso.pagina);
    if (!(a % 2 === 1 && b === a + 1)) erros.push(`célula ${c.col},${c.row}: frente/verso ${a}/${b} não são a mesma folha`);
  }
  for (let p = 1; p <= P; p++) if (!visto.has(p)) erros.push(`página local ${p} ausente`);

  // Pares na lombada: células vizinhas unidas pela lombada somam P+1 na mesma face.
  if (l.esquema.folds.length > 0 && l.codiceValido) {
    const at = (c: number, r: number) => l.celulas.find((x) => x.col === c && x.row === r);
    for (const c of l.celulas) {
      const viz: Array<[number, number, 'right' | 'bottom', 'left' | 'top']> = [[c.col + 1, c.row, 'right', 'left'], [c.col, c.row + 1, 'bottom', 'top']];
      for (const [nc, nr, e1, e2] of viz) {
        const o = at(nc, nr);
        if (!o || c.bordas[e1] !== 'lombada' || o.bordas[e2] !== 'lombada') continue;
        if (c.frente.pagina + o.frente.pagina !== P + 1) erros.push(`lombada entre (${c.col},${c.row}) e (${nc},${nr}): ${c.frente.pagina}+${o.frente.pagina} ≠ ${P + 1}`);
        if (c.verso.pagina + o.verso.pagina !== P + 1) erros.push(`lombada (verso) entre (${c.col},${c.row}) e (${nc},${nr}): ${c.verso.pagina}+${o.verso.pagina} ≠ ${P + 1}`);
      }
    }
  }
  return erros;
}

export function verificarUnidades(unidades: readonly UnidadeMontagem[], totalBloco: number): Constatacao[] {
  const out: Constatacao[] = [];
  const cont = new Map<number, number>();
  const esquemasChecados = new Set<SignatureLayout>();
  for (const u of unidades) {
    for (const g of u.mapa) cont.set(g, (cont.get(g) ?? 0) + 1);
    if (u.layout.esquema.id.startsWith('SANFONA')) {
      const n = u.layout.cols;
      const frente = [...u.layout.celulas].sort((a, b) => a.frente.col - b.frente.col).map((c) => c.frente.pagina);
      const verso = [...u.layout.celulas].sort((a, b) => a.verso.col - b.verso.col).map((c) => c.verso.pagina);
      const ltr = u.layout.bordaEncadernacao === 'left';
      const espF = Array.from({ length: n }, (_, i) => (ltr ? i + 1 : n - i));
      const espV = Array.from({ length: n }, (_, i) => (ltr ? n + 1 + i : 2 * n - i));
      if (frente.join() !== espF.join() || verso.join() !== espV.join()) out.push({ codigo: 'IMP-006', severidade: 'erro', mensagem: 'Ordem dos painéis da sanfona inválida.', evidencia: `frente ${frente} / verso ${verso}` });
      continue;
    }
    if (!esquemasChecados.has(u.layout)) {
      esquemasChecados.add(u.layout);
      const loc = regrasLocais(u.layout);
      if (loc.length) out.push({ codigo: 'IMP-003', severidade: 'erro', mensagem: `Regras do caderno ${u.layout.esquema.id} violadas.`, evidencia: loc.join('; ') });
      if (u.layout.esquema.folds.length > 0) {
        const or = verificarCaderno(u.layout);
        if (!or.ok) out.push({ codigo: 'IMP-002', severidade: 'erro', mensagem: `Oráculo de dobra reprovou o esquema ${u.layout.esquema.id}.`, evidencia: or.erros.join('; ') });
      }
    }
  }
  const omitidas: number[] = []; const duplicadas: number[] = [];
  for (let p = 1; p <= totalBloco; p++) {
    const c = cont.get(p) ?? 0;
    if (c === 0) omitidas.push(p);
    if (c > 1) duplicadas.push(p);
  }
  if (omitidas.length || duplicadas.length) {
    out.push({ codigo: 'IMP-001', severidade: 'erro', mensagem: 'Cobertura de páginas inválida.', evidencia: `omitidas: [${omitidas.join(', ')}] duplicadas: [${duplicadas.join(', ')}]` });
  }
  return out;
}

/** Cada forma deve conter, por posição, exatamente as páginas da unidade; e cada unidade deve estar em alguma forma. */
export function verificarFormas(formas: readonly Forma[], unidades: readonly UnidadeMontagem[]): Constatacao[] {
  const out: Constatacao[] = [];
  const unidadesImpressas = new Set<number>();
  for (const f of formas) {
    const fisicos = f.mesmaChapa ? f.ladoA : [...f.ladoA, ...f.ladoB];
    for (const pos of f.posicoes.map((_, i) => i)) {
      const itens = fisicos.filter((p) => p.posicao === pos);
      if (!itens.length) continue;
      const u = unidades.find((x) => x.indice === itens[0]!.unidade)!;
      unidadesImpressas.add(u.indice);
      const esperadas = [...u.mapa].sort((a, b) => a - b).join(',');
      const obtidas = itens.map((p) => p.pagina).sort((a, b) => a - b).join(',');
      if (esperadas !== obtidas) out.push({ codigo: 'IMP-004', severidade: 'erro', mensagem: `Forma ${f.id}, posição ${pos + 1}: páginas não correspondem à unidade ${u.indice + 1}.`, evidencia: `esperado ${esperadas} / obtido ${obtidas}` });
      // folha frente/verso: a mesma caixa de corte deve conter páginas da mesma folha nos dois lados
    }
  }
  const faltando = unidades.filter((u) => !unidadesImpressas.has(u.indice)).map((u) => u.indice + 1);
  if (faltando.length && formas.length) out.push({ codigo: 'IMP-005', severidade: 'erro', mensagem: 'Unidades sem forma de impressão.', evidencia: faltando.join(', ') });
  return out;
}
