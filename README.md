# CentralUnlocker V3

## Render
Build Command: `npm install`
Start Command: `npm start`

## Environment Variables
- `PIXGO_API_KEY=sua chave PixGo`
- `ADMIN_NUMBER=5575999999999`
- `DB_PATH=/data/database.db`
- `ADMIN_PANEL_USER=admin`
- `ADMIN_PANEL_PASS=sua senha`

Crie um Persistent Disk no Render:
- Mount Path: `/data`
- Size: `1 GB`

## Painel Admin
Abra:
`https://SEU-APP.onrender.com/admin`

Abas:
- Dashboard
- Pedidos
- Revendas
- Serviços
- Financeiro
- Relatórios
- Backup
- Sair

## WhatsApp Cliente Final
Qualquer pessoa pode gerar PIX:

`pagar 180`

Cadastro rápido de serviço pelo admin na conversa do cliente:

`servico desbloqueio tim 180 356789123456789`

## WhatsApp Revenda
A revenda é cadastrada pelo número do WhatsApp no painel. Não precisa login e senha.

A revenda digita:

`menu`

O bot mostra:

1. Serviços
2. Histórico
3. Conta

Na conta, a revenda vê o saldo e pode pagar parcial:

`pagar 100`

## Backup
- Automático todo dia às 02:00
- No painel: Backup > Criar/Listar/Baixar/Restaurar
- Pelo WhatsApp Admin: `backup`
