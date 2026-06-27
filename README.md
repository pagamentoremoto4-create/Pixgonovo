# Pixgonovo Telegram v14

Correção financeira pós-pago/pré-pago:
- Pré-pago: desconta saldo na solicitação e estorna ao cancelar.
- Pós-pago: não desconta na solicitação; cria débito quando o pedido é finalizado.
- A mensagem de serviço concluído mostra débito em aberto para pós-pago quando houver valor devido.
- Conta quitada só aparece quando o saldo/debito realmente estiver zerado.
