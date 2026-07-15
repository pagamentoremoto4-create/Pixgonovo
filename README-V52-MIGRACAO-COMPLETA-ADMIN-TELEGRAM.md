# V52 — Migração completa do painel administrativo para o Telegram

## Acesso
O administrador configurado em `ADMIN_TELEGRAM_ID` abre o painel automaticamente com `/start`.

## Módulos funcionando dentro do Telegram
- Dashboard
- Produtos com foto, descrição, preço, categoria e ativação
- Categorias: cadastrar, renomear, ativar/desativar e excluir
- Estoque: escolher produto e enviar vários QR Codes
- Pedidos: listar, abrir e alterar status
- Clientes: consultar, alterar saldo e enviar mensagem individual
- Mensagens: disparo de texto para clientes ativos
- Banners: cadastrar imagem e legenda, visualizar, disparar e excluir
- Anúncios automáticos: escolher produto, usar foto/dados, botão Comprar agora, enviar agora, ativar/pausar, intervalo e excluir
- Relatórios
- Configurações
- Backup do banco pelo Telegram

## Campanha de produto
Ao escolher um produto, a campanha reaproveita automaticamente nome, descrição, preço e foto. No Telegram, o anúncio inclui o botão `🛒 Comprar agora`, ligado ao fluxo do produto.

## Observação
O painel web, WhatsApp/Baileys, PIX e os fluxos existentes foram preservados.
