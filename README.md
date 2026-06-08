# CentralUnlocker V3 - Fix Revenda Número

## Render
Build Command: `npm install`
Start Command: `npm start`

## Variáveis
- PIXGO_API_KEY=sua chave PixGo
- ADMIN_NUMBER=seu número com DDI e DDD. Ex: 5575999999999
- DB_PATH=/data/database.db
- ADMIN_PANEL_USER=admin
- ADMIN_PANEL_PASS=sua senha
- BASE_URL=https://seuapp.onrender.com

## Correções desta versão
- Normaliza WhatsApp da revenda automaticamente para 55 + DDD + número.
- Reconhece revenda mesmo se o WhatsApp/Baileys enviar formatos diferentes.
- Corrige busca da revenda no comando `menu`.
- Envia boas-vindas e tutorial ao cadastrar revenda.
- Botão para reenviar boas-vindas no painel de revendas.
- Mantém comando `pagar valor` livre para qualquer pessoa.
- Mantém painel web `/admin`.

## Comandos
Cliente final:
`pagar 100`

Revenda:
`menu`

Admin WhatsApp:
`backup`

Painel:
`https://SEUAPP.onrender.com/admin`
