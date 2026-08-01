# V92 — Correção dos banners dos temas

- Imagens dos 6 temas agora ficam embutidas no próprio `index.js`.
- Nova rota `/theme-image/:theme.jpg` entrega os banners diretamente, sem depender de arquivos binários publicados pelo GitHub/Render.
- Miniaturas, pré-visualização, fundo e banner principal usam a mesma rota.
- Tema escolhido continua persistido no banco em `/data`.
