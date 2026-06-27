# V20 — Debitar saldo / lançar débito

Correção implementada na conta do cliente/revenda:

- Mantém **Registrar Pagamento**.
- Adiciona **Debitar saldo / lançar débito**.
- Pré-pago:
  - Registrar pagamento aumenta crédito.
  - Debitar reduz crédito.
- Pós-pago:
  - Registrar pagamento abate dívida.
  - Debitar aumenta débito.
- Cliente recebe aviso no Telegram.
- Movimento de débito fica registrado em `pagamentos` com valor negativo e origem `debito_manual`.

Regra financeira usada:

- Saldo positivo = crédito disponível.
- Saldo negativo = débito em aberto.
- Saldo zero = conta quitada.
