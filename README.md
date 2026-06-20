# CentralUnlocker Revendas + eSIM no mesmo Render

Este projeto roda dois WhatsApps no mesmo domínio:

- `/admin` = painel atual de revendas
- `/esim` = painel novo de venda de eSIM

## WhatsApps

- WhatsApp 1: revendas, usando sessão em `/data/auth_revenda`
- WhatsApp 2: eSIM, usando sessão em `/data/auth_esim`

Para escanear o WhatsApp eSIM, acesse:

```txt
https://SEU-SITE.onrender.com/esim/qr
```

## Variáveis no Render

```env
PIXGO_API_KEY=sua_chave_pixgo
ADMIN_NUMBER=5575999999999
ADMIN_NUMBERS=5575999999999,5575888888888
ADMIN_PANEL_USER=admin
ADMIN_PANEL_PASS=sua_senha
BASE_URL=https://seuapp.onrender.com
SUPORTE_WHATSAPP=5575999999999
DATA_DIR=/data
DB_PATH=/data/revenda.db
AUTH_REVENDA_DIR=/data/auth_revenda
ESIM_DB_PATH=/data/esim.db
AUTH_ESIM_DIR=/data/auth_esim
ESIM_UPLOAD_DIR=/data/uploads_esim
ESIM_BACKUP_DIR=/data/backups_esim
```

## Disco persistente

Crie um Persistent Disk no Render com mount path:

```txt
/data
```

Ele salva:

```txt
/data/revenda.db
/data/esim.db
/data/auth_revenda
/data/auth_esim
/data/uploads_esim
/data/backups_esim
```

## Fluxo eSIM

1. Admin entra em `/esim/produtos` e cadastra o plano.
2. Se o plano for automático, adiciona QR em `/esim/estoque`.
3. Cliente chama o WhatsApp eSIM e digita `menu`.
4. Cliente escolhe o plano e paga PixGo.
5. Webhook `/webhook/pixgo-esim` confirma o pagamento.
6. Se for automático, o QR é enviado ao cliente.
7. Se for manual, o pedido fica aguardando envio e o admin recebe aviso.

## Webhook PixGo eSIM

Use no painel/API PixGo:

```txt
https://SEU-SITE.onrender.com/webhook/pixgo-esim
```

O webhook antigo continua:

```txt
https://SEU-SITE.onrender.com/webhook/pixgo
```
