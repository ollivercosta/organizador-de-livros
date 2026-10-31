# Plataforma de Produção Editorial e Gráfica

Motor de imposição genérico (todos os modelos de encadernação), área de configuração da gráfica,
visualização e geração dos arquivos finais. Requisitos: `docs/requisitos.html`.

## Comandos

```bash
npm install
npm test              # 186 testes (referências clássicas, oráculo 3D, 3000 esquemas aleatórios, reconstrução física)
npm run demo          # livro infantil: gera out/ (PDF imposto, capa, ficha, mapa)
npm run build:app     # dist/index.html (página completa, funciona offline) e dist/plataforma-editorial.html
```

## Publicação

- **GitHub Pages:** o workflow `.github/workflows/pages.yml` testa, gera `dist/index.html` e publica a cada envio na
  branch `main`. Ative em *Settings → Pages → Source: GitHub Actions*.
- **Uso local:** abra `dist/index.html` direto no navegador (pdf.js e o worker estão embutidos).

## Como enviar o livro

Um único PDF com o livro inteiro, na ordem de leitura, de preferência PDF/X com sangria. A plataforma também
reconhece páginas duplas (1 · 2|3 · 4|5…) e livretos já impostos (32|1 · 2|31…), desfazendo a imposição.

## Estrutura

- `src/fold` — simulador de dobra (deriva a imposição de qualquer esquema) e oráculo 3D independente
- `src/binding` — modelos, paginação, montagem (aninhada, alçada, folhas, sanfona)
- `src/press` — layout de máquina (frente/verso, virada lateral, virada pela pinça, perfecting)
- `src/cover` — calibre, lombada, creep, capas (canoa, brochura, capa dura, sobrecapa, folhetos)
- `src/config` — registro de parâmetros, perfil da gráfica, padrão de mercado; precedência projeto > gráfica > padrão de mercado > pendente
- `src/editorial` — ISBN/ISSN/ISMN, código de barras EAN-13 (GS1), normas editoriais (Lei 10.753/2003, ABNT NBR 6029 e 12225)
- `src/engine.ts` — contrato de entrada/saída, versão da regra e hash
- `src/pdf` — PDF imposto e capa planificada (pdf-lib)
- `app/` — interface (consome apenas o resultado do motor)
