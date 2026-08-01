# V88 - Comandos administrativos no WhatsApp

Alterações desta versão:

- Menu lateral: `WhatsApp (3 sessões)` passou a aparecer como `Conectar WhatsApp`.
- Comando `pedidos` no WhatsApp autorizado:
  - lista os serviços que possuem pedidos PENDENTES ou EM PROCESSO;
  - ao digitar a opção do serviço, lista os IMEIs/entradas e o status.
- Comando `buscar` no WhatsApp autorizado:
  - solicita o IMEI;
  - localiza o pedido;
  - oferece `1 - EM PROCESSO` e `2 - FINALIZAR`;
  - usa as mesmas rotinas do painel para notificar o cliente sobre mudança de status/finalização.
- Autorização:
  - números definidos em `ADMIN_NUMBERS`;
  - qualquer destinatário WHATSAPP ativo cadastrado em `Destinatários de avisos`.
- Os comandos administrativos são tratados antes do cadastro de cliente, evitando cadastrar o número do administrador como revenda apenas por usar esses comandos.

A estrutura de múltiplas sessões e a reconexão automática da V87 foram mantidas.
