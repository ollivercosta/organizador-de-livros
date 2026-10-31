import { describe, expect, it } from 'vitest';
import { registrarPaginas } from '../src/binding/pagination.js';
import { gerarModeloPerfil, resolverParametros, validarPerfil } from '../src/config/profile.js';
import { capaBrochura, capaDura, paineisFolheto } from '../src/cover/cover.js';
import { calibreMm, creepPorProfundidade, espessuraBloco, lombadaBrochura } from '../src/cover/physics.js';
import type { Valor } from '../src/core/evidence.js';
import { executarMotor } from '../src/engine.js';
import { comBrancos, livroInfantil, PERFIL_TESTE } from './fixtures.js';

const conf = (v: number): Valor<number> => ({ valor: v, origem: 'grafica', status: 'confirmado' });
const confB = (v: boolean): Valor<boolean> => ({ valor: v, origem: 'grafica', status: 'confirmado' });
const AGORA = '2026-10-31T12:00:00.000Z';

describe('física', () => {
  it('calibre por bulk: 115 g/m² × 0,85 cm³/g = 97,75 µm (estimado se o bulk for estimado)', () => {
    const c = calibreMm({ id: 'x', nome: 'x', gramatura: conf(115), calibreUm: { valor: null, origem: 'ausente', status: 'pendente' }, bulk: { valor: 0.85, origem: 'generico', status: 'estimado' } });
    expect(c.valor).toBeCloseTo(0.09775, 6);
    expect(c.status).toBe('estimado');
  });
  it('sem calibre nem bulk, a espessura fica pendente (gramatura não basta)', () => {
    const c = calibreMm({ id: 'x', nome: 'x', gramatura: conf(115), calibreUm: { valor: null, origem: 'ausente', status: 'pendente' } });
    expect(c.status).toBe('pendente');
    expect(espessuraBloco(32, c).status).toBe('pendente');
  });
  it('bloco = folhas × calibre; lombada brochura = bloco + 2·capa + acréscimo', () => {
    const b = espessuraBloco(200, conf(0.1));
    expect(b.valor).toBe(10);
    const l = lombadaBrochura(b, conf(0.33), confB(true), conf(0.5));
    expect(l.valor).toBeCloseTo(11.16, 6);
  });
  it('creep linear: deslocamento máximo de 32 pp aninhadas (8 folhas) = 7 × calibre', () => {
    const c = creepPorProfundidade(conf(0.098), conf(1), true);
    expect(c.fn(7)).toBeCloseTo(0.686, 6);
  });
});

describe('capas', () => {
  it('brochura 160×230, lombada 12, orelha 80, redução 2: largura = 2×158 + 12 + 160 = 488', () => {
    const p = capaBrochura(160, 230, conf(12), conf(3), conf(80), conf(2), conf(6), false);
    expect(p.largura).toBe(488);
    expect(p.paineis.map((x) => x.nome)).toEqual(['orelha (4ª)', '4ª capa', 'lombada', '1ª capa', 'orelha (1ª)']);
    expect(p.linhas.filter((l) => l.tipo === 'vinco').map((l) => l.x)).toEqual([232, 238, 250, 256]);
  });
  it('brochura RTL inverte a ordem dos painéis', () => {
    const p = capaBrochura(160, 230, conf(12), conf(3), conf(0), conf(0), conf(0), true);
    expect(p.paineis.map((x) => x.nome)).toEqual(['1ª capa', 'lombada', '4ª capa']);
  });
  it('capa dura: papelão, cartão de lombada e revestimento', () => {
    const r = capaDura(160, 230, conf(10), { espessuraPapelao: conf(2.5), esquadro: conf(3), canal: conf(7), dobraRevestimento: conf(15), folgaLombada: conf(1), recuoDobradica: conf(3) }, false);
    expect(r.papelao.altura.valor).toBe(236); // 230 + 2×3
    expect(r.papelao.largura.valor).toBe(160); // 160 + 3 − 3
    expect(r.papelao.cartaoLombada.valor).toBe(16); // 10 + 2×2,5 + 1
    expect(r.revestimento.largura).toBe(30 + 320 + 14 + 16); // 380
    expect(r.revestimento.altura).toBe(266);
    expect(r.lombadaExterna.valor).toBe(21);
  });
  it('capa dura sem parâmetros fica pendente — nada é inventado (RN-001)', () => {
    const p = { valor: null, origem: 'ausente', status: 'pendente' } as Valor<number>;
    const r = capaDura(160, 230, conf(10), { espessuraPapelao: p, esquadro: conf(3), canal: conf(7), dobraRevestimento: conf(15), folgaLombada: conf(1), recuoDobradica: conf(3) }, false);
    expect(r.revestimento.status).toBe('pendente');
    expect(r.papelao.cartaoLombada.valor).toBeNull();
  });
  it('folheto: rolo 4 painéis com compensação reduz progressivamente; soma = aberto', () => {
    const r = paineisFolheto('rolo', 400, 4, conf(2));
    expect(r.larguras.reduce((a, b) => a + b, 0)).toBeCloseTo(400, 6);
    expect(r.larguras[2]! - r.larguras[0]!).toBeCloseTo(-2, 6);
    const j = paineisFolheto('janela', 400, 3, conf(2));
    expect(j.larguras.reduce((a, b) => a + b, 0)).toBeCloseTo(400, 6);
    expect(j.larguras[1]! - 2 * j.larguras[0]!).toBeCloseTo(4, 6);
  });
});

