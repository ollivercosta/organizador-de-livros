/** Empacota o protótipo em um único HTML (JS embutido) em dist/plataforma-editorial.html. */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const r = await build({
  entryPoints: ['app/main.ts'], bundle: true, format: 'iife', minify: true, write: false,
  target: ['es2020'], legalComments: 'none',
});
const js = r.outputFiles[0]!.text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('app/index.html', 'utf8').replace('<script>/*__APP__*/</script>', () => `<script>${js}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/plataforma-editorial.html', html);
console.log(`dist/plataforma-editorial.html — ${(html.length / 1024).toFixed(0)} KB`);
