# CentralUnlocker V3

## Render
Build Command: `npm install`
Start Command: `npm start`

## Variáveis de ambiente
- `PIXGO_API_KEY`: sua chave PixGo
- `ADMIN_NUMBER`: seu número com DDI e DDD, apenas números. Exemplo: `5575999999999`
- `DB_PATH`: recomendado `/data/database.db`
- `ADMIN_PANEL_USER`: usuário do painel
- `ADMIN_PANEL_PASS`: senha do painel
- `BASE_URL`: URL do Render. Exemplo: `https://seu-app.onrender.com`

Crie um Persistent Disk no Render:
- Mount Path: `/data`
- Size: `1 GB`

## Painel
Abra: `https://SEU-APP.onrender.com/admin`

## WhatsApp - Cliente final
Gerar Pix livre para qualquer pessoa:
`pagar 180`

Cadastrar serviço de cliente final, digitado pelo admin na conversa do cliente:
`servico desbloqueio tim 180 356789123456789`

## WhatsApp - Revenda
Cadastro de revenda pelo WhatsApp do admin:
`revenda NOME DA REVENDA | 5575988479931`

Depois a revenda digita:
`menu`

Opções:
1. Serviços
2. Histórico
3. Conta

## WhatsApp - Admin
Digite:
`/admin`

Comandos rápidos:
- `backup`
- `backups`
- `hoje`
- `financeiro`
- `pendentes`
- `processo`
- `finalizados`
- `cancelados`
- `imei 356789123456789`
- `cliente 5575999999999`
- `revenda NOME DA REVENDA | 5575988479931`
- `processar ID`
- `finalizar ID`
- `cancelar ID motivo`
- `editarimei ID novoimei`
- `addrevenda Nome | 5575999999999`
- `bloquearrevenda ID`
- `desbloquearrevenda ID`
- `removerrevenda ID`
- `servicos`
- `addservico Nome | 100`
- `editarservico ID | Novo Nome | 100`
- `desativarservico ID`
- `ativarservico ID`
- `excluirservico ID`
- `relatorio diario`
- `relatorio mensal`
- `relatorio anual`

## Backup
Backup automático todos os dias às 02:00.
No painel: Backup > Criar/Listar/Baixar/Restaurar.