describe('área de configuração da gráfica', () => {
  it('precedência: ajuste do projeto > perfil da gráfica > genérico > pendente', () => {
    const r0 = resolverParametros('grampo_canoa', null, {}, []);
    expect(r0.get('arquivo.sangria')!.origem).toBe('generico');
    expect(r0.get('maquina.folha.largura')!.status).toBe('pendente');
    const r1 = resolverParametros('grampo_canoa', PERFIL_TESTE, { maquinaId: 'of-4c', folhaMioloId: '66x96' }, []);
    expect(r1.get('maquina.folha.largura')!).toMatchObject({ valor: 960, origem: 'grafica', status: 'confirmado' });
    expect(r1.get('maquina.pinca')!.valor).toBe(12);
    const r2 = resolverParametros('grampo_canoa', PERFIL_TESTE, { maquinaId: 'of-4c', folhaMioloId: '66x96' }, [
      { chave: 'maquina.pinca', valor: 10, motivo: 'Gráfica confirmou por e-mail em 30/10', autor: 'Josah', data: '2026-10-30' },
    ]);
    expect(r2.get('maquina.pinca')!).toMatchObject({ valor: 10, origem: 'projeto', status: 'informado', autor: 'Josah' });
  });
  it('parâmetros não aplicáveis ao modelo não aparecem (ex.: fresagem no grampo canoa)', () => {
    const r = resolverParametros('grampo_canoa', PERFIL_TESTE, {}, []);
    expect(r.has('acabamento.fresagem')).toBe(false);
    expect(resolverParametros('brochura_pur', PERFIL_TESTE, {}, []).has('acabamento.fresagem')).toBe(true);
  });
  it('validação do perfil importado rejeita tipos, faixas, chaves desconhecidas e papel sem calibre', () => {
    const { perfil, erros } = validarPerfil({ ...PERFIL_TESTE, parametros: { 'arquivo.sangria': -1, 'maquina.modo': 'xpto', 'nao.existe': 1 }, papeis: [{ id: 'p', nome: 'p', gramatura: 90 }] });
    expect(perfil).toBeNull();
    const cam = erros.map((e) => e.caminho);
    expect(cam).toContain('parametros.arquivo.sangria');
    expect(cam).toContain('parametros.maquina.modo');
    expect(cam).toContain('parametros.nao.existe');
    expect(cam).toContain('papeis[0]');
    expect(validarPerfil(PERFIL_TESTE).erros).toEqual([]);
  });
  it('modelo de perfil para a gráfica contém todas as chaves do registro', () => {
    const m = gerarModeloPerfil() as { parametros: Record<string, string> };
    expect(Object.keys(m.parametros).length).toBeGreaterThan(40);
    expect(m.parametros['maquina.pinca']).toMatch(/CRÍTICO/);
  });
});

