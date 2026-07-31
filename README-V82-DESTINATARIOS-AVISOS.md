# V82 — Destinatários de avisos

Nova aba no painel: **Sistema → Destinatários de avisos**.

Recursos:
- cadastro de vários WhatsApps e IDs do Telegram;
- seleção dos avisos: novos serviços, eSIM, pagamentos, finalizados e cancelados;
- ativar/desativar e excluir destinatários;
- botão para testar o envio;
- registro do último envio e do resultado;
- `ADMIN_TELEGRAM_ID` mantido como contato de emergência quando não estiver cadastrado na nova aba.

## Formato dos destinos
- WhatsApp: DDI + DDD + número, somente dígitos. Exemplo: `5575981635708`.
- Telegram: ID numérico. A pessoa deve iniciar o bot antes de receber mensagens.

A tabela é criada automaticamente no primeiro início do sistema.
