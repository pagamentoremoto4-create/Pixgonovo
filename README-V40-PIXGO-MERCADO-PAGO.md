# V40 — PixGo + Mercado Pago

## Implementado

- PixGo mantida no sistema.
- Mercado Pago adicionado para gerar PIX.
- Nova aba no painel: **Formas de pagamento**.
- Ativação e desativação independente de cada gateway.
- Se os dois estiverem ativos, o cliente escolhe PixGo ou Mercado Pago.
- Se apenas um estiver ativo, ele é usado automaticamente.
- Se os dois estiverem desativados, o cliente recebe aviso de indisponibilidade.
- Confirmação automática por consulta de status.
- Endpoint de webhook do Mercado Pago: `/webhook/mercadopago`.
- Proteção contra crédito/pedido duplicado mantida pela tabela `pix_pedidos`.

## Variáveis no Render

```env
PIXGO_API_KEY=sua_chave_pixgo
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-sua_chave_mercado_pago
MERCADO_PAGO_PAYER_EMAIL=cliente@centralunlocker.com.br
BASE_URL=https://seu-app.onrender.com
```

Não coloque as chaves diretamente no código nem envie para clientes.

## Painel

Acesse:

`Painel administrativo > Formas de pagamento`

O Mercado Pago começa desativado por segurança. Configure o Access Token no Render e depois ative pelo painel.