describe('motor — livro infantil (seção 20 do documento)', () => {
  it('30 pp autocapa: imposição BLOQUEADA, nenhuma página adicionada, opções explicadas (RN-004)', () => {
    const r = executarMotor(livroInfantil(), AGORA);
    expect(r.nivel).toBe('bloqueado');
    const pag = r.constatacoes.find((c) => c.codigo === 'PAG-001')!;
    expect(pag.severidade).toBe('erro');
    expect(pag.opcoes![0]).toMatch(/32 pp \(\+2 branco\)/);
    expect(r.componentes.miolo.length).toBe(30);
    expect(r.formas.length).toBe(0);
  });
  it('após o usuário aprovar +2 brancos: 32 pp em 2 cadernos de 16 aninhados (32 pp não cabe em 66×96), verificado', () => {
    const r = executarMotor(livroInfantil({ paginas: comBrancos(2) }), AGORA);
    expect(r.plano.escolhido).toEqual([16, 16]);
    expect(r.constatacoes.find((c) => c.codigo === 'CFG-005')!.mensagem).toMatch(/32 pp não cabem/);
    const erros = r.constatacoes.filter((c) => c.severidade === 'erro' || c.severidade === 'pendencia');
    expect(erros).toEqual([]);
    expect(r.nivel).toBe('validado_parametros');
    expect(r.formas.length).toBeGreaterThan(0);
    // todas as 32 páginas mapeadas para forma/lado/posição
    expect(r.mapa.every((m) => m.forma && m.lado && m.posicao !== null)).toBe(true);
    // leitura: 17 vistas (1 sozinha, 15 duplas, 32 sozinha)
    expect(r.leitura.duplas.length).toBe(17);
    // creep máximo = 7 folhas × 0,098 mm
    expect(r.fisica.creepMaximo).toBeCloseTo(0.686, 3);
  });
  it('capa separada (triplex) com 4 faces no PDF: miolo 26 pp → exige 28 pp', () => {
    const r = executarMotor(livroInfantil({ capa: { modelo: 'separada_flexivel', fonte: { fonte: 'no_pdf', facesNoPdf: 4 } } }), AGORA);
    expect(r.componentes.miolo.length).toBe(26);
    expect(r.constatacoes.find((c) => c.codigo === 'PAG-001')!.opcoes![0]).toMatch(/16 \+ 8 \+ 4 = 28 pp/);
  });
  it('sem perfil da gráfica: prévia lógica apenas, formato da folha pendente, nunca "validado"', () => {
    const r = executarMotor(livroInfantil({ paginas: comBrancos(2), perfil: null, selecao: {} }), AGORA);
    expect(r.unidades.length).toBe(1);
    expect(r.formas.length).toBe(0);
    expect(r.nivel).toBe('bloqueado');
    expect(r.constatacoes.some((c) => c.codigo === 'MAQ-000')).toBe(true);
  });
  it('com folha informada manualmente mas sem perfil: prévia genérica', () => {
    const r = executarMotor(livroInfantil({
      paginas: comBrancos(2), perfil: null, selecao: {},
      papeis: { miolo: { id: 'm', nome: 'couchê', gramatura: { valor: 115, origem: 'projeto', status: 'informado' }, calibreUm: { valor: 98, origem: 'projeto', status: 'informado' } } },
      ajustes: [
        { chave: 'maquina.folha.largura', valor: 960, motivo: 'informado pela gráfica por telefone', autor: 'usuário', data: '2026-10-31' },
        { chave: 'maquina.folha.altura', valor: 660, motivo: 'informado pela gráfica por telefone', autor: 'usuário', data: '2026-10-31' },
      ],
    }), AGORA);
    expect(r.formas.length).toBeGreaterThan(0);
    expect(r.nivel).toBe('previa_generica');
    expect(r.parametrosCriticos.genericos).toContain('arquivo.sangria');
  });
  it('reprodutibilidade: mesma entrada → mesmo hash e mesmo mapa (RNF-002)', () => {
    const a = executarMotor(livroInfantil({ paginas: comBrancos(2) }), AGORA);
    const b = executarMotor(livroInfantil({ paginas: comBrancos(2) }), AGORA);
    expect(a.hashEntrada).toBe(b.hashEntrada);
    expect(JSON.stringify(a.mapa)).toBe(JSON.stringify(b.mapa));
    const c = executarMotor(livroInfantil({ paginas: comBrancos(2), ajustes: [{ chave: 'maquina.pinca', valor: 10, motivo: 'm', autor: 'a', data: '2026-10-31' }] }), AGORA);
    expect(c.hashEntrada).not.toBe(a.hashEntrada);
  });
  it('CT-004: capa planificada no PDF declarada como 4 faces é detectada', () => {
    const dims = Array.from({ length: 30 }, (_, i) => ({ indice: i, larguraMm: i === 0 ? 326 : 160, alturaMm: 230, sangriaMm: 3 }));
    const r = executarMotor(livroInfantil({ capa: { modelo: 'separada_flexivel', fonte: { fonte: 'no_pdf', facesNoPdf: 4 } }, dimensoesOrigem: dims }), AGORA);
    expect(r.constatacoes.some((c) => c.codigo === 'CAP-001')).toBe(true);
  });
  it('CT-005: páginas com dimensões inconsistentes são listadas', () => {
    const dims = Array.from({ length: 32 }, (_, i) => ({ indice: i, larguraMm: i === 7 ? 165 : 160, alturaMm: 230, sangriaMm: i === 9 ? 0 : 3 }));
    const r = executarMotor(livroInfantil({ paginas: registrarPaginas('livro.pdf', 32), dimensoesOrigem: dims }), AGORA);
    expect(r.constatacoes.find((c) => c.codigo === 'ARQ-001')!.evidencia).toMatch(/p\.8/);
    expect(r.constatacoes.find((c) => c.codigo === 'ARQ-002')!.evidencia).toMatch(/p\.10/);
  });
});

