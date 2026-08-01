# V87 — WhatsApp multissessão

## O que mudou

- Nova tela **Conectar WhatsApp** com botão **Adicionar WhatsApp**.
- Cada sessão é independente e fica salva no disco persistente em `/data`.
- Antes de gerar o QR Code é possível marcar uma, duas ou as três funções:
  - Bot de Serviços
  - Anúncios em Grupos
  - Anúncios no Status
- Depois de conectado, as funções e o nome da sessão podem ser editados sem apagar a sessão.
- É possível cadastrar vários números.
- Sessões registradas são restauradas automaticamente após reinício/deploy do Render.
- O QR Code só volta a ser necessário quando não existem credenciais registradas ou a sessão foi desconectada/apagada.
- A área de campanhas em grupos usa automaticamente uma sessão conectada marcada com **Anúncios em Grupos**.
- A área **Anúncios no Status** publica texto ou imagem usando todas as sessões conectadas marcadas com essa função.

## Migração da V86

Na primeira inicialização da V87, se ainda não existir nenhuma sessão no novo cadastro:

- a sessão antiga do Bot de Serviços é importada automaticamente, se houver credenciais válidas;
- a sessão antiga de Anúncios em Grupos é importada automaticamente, se houver credenciais válidas;
- as pastas e credenciais antigas não são apagadas.

A antiga sessão separada de Suporte + IA fica preservada no disco, mas não é iniciada automaticamente pelo novo gerenciador.

## Persistência no Render

Mantenha `DATA_DIR=/data` e o Persistent Disk montado em `/data`. As novas sessões ficam em `/data/whatsapp-sessions`, enquanto sessões antigas importadas continuam usando a pasta original para evitar exigir novo QR Code.

## Observação sobre Status

O envio de Status utiliza como audiência os clientes/revendas que possuem número de WhatsApp cadastrado no banco do sistema.
