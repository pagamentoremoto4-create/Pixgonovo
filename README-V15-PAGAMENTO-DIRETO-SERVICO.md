# V15 — Pagamento direto do serviço

Alterações implementadas:

- Saldo insuficiente mostra serviço, IMEI, valor, saldo e valor faltante.
- Opções: pagar o serviço, adicionar saldo ou cancelar.
- Em adicionar saldo, o cliente digita somente o valor, por exemplo: `50`.
- O PIX do serviço é gerado pelo valor faltante.
- Após aprovação: mostra pagamento confirmado e valor pago.
- O pedido é criado automaticamente no fluxo normal com status PENDENTE.
- O saldo existente usado para completar o serviço é descontado.
- Aplicado no WhatsApp e Telegram.
