# V27 — IA somente no WhatsApp

## O que foi implementado

- IA responde apenas mensagens do WhatsApp que não pertencem a um fluxo do sistema.
- Telegram permanece sem IA.
- Menus, PIX, adicionar saldo, pagar serviço, IMEI, pedidos e eSIM continuam sendo tratados pelo código normal.
- A IA usa os serviços e preços ativos do banco de dados como contexto.
- A IA não confirma pagamentos, não altera saldo e não cria pedidos.
- Em erros ou dúvidas sensíveis, orienta o cliente a usar o suporte humano.

## Variáveis no Render

```env
WHATSAPP_AI_ENABLED=true
OPENAI_API_KEY=coloque_sua_chave_aqui
OPENAI_MODEL=gpt-4.1-mini
WHATSAPP_AI_MAX_TOKENS=350
WHATSAPP_AI_TIMEOUT_MS=25000
```

Depois de salvar as variáveis, reinicie o serviço no Render.

## Teste

Envie no WhatsApp uma pergunta livre, por exemplo:

`Quais serviços vocês oferecem?`

Para abrir o sistema normal, envie:

`menu`
