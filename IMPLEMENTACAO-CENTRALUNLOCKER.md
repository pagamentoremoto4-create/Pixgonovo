# CENTRALUNLOCKER — Integração Hero SMS WhatsApp

## Implementado nesta versão
- Padronização de textos de marca para CENTRALUNLOCKER.
- Restrições de compra Hero SMS ao serviço WhatsApp, inclusive em compras iniciadas no Telegram (canal de atendimento).
- Histórico de pedidos WhatsApp no canal WhatsApp: digite `pedidos whatsapp`.
- Solicitação de cancelamento WhatsApp: `cancelar número 123`, substituindo 123 pelo ID do pedido.
- No Telegram, menu de cancelamento de pedidos sem código.
- Cancelamento pelo endpoint compatível SMS-Activate `setStatus`, `status=8`, reconhecendo exclusivamente `ACCESS_CANCEL` como confirmação.
- Estorno integral do preço cobrado para a carteira, com transação SQLite e verificação de estado para impedir crédito repetido.
- Respostas incertas ficam em `cancel_pending`, sem estorno automático. Requerem conferência do administrador.
- Compras continuam pelo fluxo já existente de saldo/Pix; consulta de SMS segue o polling já existente.

## Limites e verificações necessárias
- NÃO foi executada compra/cancelamento real na conta Hero SMS, nem cobrança real via Pix.
- A API pode recusar cancelamento por tempo mínimo, prazo ou OTP recebido.
- A integração de FlashCall e Voz ainda NÃO está implementada: fluxo existente usa `getNumberV2` e `getStatus` (SMS). Não anunciar voz/chamada até homologar endpoints REST de ofertas/OTP.
- Se o provedor confirmar cancelamento mas ocorrer erro ao creditar saldo, a ativação ficará pendente de reconciliação administrativa. Não execute um segundo cancelamento cego.
- Revise configurações de câmbio, estoque e margem de R$25 no painel; não há cotação cambial automática garantida.
- O código legado contém outras telas e rotas para catálogo de serviços; a restrição efetiva de compras Hero SMS está no checkout.
- Antes de produção, testar reinício do Render, repetição de webhook Pix, cancelamento repetido e reembolso após falha de banco.
