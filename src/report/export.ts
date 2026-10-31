/**
 * Exportações documentais: ficha técnica (RF-017), mapa de imposição CSV (RF-018/RF-028),
 * relatório de validação (RF-020). Todas preservam os estados de incerteza.
 */

import { MODELOS } from '../binding/models.js';
import { REGISTRO } from '../config/registry.js';
import type { Valor } from '../core/evidence.js';
import type { EntradaProjeto, ResultadoMotor } from '../engine.js';

const STATUS_TXT: Record<string, string> = {
  confirmado: 'confirmado (gráfica)', informado: 'informado (projeto)', calculado: 'calculado', estimado: 'estimado/genérico', pendente: 'PENDENTE', nao_verificavel: 'não verificável',
};

const fmt = (v: Valor<unknown> | null | undefined, un = ''): string =>
  !v ? '—' : v.valor === null ? `PENDENTE${v.fonte ? ` (${v.fonte})` : ''}` : `${Array.isArray(v.valor) ? v.valor.join('/') : String(v.valor)}${un ? ' ' + un : v.unidade ? ' ' + v.unidade : ''} [${STATUS_TXT[v.status] ?? v.status}]`;

export function fichaTecnica(e: EntradaProjeto, r: ResultadoMotor): string {
  const L: string[] = [];
  const m = MODELOS[e.modelo];
  L.push(`FICHA TÉCNICA — ${e.projeto.nome} (versão ${e.projeto.versao})`);
  L.push(`Status de saída: ${r.rotuloNivel}`);
  L.push(`Motor ${r.versaoMotor} · regra ${r.versaoRegra} · hash da entrada ${r.hashEntrada}`);
  L.push('');
  L.push('PRODUTO');
  L.push(`  Modelo: ${m.nome} · montagem ${r.montagem} · encadernação ${r.bordaEncadernacao === 'left' ? 'à esquerda (LTR)' : r.bordaEncadernacao === 'right' ? 'à direita (RTL)' : 'superior'}`);
  L.push(`  Formato fechado: ${e.formato.largura} × ${e.formato.altura} mm [informado]`);
  L.push(`  Capa: ${e.capa.modelo}${e.capa.orelha ? ` · orelhas ${e.capa.orelha} mm` : ''}${e.capa.sobrecapa ? ' · com sobrecapa' : ''}`);
  L.push(`  Páginas: arquivo ${e.paginas.length} · miolo ${r.componentes.miolo.length} (brancos ${r.componentes.miolo.filter((p) => p.tipo === 'branco').length}) · capa ${r.componentes.capa?.length ?? (e.capa.modelo === 'autocapa' ? 'integrada' : 0)}`);
  L.push(`  Plano de cadernos: ${r.plano.escolhido ? r.plano.escolhido.join(' + ') : 'NÃO DEFINIDO'}`);
  L.push(`  Tiragem: ${e.tiragem ?? 'PENDENTE'} · cores miolo ${e.cores.mioloFrente}×${e.cores.mioloVerso} · capa ${e.cores.capaFrente}×${e.cores.capaVerso}`);
  L.push('');
  L.push('FÍSICA');
  L.push(`  Calibre do miolo: ${fmt(r.fisica.calibreMiolo)}`);
  L.push(`  Calibre da capa: ${fmt(r.fisica.calibreCapa)}`);
  L.push(`  Espessura do bloco: ${fmt(r.fisica.espessuraBloco)}`);
  L.push(`  Lombada: ${r.fisica.lombada ? fmt(r.fisica.lombada) : 'não se aplica'}`);
  L.push(`  Creep: ${fmt(r.fisica.creepPorFolha)} · deslocamento máximo ${r.fisica.creepMaximo} mm`);
  if (r.capa.planificacao) {
    const p = r.capa.planificacao;
    L.push('');
    L.push(`CAPA — ${p.componente}`);
    L.push(`  Planificada: ${p.largura} × ${p.altura} mm + sangria ${p.sangria} mm [${STATUS_TXT[p.status] ?? p.status}]`);
    L.push(`  Painéis: ${p.paineis.map((x) => `${x.nome} ${x.largura.toFixed(2)}`).join(' | ')}`);
    p.premissas.forEach((x) => L.push(`  Premissa: ${x}`));
    if (p.pendencias.length) L.push(`  Pendências: ${p.pendencias.join(', ')}`);
  }
  if (r.capa.sobrecapa) L.push(`  Sobrecapa: ${r.capa.sobrecapa.largura} × ${r.capa.sobrecapa.altura} mm`);
  L.push('');
  L.push('FORMAS DE IMPRESSÃO');
  for (const f of [...r.formas, ...r.formasCapa]) {
    L.push(`  ${f.id}: folha ${f.folha.largura}×${f.folha.altura} · ${f.modo}${f.mesmaChapa ? ' (chapa única)' : ` · verso ${f.viradaVerso}`} · ${f.posicoes.length} posição(ões) · forma ${f.rotacaoForma}° · unidades ${f.unidades.map((u) => u + 1).join(',')} · cópias/folha ${Object.values(f.copiasPorFolha).join(',')}`);
  }
  for (const [nome, cons] of [['Miolo', r.consumo.miolo], ['Capa', r.consumo.capa]] as const) {
    if (!cons) continue;
    L.push('');
    L.push(`CONSUMO — ${nome} [${STATUS_TXT[cons.status] ?? cons.status}] (estimativa — não é orçamento)`);
    cons.linhas.forEach((l) => L.push(`  ${l.forma}: ${l.folhasLiquidas} líquidas → ${l.folhasBrutas} brutas · ${l.pesoKg ?? '?'} kg · ${l.chapas} chapas`));
    L.push(`  Total: ${cons.totalFolhas} folhas · ${cons.totalPesoKg ?? '?'} kg · ${cons.totalChapas} chapas`);
    cons.premissas.forEach((x) => L.push(`  Premissa: ${x}`));
  }
  L.push('');
  L.push('PARÂMETROS DE PRODUÇÃO (origem)');
  for (const d of REGISTRO) {
    const v = r.parametros.find((p) => p.chave === d.chave);
    if (!v) continue;
    L.push(`  ${d.critico ? '*' : ' '} ${d.rotulo}: ${fmt(v)}${v.fonte ? ` — ${v.fonte}` : ''}`);
  }
  L.push('  (* = crítico para produção)');
  L.push('');
  L.push('CONSTATAÇÕES');
  for (const c of r.constatacoes) {
    L.push(`  [${c.severidade.toUpperCase()}] ${c.codigo} — ${c.mensagem}${c.evidencia ? ` · ${c.evidencia}` : ''}`);
    c.opcoes?.forEach((o) => L.push(`      opção: ${o}`));
  }
  L.push('');
  L.push('Este documento não substitui a aprovação da gráfica. Valores marcados como estimados ou pendentes não podem ser tratados como confirmados.');
  return L.join('\n');
}

export function mapaCsv(r: ResultadoMotor): string {
  const head = ['componente', 'pagina', 'id', 'rotulo', 'tipo', 'unidade', 'celula_col', 'celula_row', 'celula_face', 'forma', 'lado', 'posicao', 'rotacao_graus', 'versao_regra', 'hash'];
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = r.mapa.map((m) => [m.componente, m.pagina, m.paginaId, m.rotulo, m.tipo, m.unidade + 1, m.celula?.col, m.celula?.row, m.celula?.face, m.forma, m.lado, m.posicao === null ? '' : m.posicao + 1, m.rotacao, r.versaoRegra, r.hashEntrada]);
  return [head, ...rows].map((l) => l.map(esc).join(',')).join('\n');
}
