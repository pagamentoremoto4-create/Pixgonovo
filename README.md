# CentralUnlocker - Cadastro de revenda pela conversa

## Como usar

Abra a conversa privada da revenda no WhatsApp conectado ao bot e envie:

```txt
cadastrar revenda Nome da Revenda
```

Exemplo:

```txt
cadastrar revenda Central Bahia
```

O bot vai usar automaticamente o número daquela conversa como WhatsApp da revenda.

Depois a revenda pode enviar:

```txt
menu
```

## Observação

O bot continua ignorando mensagens enviadas pelo próprio WhatsApp, exceto comandos seguros de cadastro/ativação de revenda.


## Persistência dos QR Codes eSIM no Render

Para não perder os QR Codes dos eSIM quando reiniciar ou fazer deploy no Render, crie um Persistent Disk com mount path `/data` e configure as variáveis:

```txt
DATA_DIR=/data
DB_PATH=/data/database.db
ESIM_DIR=/data/esim
BACKUP_DIR=/data/backups
```

Agora os arquivos enviados em **eSIM** são salvos em `/data/esim` e continuam disponíveis pela URL `/esim/nome-do-arquivo.png`.
