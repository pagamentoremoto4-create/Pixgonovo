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


## Atualização: temas prontos e fotos hacker

Nova aba no painel:

```txt
/admin/temas
```

Recursos:
- Temas prontos: hacker verde, azul, vermelho, roxo, dark pro e gold VIP.
- Modelos de imagens hacker gerados automaticamente.
- Upload de foto hacker pelo painel.
- Usar link de imagem.
- Tudo fica salvo no Persistent Disk em `/data/themes`.
- Configuração salva no banco, não perde ao reiniciar o Render.

Variável opcional:
```txt
THEME_DIR=/data/themes
```
