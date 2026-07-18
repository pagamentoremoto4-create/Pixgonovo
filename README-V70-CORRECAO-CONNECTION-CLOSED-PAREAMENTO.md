# V70 — Correção de Connection Closed no código de pareamento

- Impede que o evento de fechamento de um socket antigo apague o socket novo.
- Evita reconexão concorrente ao trocar de QR Code para código.
- Aplica a correção às sessões Serviços, Suporte e Anúncios.
- Mantém as sessões independentes e preserva o fluxo seguro de desconectar antes de trocar o número.
