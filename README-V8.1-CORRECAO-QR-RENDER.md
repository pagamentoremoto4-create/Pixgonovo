# V8.1 — Correção do QR Code no Render

Alterações:

- Removida a consulta `fetchLatestBaileysVersion()`, que podia ficar travada no Render.
- Adicionados logs por etapa da inicialização.
- Adicionados tempos limite para carregamento do Baileys, logger e sessão.
- Validação de leitura e gravação da pasta de sessão.
- Status `CONECTANDO`, `AGUARDANDO_QR`, `CONECTADO` e `ERRO` no painel.
- Exibição do último erro diretamente na página do WhatsApp.
- Reinício manual limpa o temporizador de reconexão anterior.

Variáveis recomendadas no Render:

```env
WHATSAPP_ENABLED=true
WHATSAPP_PROVIDER=baileys
WHATSAPP_SESSION_DIR=/data/whatsapp-session
WHATSAPP_LOG_LEVEL=info
DATA_DIR=/data
```

Use Persistent Disk montado em `/data` para conservar a sessão.
