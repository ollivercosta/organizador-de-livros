/**
 * Documentos para pessoas (PDF): especificações do livro e perguntas para a gráfica.
 * Linguagem simples — é o que a gráfica lê e responde por e-mail.
 */

import { MODELOS } from '../binding/models.js';
import { REGISTRO } from '../config/registry.js';
import type { EntradaProjeto, ResultadoMotor } from '../engine.js';

type Bloco = { titulo?: string; linhas: string[] };

const ROT_CAPA: Record<string, string> = {
  autocapa: 'no mesmo papel do miolo (autocapa)', separada_flexivel: 'separada, flexível', capa_dura: 'capa dura',
  folhas_de_capa: 'folhas de capa separadas', sem_capa: 'sem capa',
};
export const ROT_ENTREGA: Record<string, string> = {
  lado_a_lado: 'PDF lado a lado, em pares de impressão (livreto), com sangria e marcas de corte',
  paginas_individuais: 'PDF de páginas individuais, em ordem de leitura, com sangria e marcas de corte',
  folhas_montadas: 'PDF das folhas de impressão já montadas',
};

const mm = (v: number | null | undefined) => (v === null || v === undefined ? 'a confirmar' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mm`);

export function especificacoes(e: EntradaProjeto, r: ResultadoMotor): Bloco[] {
  const p = (k: string) => r.parametros.find((x) => x.chave === k);
  const brancos = r.componentes.miolo.filter((x) => x.tipo === 'branco').length;
  const nCapa = r.componentes.capa?.length ?? 0;
  const entrega = String(p('arquivo.entrega')?.valor ?? 'paginas_individuais');
  const SIMPLES: Record<string, string> = {
    'arquivo.sangria': 'Sangria', 'maquina.folha.largura': 'Tamanho da folha de impressão', 'maquina.pinca': 'Margem de pinça',
    'cadernos.tamanhos': 'Páginas por caderno', 'acabamento.fresagem': 'Fresagem da lombada', 'acabamento.lombada.acrescimo': 'Acréscimo na lombada',
    'capaDura.espessuraPapelao': 'Espessura do papelão', 'capaDura.esquadro': 'Sobra do papelão', 'capaDura.canal': 'Canal da capa dura',
    'capaDura.dobraRevestimento': 'Dobra do revestimento',
  };
  const referencia = REGISTRO.filter((d) => SIMPLES[d.chave] && r.parametros.find((x) => x.chave === d.chave)?.origem === 'referencia')
    .map((d) => { const v = r.parametros.find((x) => x.chave === d.chave)!.valor; return `${SIMPLES[d.chave]}: ${Array.isArray(v) ? v.join(', ') : d.chave === 'maquina.folha.largura' ? `${v} × ${r.parametros.find((x) => x.chave === 'maquina.folha.altura')?.valor} mm` : `${v}${d.unidade ? ` ${d.unidade}` : ''}`}`; });
  const papel = (v: { valor: number | null }) => (v.valor === null ? 'a confirmar' : `${Math.round(v.valor * 1000)} µm de espessura`);
  const linhas: Bloco[] = [
    { titulo: 'Livro', linhas: [
      `Título: ${e.projeto.nome} (versão ${e.projeto.versao})`,
      `Formato fechado: ${e.formato.largura} × ${e.formato.altura} mm`,
      `Encadernação: ${MODELOS[e.modelo].nome}`,
      `Capa: ${ROT_CAPA[e.capa.modelo]}${e.capa.orelha ? `, com orelhas de ${e.capa.orelha} mm` : ''}${e.capa.sobrecapa ? ', com sobrecapa' : ''}`,
      `Páginas do miolo: ${r.componentes.miolo.length}${brancos ? ` (inclui ${brancos} em branco)` : ''}${nCapa ? ` + capa com ${nCapa} faces` : ''}`,
      `Leitura: ${e.direcao === 'ltr' ? 'da esquerda para a direita' : 'da direita para a esquerda'}${e.encadernacaoSuperior ? ', encadernação na borda superior' : ''}`,
      `Tiragem: ${e.tiragem ? `${e.tiragem.toLocaleString('pt-BR')} exemplares` : 'a definir'}`,
      `Cores: miolo ${e.cores.mioloFrente}×${e.cores.mioloVerso}${nCapa || e.capa.modelo !== 'autocapa' ? `, capa ${e.cores.capaFrente}×${e.cores.capaVerso}` : ''}`,
    ] },
    { titulo: 'Papel e medidas', linhas: [
      `Papel do miolo: ${papel(r.fisica.calibreMiolo)}`,
      ...(e.capa.modelo !== 'autocapa' && e.capa.modelo !== 'sem_capa' ? [`Papel da capa: ${papel(r.fisica.calibreCapa)}`] : []),
      `Espessura do miolo: ${mm(r.fisica.espessuraBloco.valor)}`,
      ...(r.fisica.lombada ? [`Lombada: ${mm(r.fisica.lombada.valor)}`] : []),
      ...(r.capa.planificacao ? [`Capa aberta: ${mm(r.capa.planificacao.largura)} × ${mm(r.capa.planificacao.altura)} (+ ${mm(r.capa.planificacao.sangria)} de sangria)`] : []),
      `Sangria: ${mm(Number(p('arquivo.sangria')?.valor ?? NaN) || null)}`,
      ...(r.plano.escolhido ? [`Cadernos: ${r.plano.escolhido.join(' + ')} páginas${r.montagem === 'aninhada' ? ' (um dentro do outro)' : ''}`] : []),
    ] },
    { titulo: 'Arquivo entregue', linhas: [ROT_ENTREGA[entrega] ?? entrega] },
  ];
  if (referencia.length) {
    linhas.push({ titulo: 'Valores que usamos por padrão (por favor, confirmem)', linhas: referencia.map((x) => `- ${x}`) });
  }
  if (r.editorial.areaCodigo) {
    const a = r.editorial.areaCodigo;
    linhas.push({ titulo: 'ISBN', linhas: [`Ficha catalográfica com o ISBN no verso da folha de rosto. Código de barras (fornecido pela Agência ISBN) na 4ª capa${a.alvo === 'pagina_miolo' ? ` (página ${a.pagina})` : ''}, embaixo, junto à lombada.`] });
  }
  const pend = r.constatacoes.filter((c) => c.severidade === 'erro' || c.severidade === 'pendencia');
  if (pend.length) linhas.push({ titulo: 'Pendências', linhas: pend.map((c) => `- ${c.mensagem}`) });
  linhas.push({ linhas: ['', `Documento gerado pela Plataforma de Produção Editorial · ${new Date(r.geradoEm).toLocaleDateString('pt-BR')}`] });
  return linhas;
}

export function perguntasGrafica(e: EntradaProjeto, r: ResultadoMotor): Bloco[] {
  const mod = MODELOS[e.modelo];
  const q: string[] = [
    '1. Como vocês preferem receber o arquivo do miolo: páginas individuais, lado a lado em pares de impressão (livreto) ou folhas já montadas?',
    '2. Qual sangria vocês pedem (em mm)? Precisa de marcas de corte?',
    '3. Qual padrão de PDF e perfil de cor (ex.: PDF/X-1a, FOGRA39)?',
    '4. Em qual formato de folha este trabalho será impresso (ex.: 66 × 96 cm)? Qual a margem de pinça?',
    '5. Quantas páginas por caderno a dobradeira faz (8, 16, 32)?',
    '6. Qual a espessura (em mícrons) do papel do miolo e do papel da capa que vocês vão usar?',
  ];
  if (e.modelo === 'grampo_canoa') q.push('7. Até quantas páginas vocês grampeiam neste papel? Aplicam compensação de avanço (creep)?');
  if (mod.lombada === 'quadrada') q.push('7. A lombada: quanto somam à espessura do miolo (cola, capa)? Há fresagem? Quantos mm? Fazem vincos de dobradiça?');
  if (mod.lombada === 'caixa') q.push('7. Capa dura: espessura do papelão, esquadro (sobra), canal e dobra do revestimento em mm?');
  if (mod.furacao) q.push('7. Qual a margem ocupada pela furação/grampo na borda de encadernação?');
  return [
    { linhas: [`Projeto: ${e.projeto.nome} · ${e.formato.largura} × ${e.formato.altura} mm · ${mod.nome} · ${r.componentes.miolo.length} páginas · ${e.tiragem ? `${e.tiragem} exemplares` : 'tiragem a definir'}`] },
    { titulo: 'Perguntas', linhas: q.flatMap((x) => [x, '  Resposta: ______________________________________________', '']) },
  ];
}
