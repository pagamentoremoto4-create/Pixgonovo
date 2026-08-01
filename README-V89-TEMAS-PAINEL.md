# V89 — Temas e painel moderno

Implementado:
- Área **Temas do Painel** no menu lateral.
- 6 temas completos: Hacker Neon Verde, Cyber Hacker Azul, Hacker Red Alert, Hacker Purple Grid, Matrix Code e Dark Pro.
- Botão **Visualizar** antes de aplicar o tema; a prévia não altera o tema atual.
- Persistência do tema no SQLite (`painel_tema`) dentro do DATA_DIR, mantendo a escolha após restart/deploy no Render.
- Personalização persistente da intensidade da imagem: forte, suave ou sem imagem.
- Efeitos visuais ativáveis/desativáveis (vidro, animações leves e hover).
- Menu lateral recolhível no desktop e menu móvel no celular.
- Cabeçalho fixo com relógio e indicador de conexão do painel.
- Dashboard com card de WhatsApps conectados e atualização de métricas via API/socket sem recarregar a página inteira.
- Toasts de confirmação e modal visual para ações importantes de pedidos.
- Imagens temáticas locais em `public/img/`, sem dependência de URLs externas.
