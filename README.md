# Plataforma de Produção Editorial e Gráfica

Motor de imposição genérico (todos os modelos de encadernação), área de configuração da gráfica,
visualização e geração dos arquivos finais. Requisitos: `docs/requisitos-v0.2.html`.

## Comandos

```bash
npm install
npm test              # 172 testes (referências clássicas, oráculo 3D, 3000 esquemas aleatórios, reconstrução física)
npm run demo          # livro infantil: gera out/ (PDF imposto, capa, ficha, mapa)
npm run build:app     # protótipo em dist/plataforma-editorial.html (arquivo único)
```

## Estrutura

- `src/fold` — simulador de dobra (deriva a imposição de qualquer esquema) e oráculo 3D independente
- `src/binding` — modelos, paginação, montagem (aninhada, alçada, folhas, sanfona)
- `src/press` — layout de máquina (frente/verso, virada lateral, virada pela pinça, perfecting)
- `src/cover` — calibre, lombada, creep, capas (canoa, brochura, capa dura, sobrecapa, folhetos)
- `src/config` — registro de parâmetros, perfil da gráfica, precedência projeto > gráfica > genérico > pendente
- `src/engine.ts` — contrato de entrada/saída, versão da regra e hash
- `src/pdf` — PDF imposto e capa planificada (pdf-lib)
- `app/` — interface (consome apenas o resultado do motor)
