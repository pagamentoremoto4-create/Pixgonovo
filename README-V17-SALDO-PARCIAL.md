# V17 — Débito correto do saldo parcial

Quando o cliente paga diretamente um serviço e já possui parte do valor em saldo:

- o saldo disponível usado no pedido é registrado no momento em que o PIX é gerado;
- o PIX é criado somente pelo valor restante;
- após a confirmação do PIX, o saldo parcial é debitado da carteira;
- o pedido é criado normalmente com o valor total;
- o mesmo pagamento não pode ser processado duas vezes.

Exemplo: serviço de R$ 200, saldo de R$ 20 e PIX de R$ 180. Após a confirmação, o saldo fica R$ 0 e o pedido de R$ 200 é criado como PENDENTE.
