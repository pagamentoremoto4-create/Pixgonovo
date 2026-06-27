# CentralUnlocker - versão Telegram

Esta versão usa Telegram para cadastro automático e notificações.

## Variáveis no Render

```env
DATA_DIR=/data
BASE_URL=https://SEU-APP.onrender.com
CLIENTE_PANEL_URL=https://SEU-APP.onrender.com/cliente
TELEGRAM_BOT_TOKEN=TOKEN_DO_BOT_TELEGRAM
ADMIN_TELEGRAM_ID=5319809013
PIXGO_API_KEY=SUA_CHAVE_PIXGO
ADMIN_PANEL_USER=admin
ADMIN_PANEL_PASS=123456
```

## Rotas principais

- `/` status do sistema
- `/admin` painel admin
- `/cliente` painel do cliente
- `/webhook/pixgo` webhook PixGo

## Fluxo

1. Cliente envia `/start` no bot do Telegram.
2. Sistema cria cadastro automático.
3. Bot envia usuário, senha e link `/cliente`.
4. Cliente entra no site.
5. Menu do cliente:
   - Serviços
   - Comprar eSIM
   - Histórico
   - Conta
   - Pagamentos
6. Admin acompanha pedidos no painel.
7. Cliente recebe avisos no Telegram.

## Observação

Esta é a primeira versão convertida para Telegram. O WhatsApp/Baileys foi mantido no código para compatibilidade, mas não é iniciado automaticamente.
