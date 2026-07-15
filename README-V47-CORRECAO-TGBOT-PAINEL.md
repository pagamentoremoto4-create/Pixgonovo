# V47 — Correção tgBot e estabilidade do painel

## Problema corrigido

O painel podia retornar `ReferenceError: tgBot is not defined` enquanto o Telegram ainda estava iniciando. Isso fazia a requisição da página falhar e dava a impressão de que o painel havia caído e voltado.

## Alterações

- `tgBot` agora é declarado globalmente como `null` antes das rotas e funções.
- A inicialização do Telegram evita criar duas instâncias de polling.
- Erros de polling do Telegram são registrados sem derrubar o servidor.
- O envio de aviso de saldo insuficiente verifica se o Telegram está disponível.

## Resultado esperado

O painel pode abrir e atualizar normalmente durante a inicialização do Telegram, sem gerar `ReferenceError`.
