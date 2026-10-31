import { registrarPaginas } from '../src/binding/pagination.js';
import { executarMotor } from '../src/engine.js';
import { comBrancos, livroInfantil } from '../test/fixtures.js';
const casos: Record<string, Parameters<typeof livroInfantil>[0]> = {
  infantil: { paginas: comBrancos(2) },
  pur: { modelo: 'brochura_pur', paginas: registrarPaginas('m', 200), capa: { modelo: 'separada_flexivel', fonte: { fonte: 'arquivo_separado' }, orelha: 80 } },
  sanfona: { modelo: 'sanfona', paginas: registrarPaginas('m', 24) },
};
for (const [k, v] of Object.entries(casos)) {
  const r = executarMotor(livroInfantil(v, 0));
  console.log('==', k, 'plano', r.plano.escolhido, 'formas', r.formas.map(f => `${f.id}:${f.posicoes.length}pos rot${f.rotacaoForma} u[${f.unidades}]`).join(' '));
  for (const c of r.constatacoes.filter(c => c.severidade === 'erro')) console.log(' ', c.codigo, c.mensagem, c.evidencia ?? '');
}
