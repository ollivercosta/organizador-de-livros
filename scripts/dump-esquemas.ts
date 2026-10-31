import { ESQUEMAS_BASE } from '../src/fold/schemes.js';
import { simularDobra } from '../src/fold/simulate.js';
const rotSym = (r: number) => (r === 0 ? '' : r === 180 ? 'v' : r === 90 ? '>' : '<');
for (const e of ESQUEMAS_BASE) {
  for (const borda of (process.argv[2] === 'all' ? ['left', 'right', 'top'] : ['left']) as Array<'left' | 'right' | 'top'>) {
    const l = simularDobra(e, { bordaEncadernacao: borda });
    const grid = (face: 'frente' | 'verso') => {
      const g: string[][] = Array.from({ length: l.rows }, () => Array(l.cols).fill(''));
      for (const c of l.celulas) { const f = c[face]; g[f.row]![f.col] = (f.pagina + rotSym(f.rotacao)).padStart(4); }
      return g.map((r) => r.join(' ')).join('\n');
    };
    console.log(`${e.id} [${borda}] códice=${l.codiceValido} girada=${l.celulaGirada}\nFRENTE\n${grid('frente')}\nVERSO (virada lateral)\n${grid('verso')}\n`);
  }
}
