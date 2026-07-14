# V33 — Controle da IA pelo painel

Foi adicionada a aba **🤖 Inteligência Artificial** no painel administrativo.

Recursos:
- Ativar a IA do WhatsApp sem alterar o Render.
- Desativar a IA sem interromper WhatsApp, Telegram, menus ou pagamentos.
- Consultar modelo e status da chave.
- Configuração persistente salva na tabela `configs` do SQLite.
- Limpeza do histórico temporário da IA ao trocar o status.

A chave `GEMINI_API_KEY` continua protegida no Environment do Render e nunca é exibida ou salva pelo painel.
