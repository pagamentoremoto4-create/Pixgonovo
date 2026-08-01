# V95 — Reconexão automática sem clicar em Gerar QR Code

Correção baseada no comportamento confirmado no Render: a sessão aparecia como não registrada no boot, mas ao clicar em **Gerar QR Code** conectava automaticamente sem escanear o código.

A V95 executa esse mesmo fluxo automaticamente no boot para sessões que já possuem número salvo ou arquivo `creds.json`. Sessões realmente novas continuam exigindo QR Code.

Também aplica a mesma lógica no watchdog e nas tentativas de reconexão.
