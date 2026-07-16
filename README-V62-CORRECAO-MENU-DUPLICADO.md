# V62 — Correção de menu duplicado no WhatsApp

- Declarada a variável global `conectado`, corrigindo o `ReferenceError` nas rotas do painel.
- Adicionado controle por ID de mensagem do Baileys.
- Eventos repetidos durante sincronização ou reconexão são ignorados por 5 minutos.
- Uma saudação como "Boa noite" agora gera apenas uma resposta/menu.
