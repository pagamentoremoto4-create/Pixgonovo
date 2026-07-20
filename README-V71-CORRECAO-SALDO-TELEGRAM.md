# V71 — Correção do desconto de saldo

## Erro encontrado
No fluxo de criação de pedidos pelo Telegram, clientes pré-pagos tinham o pedido salvo com `cobrado=1`, mas o saldo não era debitado. Ao finalizar, o sistema não cobrava novamente porque o pedido já constava como cobrado.

## Correções
- Debita o saldo imediatamente após criar pedidos pré-pagos pelo Telegram.
- Usa `MAX(0, saldo-?)` para evitar saldo negativo nesse fluxo.
- Finalização agora marca a cobrança de forma condicional (`cobrado=0 -> 1`) e só então debita, evitando cobrança duplicada.
