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


## Atualização: eSIM manual quando o estoque automático acabar

Agora é possível cadastrar apenas o plano eSIM sem QR Code. Quando a revenda comprar um plano sem QR disponível no estoque, o sistema:

1. Aprova a compra.
2. Debita o saldo da revenda.
3. Cria pedido pendente com `entrada_label = eSIM Manual`.
4. Avisa os admins pelo WhatsApp.
5. Permite entregar pelo WhatsApp admin com:
   - `/esimpendentes`
   - `/entregaresim ID_DO_PEDIDO`

Depois de `/entregaresim ID`, envie a foto do QR Code ou texto da entrega.


## Atualização: plano e QR separados

- Cadastre o plano eSIM primeiro, por exemplo TIM 50GB.
- O plano fica disponível para venda manual mesmo sem QR.
- Para adicionar QR, selecione o plano cadastrado e envie a imagem do QR.
- Com QR disponível: entrega automática.
- Com estoque zerado: venda manual.


## Atualização: apagar plano eSIM

Na aba eSIM agora existe a opção **Apagar plano**.

Ao apagar:
- O plano fica inativo.
- QR Codes disponíveis desse plano são removidos.
- Pedidos antigos não são apagados.
- QR Codes já vendidos não são alterados.


## Atualização: editar plano eSIM

Na aba eSIM agora existem as opções:
- ✏️ Editar plano
- 🗑️ Apagar plano

A edição permite alterar:
- Nome do plano
- Preço revenda
- Preço cliente
- Ativo/Inativo

Ao editar, apenas QR disponíveis são atualizados. Pedidos antigos e QR vendidos não são alterados.


## Correção temas
Tema muda foto automaticamente e mantém iniciarWhatsApp intacto.


## Atualização final: galeria hacker e temas extras

Temas prontos:
- Hacker Verde
- Hacker Azul
- Hacker Vermelho
- Hacker Roxo
- Gold VIP
- Matrix Hacker
- Cyber Security
- Black Elite

Cada tema muda automaticamente:
- Cores
- Fundo
- Foto hacker
- Cards
- Botões
- Menu lateral

As fotos/modelos ficam salvos em `/data/themes`.


## Atualização: entrega eSIM somente pelo painel

A entrega manual pelo WhatsApp admin foi removida do fluxo principal.

Agora:
1. Revenda compra eSIM.
2. Se não houver QR automático, o pedido fica PENDENTE.
3. Admin recebe apenas aviso no WhatsApp.
4. Admin entra no painel em Pedidos.
5. Clica em **📤 Entregar QR**.
6. Envia a imagem do QR ou texto.
7. O sistema envia ao cliente/revenda e finaliza o pedido.


## Correção: temas com fotos

Na tela Configurações, os cards dos temas agora mostram a foto hacker de cada tema.
Ao aplicar um tema, a imagem também é copiada para `/public/img/hacker.png`.
Os modelos ficam salvos em `/data/themes`, então não perde ao reiniciar o Render.


# CentralUnlocker 3.0 — Integração BotZap

Esta versão adiciona o webhook:

```txt
POST /webhook/botzap
GET /webhook/botzap
```

Use no BotZap no bloco **HTTP (API JSON)**:

```txt
Método: POST
URL: https://pixgonovo.onrender.com/webhook/botzap
Headers: {"Content-Type":"application/json"}
```

Body JSON sugerido:

```json
{
  "telefone": "{{contact_phone}}",
  "nome": "{{contact_name}}",
  "mensagem": "{{message_text}}",
  "conversa": "{{conversation_id}}"
}
```

A rota responde:

```json
{
  "ok": true,
  "resposta": "texto para enviar ao cliente",
  "text": "texto para enviar ao cliente",
  "message": "texto para enviar ao cliente",
  "messages": []
}
```

Variáveis opcionais:

```txt
BOTZAP_ENABLED=1
BOTZAP_SECRET=
```

Se usar `BOTZAP_SECRET`, envie no header:
```json
{"Authorization":"Bearer SEU_TOKEN"}
```

Observação: esta versão mantém o WhatsApp antigo no código, mas permite testar o atendimento via BotZap sem depender de sessão/QR.


# CentralUnlocker 3.0 — API limpa para BotZap

Novas rotas:

```txt
POST /webhook/botzap
POST /api/botzap/message
POST /api/botzap/menu
POST /api/menu
POST /api/esim
POST /api/pix
POST /api/imei
```

Todas retornam:

```json
{
  "ok": true,
  "resposta": "texto para o cliente",
  "text": "texto para o cliente",
  "message": "texto para o cliente",
  "data": {
    "resposta": "texto para o cliente"
  }
}
```

No BotZap, no bloco HTTP, crie o mapeamento:

```txt
Variável: resposta
Caminho: resposta
```

No bloco Mensagem use:

```txt
{{resposta}}
```
