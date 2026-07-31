# V81 — Correção do fluxo de adicionar saldo

## Alterações

- Mensagens com frases não são mais interpretadas como valor de saldo.
- Apenas números puros, como `50` ou `50,00`, são aceitos no estado de pagamento.
- Frases como `manda`, `tenho 5 TIM` e `tem 5 em processo?` encerram o estado de valor e seguem para o atendimento normal.
- O estado de informar valor expira automaticamente após 5 minutos.
- Valores abaixo de R$10 continuam sendo recusados.
- Correção aplicada no WhatsApp e no Telegram.

## Teste recomendado

1. Abra PIX / Pagamentos.
2. Envie `manda` — o bot não deve responder com erro de valor.
3. Abra novamente e envie `5` — deve informar valor mínimo de R$10.
4. Abra novamente e envie `50` — deve iniciar o pagamento normalmente.
