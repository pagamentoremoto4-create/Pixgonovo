# V64 — Três sessões independentes do WhatsApp

## Sessão 1 — Suporte + IA
- QR Code próprio no painel.
- IA independente, com ativação/desativação.
- Consulta produtos, serviços, preços, prazos e estoque do banco.
- Ao detectar compra, contratação, PIX, saldo, IMEI ou pedido, direciona para o número do Bot de Serviços configurado no painel.
- Não cria pedidos, não gera PIX e não altera saldo.

## Sessão 2 — Bot de Serviços
- Mantém todo o fluxo atual: menu, cadastro, serviços, eSIM, estoque, saldo, PIX, pedidos, histórico e Telegram.
- IA própria com ativação/desativação independente.

## Sessão 3 — Anúncios em grupos
- QR Code próprio.
- Não responde mensagens.
- Lista os grupos em que a conta participa.
- Permite selecionar todos ou grupos específicos.
- Envia texto, foto ou foto com legenda.
- Intervalo configurável entre 5 e 120 segundos, padrão de 7 segundos.
- Exibe progresso, enviados, falhas e permite cancelar.

## Painel
Acesse **Sistema → WhatsApp (3 sessões)**.

Na própria tela você configura:
- IA do Suporte;
- IA do Bot de Serviços;
- número do Bot de Serviços usado no encaminhamento.

Para campanhas, clique em **Abrir campanhas do WhatsApp**.

## Variáveis recomendadas no Render
```env
WHATSAPP_ENABLED=true
WHATSAPP_SUPPORT_ENABLED=true
WHATSAPP_ADS_ENABLED=true
OPENAI_API_KEY=sua_chave
WHATSAPP_BOT_SERVICOS=55DDDNUMERO
DATA_DIR=/data
```

As sessões são salvas em:
- `/data/whatsapp-services-session`
- `/data/whatsapp-support-session`
- `/data/whatsapp-ads-session`
