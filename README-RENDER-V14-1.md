# Render — V14.1

Este projeto precisa ser implantado como **Web Service**, não como Static Site.

## Configuração manual

- Runtime: Node
- Root Directory: deixe vazio se `index.js` e `package.json` estiverem na raiz
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/health`

## Variáveis obrigatórias

- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`
- `IA_ENABLED=true`
- `OPENAI_MODEL=gpt-5-mini`
- `ADMIN_PANEL_USER`
- `ADMIN_PANEL_PASS`
- `ADMIN_TELEGRAM_ID`
- `ADMIN_NUMBER`
- `WHATSAPP_ENABLED=true`
- `WHATSAPP_PROVIDER=baileys`

Não cadastre `PORT`; o Render fornece automaticamente.

## Endereços

- Página inicial: `/`
- Painel: `/admin`
- WhatsApp QR: `/admin/whatsapp`
- Teste do servidor: `/health`
