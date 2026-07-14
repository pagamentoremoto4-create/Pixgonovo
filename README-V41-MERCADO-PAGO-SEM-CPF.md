# V41 — Mercado Pago sem CPF/CNPJ

- Mercado Pago gera PIX diretamente, sem solicitar CPF/CNPJ ao cliente.
- PixGo continua solicitando CPF ou CNPJ.
- Quando os dois gateways estão ativos, o cliente escolhe; Mercado Pago gera imediatamente e PixGo solicita documento.
- Corrigida a variável `qrCodeBase64` que causava ReferenceError no painel/WhatsApp.
- Mantida a confirmação automática e proteção contra pagamento duplicado.
