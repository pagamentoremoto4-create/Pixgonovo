# WhatsApp adaptado ao código

Este pacote mantém o fluxo atual do Telegram e adiciona entrada pelo WhatsApp usando webhook/API externa, pensado para Evolution API ou API compatível.

## Variáveis novas no Render/Railway

```env
WHATSAPP_ENABLED=true
WHATSAPP_PROVIDER=evolution
EVOLUTION_API_URL=https://sua-evolution-api.com
EVOLUTION_INSTANCE=nome-da-instancia
EVOLUTION_API_KEY=sua_chave_da_evolution
WHATSAPP_WEBHOOK_SECRET=uma_senha_para_proteger_o_webhook
BASE_URL=https://seu-app.onrender.com
```

## Webhook do WhatsApp

Configure na Evolution API o webhook apontando para:

```text
https://seu-app.onrender.com/webhook/whatsapp?secret=uma_senha_para_proteger_o_webhook
```

O sistema aceita mensagens de texto da Evolution API em formatos comuns (`data.key.remoteJid`, `data.message.conversation`, `extendedTextMessage.text`, etc.).

## Fluxo no WhatsApp

Cliente envia:

```text
menu
```

O bot responde:

```text
1 Serviços
2 Comprar eSIM
3 Histórico
4 Conta
5 Pagar / Pix
6 Suporte
```

Pix:

```text
pagar 50
```

Depois o cliente envia o CPF. O sistema gera o Pix, salva em `pix_pedidos` e confirma pelo verificador automático já existente.

## Observação

O envio de texto usa o endpoint padrão da Evolution:

```text
POST /message/sendText/{instance}
```

O envio de imagem usa:

```text
POST /message/sendMedia/{instance}
```

Se a sua Evolution API usa endpoints diferentes, ajuste as funções `enviarWhatsAppTexto` e `enviarImagemWhatsApp` no `index.js`.
