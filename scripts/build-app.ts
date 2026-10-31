/**
 * Empacota o protótipo em arquivo único:
 *  - dist/plataforma-editorial.html — corpo para publicação como Artifact (o host adiciona o esqueleto);
 *  - dist/index.html               — página completa (doctype, head) para abrir no navegador ou no GitHub Pages.
 * pdf.js e seu worker vão embutidos: funciona offline e o worker roda fora da thread principal.
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const r = await build({ entryPoints: ['app/main.ts'], bundle: true, format: 'iife', minify: true, write: false, target: ['es2020'], legalComments: 'none' });
const seguro = (js: string) => js.replace(/<\/script/gi, '<\\/script');
const app = seguro(r.outputFiles[0]!.text);
const pdfjs = seguro(readFileSync('node_modules/pdfjs-dist/build/pdf.min.js', 'utf8'));
const worker = seguro(readFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.js', 'utf8'));
const tpl = readFileSync('app/index.html', 'utf8')
  .replace('/*__PDFJS_WORKER__*/', () => worker)
  .replace('<script>/*__PDFJS__*/</script>', () => `<script>${pdfjs}</script>`)
  .replace('<script>/*__APP__*/</script>', () => `<script>${app}</script>`);
const [cabeca, corpo] = tpl.split('<!--CORPO-->');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/plataforma-editorial.html', tpl);
const completo = `<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n${cabeca}</head>\n<body>\n${corpo}</body>\n</html>\n`;
writeFileSync('dist/index.html', completo);
console.log(`dist/plataforma-editorial.html — ${(tpl.length / 1024).toFixed(0)} KB · dist/index.html — ${(completo.length / 1024).toFixed(0)} KB`);
