# Pixgonovo Telegram v18 — Limpeza completa

Esta versão remove a dependência do WhatsApp/Baileys e deixa a operação do cliente 100% pelo Telegram.

## Principais mudanças

- Removida dependência `@whiskeysockets/baileys` do `package.json`.
- Removida dependência `pino` usada apenas no WhatsApp antigo.
- Avisos administrativos agora são enviados somente para `ADMIN_TELEGRAM_ID`.
- Entrega manual de eSIM agora usa botões no Telegram do admin.
- Removido texto antigo: "Use no WhatsApp admin".
- Clientes fazem serviços, eSIM, histórico, conta e pagamento pelo Telegram.
- Painel web fica apenas para administração.

## Variáveis principais no Render

```env
TELEGRAM_BOT_TOKEN=token_do_bot
ADMIN_TELEGRAM_ID=5319809013
BASE_URL=https://pixgonovo.onrender.com
DATA_DIR=/data
```

## Teste recomendado

1. Faça deploy no Render.
2. Envie `/start` no Telegram do cliente.
3. Compre um eSIM sem estoque automático.
4. Verifique se o admin recebe botões:
   - 📤 Enviar QR Code
   - ✅ Finalizar
   - ❌ Cancelar
5. Toque em 📤 Enviar QR Code e envie a imagem do QR.