describe('motor — demais modelos', () => {
  const base = (modelo: Parameters<typeof livroInfantil>[0]) => livroInfantil(modelo, 0);
  it('brochura PUR 200 pp: cadernos alçados, lombada calculada, capa com vincos', () => {
    const r = executarMotor(base({ modelo: 'brochura_pur', paginas: registrarPaginas('m', 200), capa: { modelo: 'separada_flexivel', fonte: { fonte: 'arquivo_separado' }, orelha: 80 } }), AGORA);
    expect(r.plano.escolhido!.reduce((a, b) => a + b, 0)).toBe(200);
    expect(r.plano.escolhido!.every((t) => t <= 16)).toBe(true); // 32 pp não cabe na folha 66×96
    expect(r.constatacoes.filter((c) => c.severidade === 'erro')).toEqual([]);
    expect(r.fisica.espessuraBloco.valor).toBeCloseTo(9.8, 6); // 100 folhas × 0,098
    expect(r.fisica.lombada!.valor).toBeCloseTo(9.8 + 0.66 + 0.5, 6);
    expect(r.capa.planificacao!.largura).toBeCloseTo(2 * 158 + 10.96 + 160, 6);
  });
  it('capa dura costurada 96 pp com sobrecapa', () => {
    const r = executarMotor(base({ modelo: 'capa_dura_costurada', paginas: registrarPaginas('m', 96), capa: { modelo: 'capa_dura', fonte: { fonte: 'arquivo_separado' }, sobrecapa: true, sobrecapaOrelha: 70 }, selecao: { ...livroInfantil().selecao, papelGuardaId: 'offset-150' } }), AGORA);
    expect(r.constatacoes.filter((c) => c.severidade === 'erro')).toEqual([]);
    expect(r.capa.capaDura!.papelao.cartaoLombada.valor).toBeCloseTo(48 * 0.098 + 4 * 0.18 + 5 + 1, 2);
    expect(r.capa.sobrecapa!.largura).toBeGreaterThan(r.capa.capaDura!.revestimento.largura - 30);
    expect(r.leitura.faces.filter((f) => f.componente === 'guarda').length).toBe(4);
  });
  it('wire-o 50 pp: folhas soltas, ímpar arredondado com proposta de 1 branco', () => {
    const r = executarMotor(base({ modelo: 'wire_o', paginas: registrarPaginas('m', 49), capa: { modelo: 'folhas_de_capa', fonte: { fonte: 'arquivo_separado' } } }), AGORA);
    expect(r.constatacoes.find((c) => c.codigo === 'PAG-001')!.opcoes![0]).toMatch(/25 folhas soltas/);
  });
  it('wire-o 50 pp corte-e-empilhamento: imposição completa e verificada', () => {
    const r = executarMotor(base({ modelo: 'wire_o', paginas: registrarPaginas('m', 50), capa: { modelo: 'folhas_de_capa', fonte: { fonte: 'arquivo_separado' } } }), AGORA);
    expect(r.constatacoes.filter((c) => c.severidade === 'erro')).toEqual([]);
    expect(r.unidades.length).toBe(25);
    expect(r.mapa.every((m) => m.forma)).toBe(true);
  });
  it('sanfona 6 painéis frente e verso (12 faces) em folha 72×102', () => {
    const r = executarMotor(base({ modelo: 'sanfona', paginas: registrarPaginas('m', 12), selecao: { maquinaId: 'of-4c', papelMioloId: 'couche-fosco-115' },
      ajustes: [{ chave: 'maquina.folha.largura', valor: 1020, motivo: 'folha 72×102', autor: 't', data: '2026-10-31' }, { chave: 'maquina.folha.altura', valor: 720, motivo: 'folha 72×102', autor: 't', data: '2026-10-31' }] }), AGORA);
    expect(r.constatacoes.filter((c) => c.severidade === 'erro')).toEqual([]);
    expect(r.unidades[0]!.layout.cols).toBe(6);
    expect(r.formas.length).toBe(1);
  });
  it('sanfona longa demais para a folha: erro com opção de emenda', () => {
    const r = executarMotor(base({ modelo: 'sanfona', paginas: registrarPaginas('m', 24) }), AGORA);
    const e = r.constatacoes.find((c) => c.codigo === 'MAQ-001')!;
    expect(e.opcoes!.join(' ')).toMatch(/emenda/);
  });
  it('mangá RTL em brochura costurada 64 pp', () => {
    const r = executarMotor(base({ modelo: 'brochura_costurada', direcao: 'rtl', paginas: registrarPaginas('m', 64), capa: { modelo: 'separada_flexivel', fonte: { fonte: 'arquivo_separado' } } }), AGORA);
    expect(r.constatacoes.filter((c) => c.severidade === 'erro')).toEqual([]);
    expect(r.bordaEncadernacao).toBe('right');
    expect(r.leitura.duplas[0]).toEqual({ a: 1, b: null });
  });
  it('calendário de parede wire-o com encadernação superior', () => {
    const r = executarMotor(base({ modelo: 'wire_o', encadernacaoSuperior: true, paginas: registrarPaginas('m', 28), capa: { modelo: 'sem_capa', fonte: { fonte: 'arquivo_separado' } } }), AGORA);
    expect(r.constatacoes.filter((c) => c.severidade === 'erro')).toEqual([]);
    expect(r.bordaEncadernacao).toBe('top');
  });
  it('modelo de capa incompatível é erro (ex.: capa dura no grampo canoa)', () => {
    const r = executarMotor(base({ paginas: registrarPaginas('m', 32), capa: { modelo: 'capa_dura', fonte: { fonte: 'arquivo_separado' } } }), AGORA);
    expect(r.constatacoes.some((c) => c.codigo === 'CAP-002')).toBe(true);
  });
});
