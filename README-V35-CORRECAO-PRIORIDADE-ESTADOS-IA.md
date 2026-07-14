# V35 — Correção de prioridade dos estados sobre a IA

Correções no WhatsApp:

- A opção **1 — Pagar este serviço** agora é processada antes do Gemini.
- A opção **2 — Adicionar saldo** no aviso de saldo insuficiente continua no fluxo de saldo.
- O submenu **Minha Conta** mantém o estado; a opção **5** pede o valor do saldo.
- Os estados críticos são persistidos no SQLite e recuperados após reinício do Render.
- A IA só recebe mensagens quando não existe menu, submenu, pagamento, CPF/CNPJ, IMEI, eSIM ou confirmação ativa.
- O comando `menu` limpa a operação atual e abre o menu principal.
- A opção `0` retorna ao menu principal em qualquer submenu.

Variáveis da IA permanecem as mesmas no Render.
