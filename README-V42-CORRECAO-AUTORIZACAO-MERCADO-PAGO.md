# V42 — Correção da autenticação Mercado Pago

- Normaliza `MERCADO_PAGO_ACCESS_TOKEN` e remove `Bearer` duplicado, caso tenha sido salvo junto da chave.
- Valida se o token existe antes de chamar a API.
- Usa um cliente Axios exclusivo do Mercado Pago com `Authorization: Bearer ...` configurado.
- Reforça o cabeçalho também na criação e consulta do pagamento.
- Não mostra o token nos logs.
- Mercado Pago continua sem solicitar CPF/CNPJ.

## Variáveis no Render

```env
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-xxxxxxxx
MERCADO_PAGO_PAYER_EMAIL=email@exemplo.com
BASE_URL=https://seu-app.onrender.com
```

Depois de salvar as variáveis, faça um novo deploy ou reinicie o serviço.
