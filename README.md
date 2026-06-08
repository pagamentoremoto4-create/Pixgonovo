# CentralUnlocker V3 Corrigido

## Correções desta versão
- Corrigido cadastro `servico nome valor imei` para pegar o chat/conversa do cliente.
- Melhora para casos em que o WhatsApp usa `@lid`, tentando priorizar JID de telefone real quando disponível.
- Removido o painel Admin pelo WhatsApp (`/admin`).
- Mantido comando `backup` para o ADMIN.

## Render
Build Command: `npm install`
Start Command: `npm start`

## Environment Variables
- PIXGO_API_KEY=sua chave PixGo
- ADMIN_NUMBER=seu número com DDI e DDD, somente números
- DB_PATH=/data/database.db
- ADMIN_PANEL_USER=admin
- ADMIN_PANEL_PASS=sua senha

Crie um Persistent Disk no Render:
Mount Path: `/data`
Size: 1 GB

## Painel Web
Abra: `https://SEU-APP.onrender.com/admin`

## WhatsApp
Cliente final:
`pagar 180`

Cadastro rápido pelo admin na conversa do cliente:
`servico desbloqueio tim 180 356789123456789`

Revenda:
`menu`
