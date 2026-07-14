# V27 — Gemini somente no WhatsApp

## O que foi implementado

- Google Gemini responde apenas mensagens livres do WhatsApp.
- Telegram permanece sem IA.
- Menus, PIX, adicionar saldo, pagar serviço, IMEI, pedidos e eSIM continuam no fluxo normal.
- A IA recebe como contexto os serviços, preços e estoque ativos no banco de dados.
- A IA não confirma pagamentos, não altera saldo e não cria ou cancela pedidos.
- Em erros ou dúvidas sensíveis, o cliente é direcionado ao suporte humano.

## Variáveis no Render

```env
WHATSAPP_AI_ENABLED=true
GEMINI_API_KEY=cole_sua_chave_do_google_ai_studio
GEMINI_MODEL=gemini-3.5-flash
WHATSAPP_AI_MAX_TOKENS=350
WHATSAPP_AI_TIMEOUT_MS=25000
```

Não coloque a chave no GitHub. Configure-a somente em **Render > Environment**.

## Teste

Depois do deploy e com o WhatsApp conectado, envie uma pergunta livre:

`Quais serviços vocês oferecem?`

Para abrir o fluxo normal do sistema, envie:

`menu`

## Desativar a IA

Altere no Render:

```env
WHATSAPP_AI_ENABLED=false
```
