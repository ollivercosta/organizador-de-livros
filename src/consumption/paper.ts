/**
 * Consumo de papel e chapas (RF-023, RF-031; RN-010: estimativa ≠ orçamento).
 *
 * Por forma de impressão:
 *   cópias por folha c = Σ posições da unidade × (2 se a mesma chapa imprime os dois lados, senão 1)
 *   folhas líquidas    = ⌈ tiragem / c ⌉
 *   folhas brutas      = ⌈ folhas líquidas × (1 + perda%) ⌉ + acerto (folhas de acerto por forma)
 *   peso (kg)          = folhas brutas × (L × A em m²) × gramatura / 1000
 *   chapas             = cores frente + cores verso (frente/verso e perfecting)
 *                        = max(cores) (mesma chapa: virada lateral/pinça)
 */

import { arred, combinarStatus, type Status, type Valor } from '../core/evidence.js';
import type { Forma } from '../press/layout.js';

export interface ParametrosConsumo {
  tiragem: Valor<number>;
  perdaPercentual: Valor<number>;
  acertoFolhasPorForma: Valor<number>;
  gramatura: Valor<number>;
  coresFrente: number;
  coresVerso: number;
}

export interface LinhaConsumo {
  forma: string;
  componente: string;
  folha: string;
  copiasPorFolha: number;
  folhasLiquidas: number;
  folhasBrutas: number;
  pesoKg: number | null;
  chapas: number;
}

export interface Consumo {
  linhas: LinhaConsumo[];
  totalFolhas: number;
  totalPesoKg: number | null;
  totalChapas: number;
  status: Status;
  premissas: string[];
}

export function calcularConsumo(componente: string, formas: readonly Forma[], p: ParametrosConsumo): Consumo {
  const premissas: string[] = [];
  const tir = p.tiragem.valor;
  if (tir === null) {
    return { linhas: [], totalFolhas: 0, totalPesoKg: null, totalChapas: 0, status: 'pendente', premissas: ['Tiragem não informada.'] };
  }
  const perda = (p.perdaPercentual.valor ?? 0) / 100;
  const acerto = p.acertoFolhasPorForma.valor ?? 0;
  if (p.perdaPercentual.valor === null) premissas.push('Perda % não informada — considerada 0 (estimativa).');
  if (p.acertoFolhasPorForma.valor === null) premissas.push('Acerto por forma não informado — considerado 0 (estimativa).');

  const linhas: LinhaConsumo[] = formas.map((f) => {
    const c = Math.min(...Object.values(f.copiasPorFolha));
    const liq = Math.ceil(tir / c);
    const brutas = Math.ceil(liq * (1 + perda)) + acerto;
    const area = (f.folha.largura / 1000) * (f.folha.altura / 1000);
    const peso = p.gramatura.valor === null ? null : arred(brutas * area * p.gramatura.valor / 1000, 2);
    const chapas = f.mesmaChapa ? Math.max(p.coresFrente, p.coresVerso) : p.coresFrente + p.coresVerso;
    return { forma: f.id, componente, folha: `${f.folha.largura}×${f.folha.altura}`, copiasPorFolha: c, folhasLiquidas: liq, folhasBrutas: brutas, pesoKg: peso, chapas };
  });
  const totalPeso = linhas.some((l) => l.pesoKg === null) ? null : arred(linhas.reduce((a, l) => a + (l.pesoKg ?? 0), 0), 2);
  const status = combinarStatus([p.tiragem.status, p.perdaPercentual.status, p.acertoFolhasPorForma.status, p.gramatura.status]);
  premissas.push(`Perda ${arred(perda * 100, 2)}% e acerto de ${acerto} folhas por forma.`);
  return {
    linhas,
    totalFolhas: linhas.reduce((a, l) => a + l.folhasBrutas, 0),
    totalPesoKg: totalPeso,
    totalChapas: linhas.reduce((a, l) => a + l.chapas, 0),
    status: status === 'calculado' ? 'calculado' : status,
    premissas,
  };
}
