# V86 — Reconexão automática + funções do WhatsApp

## 1. Reconexão automática no Render
- Ao reiniciar o Render, se `/data/whatsapp-session/creds.json` estiver registrado, o Bot de Serviços tenta restaurar a sessão automaticamente.
- Em falhas transitórias do Baileys/Render, a próxima tentativa continua em modo `restaurar` e não força geração de QR Code.
- O mesmo ajuste foi aplicado às sessões extras (Suporte e Anúncios).
- QR Code só é necessário quando não existe sessão válida ou quando o WhatsApp realmente encerrou/expirou a sessão.

## 2. Escolha de funções do número do Bot de Serviços
No painel **WhatsApp > Funções das sessões**, o número conectado no Bot de Serviços agora possui duas opções independentes:
- **Bot de serviços**: atende clientes, menu, saldo, PIX, eSIM e pedidos.
- **Anúncios em grupos**: usa o mesmo número para campanhas em grupos.

É possível usar:
- somente Bot de serviços;
- somente Anúncios em grupos;
- os dois ao mesmo tempo.

Quando a função **Anúncios em grupos** estiver marcada no Bot de Serviços, as campanhas usam primeiro esse número. Se estiver desmarcada, o sistema usa a sessão exclusiva de Anúncios, como antes.
