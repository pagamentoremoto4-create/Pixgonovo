# V24 — Revisão completa do fluxo WhatsApp

Correções:
- Minha Conta mantém o estado do submenu.
- Opção 5 abre corretamente o fluxo de adicionar saldo.
- Opção 0 volta ao menu principal em Conta, Histórico, Suporte, eSIM e recarga.
- Histórico mantém o estado para permitir voltar.
- Suporte mantém o estado e trata as opções 1 e 2.
- Consulta de pedido pelo suporte valida se o pedido pertence ao cliente.
- O fluxo de valor PIX aceita 0 para voltar antes de pedir CPF/CNPJ.
- Corrigida referência incorreta a variável `texto` no cancelamento por saldo insuficiente.
- Estados equivalentes do fluxo legado também foram ajustados.

Validação executada:
- `node --check index.js`
