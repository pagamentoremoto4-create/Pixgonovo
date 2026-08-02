# V110 — Botão COMPRAR AGORA para serviços

- A Central de Anúncios permite escolher Produto/eSIM ou Serviço como destino do botão `🛒 COMPRAR AGORA` do Telegram.
- Produto/eSIM continua usando o fluxo `esim_<id>` já existente.
- Serviço usa o fluxo `servico_<id>` já existente e abre diretamente a solicitação do serviço para o cliente informar o dado exigido (IMEI ou outro tipo de entrada configurado).
- Edição e duplicação de anúncios preservam o destino do botão.
- Anúncios antigos com `produto_id` continuam compatíveis.
