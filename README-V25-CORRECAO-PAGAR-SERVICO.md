# V25 — Correção do botão “Pagar este serviço”

## Problema corrigido
O estado do pedido ficava somente na memória do Node.js. Quando o Render reiniciava ou fazia um novo deploy, a opção `1` enviada pelo cliente não encontrava mais a etapa `saldo_insuficiente_servico` e era ignorada.

## Alterações
- Criada a tabela SQLite `pedido_sessoes`.
- O checkout com saldo insuficiente agora é salvo no banco.
- Ao receber `1`, o bot recupera o pedido mesmo depois de reiniciar.
- A etapa de CPF/CNPJ do PIX também continua ligada ao pedido.
- Ao cancelar, voltar ao menu ou concluir a geração, a sessão persistida é apagada.

## Fluxo esperado
1. Cliente informa o IMEI.
2. Bot mostra saldo insuficiente.
3. Cliente envia `1`.
4. Bot solicita CPF ou CNPJ.
5. Bot gera o PIX apenas do valor que falta.
