# V16 — CPF e CNPJ no PIX

Alteração aplicada no WhatsApp e Telegram.

## Novo comportamento

Ao gerar um PIX, o bot agora solicita CPF ou CNPJ:

- CPF: 11 números
- CNPJ: 14 números
- Pontos, traços e barras são removidos automaticamente

O documento informado é enviado nos campos `receiver_cpf` e `payer_document` da PixGo.

## Mensagem exibida

```text
📄 Informe o CPF ou CNPJ do pagador para gerar o PIX.

Envie somente os números:
• CPF: 11 dígitos
• CNPJ: 14 dígitos
```

O restante do fluxo, incluindo pagamento direto do serviço, adição de saldo e criação automática do pedido, permanece igual à V15.
