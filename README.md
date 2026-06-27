# CentralUnlocker Telegram v12

Versão com o cliente usando somente o Telegram.

## Variáveis no Render

```env
TELEGRAM_BOT_TOKEN=token_do_bot
ADMIN_TELEGRAM_ID=5319809013
BASE_URL=https://SEU-APP.onrender.com
PIXGO_API_KEY=sua_chave_pixgo
ADMIN_PASSWORD=sua_senha_admin
```

## Acessos

- Painel Admin: `/admin`
- Cliente: pelo Telegram com `/start` ou `/menu`

## Fluxo do cliente

1. Cliente envia `/start` no bot do Telegram.
2. O cadastro é criado automaticamente pelo ID do Telegram.
3. O cliente usa o menu do Telegram:
   - 1️⃣ Serviços
   - 2️⃣ Comprar eSIM
   - 3️⃣ Histórico
   - 4️⃣ Conta
   - 5️⃣ Pagar
4. Todos os avisos chegam no Telegram.

## Observação

O site/painel do cliente foi removido. O painel web fica apenas para administração.
