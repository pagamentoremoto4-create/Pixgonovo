# Bot CentralUnlocker PixGo + Cobrança Pós-Paga

## Funções

- WhatsApp com Baileys, sem Puppeteer
- QR Code no site do Render
- PixGo automático: `pagar 10`
- Confirmação automática de pagamento
- Aviso de Pix expirado
- Serviços com protocolo
- Registro de IMEI
- Consulta global por IMEI
- Serviços pendentes
- Conta corrente para clientes recorrentes
- Controle de devedores
- Histórico de pagamentos
- Backup automático diário às 02:00

## Arquivos

- `index.js`
- `package.json`
- `.env.example`

## Variáveis no Render

Em **Environment**, adicione:

```txt
PIXGO_API_KEY = sua chave pk_ da PixGo
ADMIN_NUMBER = seu número com DDI e DDD, exemplo: 5575999999999
DB_PATH = /data/database.db
```

## Importante sobre banco de dados no Render

Para não perder os dados em deploy/restart, crie um **Persistent Disk** no Render:

```txt
Mount Path: /data
```

Se não criar o disco persistente, o bot pode perder o banco `database.db` em novos deploys.

## Configuração do Render

Build Command:

```txt
npm install
```

Start Command:

```txt
npm start
```

## Primeiro acesso

Depois do deploy, abra a URL do Render:

```txt
https://SEU-SERVICO.onrender.com
```

Escaneie o QR Code com:

```txt
WhatsApp > Aparelhos conectados > Conectar aparelho
```

## Comandos do cliente

```txt
menu
saldo
pagar 10
```

## Comandos admin usados na conversa do cliente

```txt
servico 180 desbloqueio tim 356789123456789
debito 180
pagou 50
pagou 180
```

## Comandos admin usados no seu próprio número

```txt
pendentes
feito 1001
buscarimei 356789123456789
devedores
total
historico
cliente 5575999999999
backup
```

## Fluxo serviço individual

1. Cliente manda o serviço.
2. Você registra na conversa do cliente:

```txt
servico 180 desbloqueio tim 356789123456789
```

3. Depois consulta no admin:

```txt
pendentes
```

4. Ao finalizar:

```txt
feito 1001
```

5. O bot envia para o cliente a instrução para pagar:

```txt
pagar 180
```

## Fluxo cliente recorrente

Na conversa do cliente:

```txt
debito 180
debito 250
pagou 100
saldo
```

## Backup

Automático todo dia às 02:00.

Manual:

```txt
backup
```

Os backups ficam na pasta:

```txt
/data/backups
```
