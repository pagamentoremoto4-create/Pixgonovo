# V8 — WhatsApp direto por QR Code

## O que foi implementado

- Conexão direta com WhatsApp usando a biblioteca oficial do projeto WhiskeySockets/Baileys.
- Página `/admin/whatsapp` no painel.
- QR Code exibido na tela para leitura em **WhatsApp > Aparelhos conectados**.
- Recebimento e envio de mensagens sem Evolution API.
- Envio de imagens/QR Codes de eSIM pelo WhatsApp.
- Reconexão automática quando houver queda temporária.
- Sessão salva em `WHATSAPP_SESSION_DIR`.
- Fluxo V7 preservado: cliente novo recebe menu automaticamente; cliente existente digita `menu`.

## Variáveis necessárias

```env
WHATSAPP_ENABLED=true
WHATSAPP_PROVIDER=baileys
WHATSAPP_SESSION_DIR=/data/whatsapp-session
WHATSAPP_LOG_LEVEL=silent
```

## Render/Railway

Use armazenamento persistente. No Render, monte um Persistent Disk em `/data`. Sem armazenamento persistente, o QR Code poderá ser solicitado novamente após deploy/restart.

## Como conectar

1. Inicie o projeto com `npm install` e `npm start`.
2. Entre no painel administrativo.
3. Abra **WhatsApp**.
4. Clique em **Gerar/Atualizar QR Code**.
5. No celular, abra WhatsApp > Aparelhos conectados > Conectar um aparelho.
6. Escaneie o QR Code.

## Observação

Esta integração usa o protocolo do WhatsApp Web por uma biblioteca não oficial da Meta. Alterações do WhatsApp podem exigir atualização futura da dependência.
