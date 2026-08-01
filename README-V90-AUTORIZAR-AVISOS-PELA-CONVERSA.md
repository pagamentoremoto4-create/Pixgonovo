# V90 — Autorizar avisos direto pela conversa do WhatsApp

## Novo fluxo
Somente o número principal configurado em `ADMIN_NUMBER` / `ADMIN_NUMBERS` pode executar estes comandos enviados por ele mesmo dentro de uma conversa privada:

- `ativar avisos`
  - identifica automaticamente o número da conversa;
  - cadastra ou reativa o número em `destinatarios_avisos`;
  - ativa todos os tipos de aviso;
  - libera os comandos `pedidos` e `buscar`;
  - mantém o número visível no painel em Destinatários de avisos.

- `desativar avisos`
  - desativa o destinatário sem apagar o histórico;
  - bloqueia os comandos `pedidos` e `buscar` para aquele número.

## Segurança
O comando só é aceito quando a mensagem possui `fromMe=true` e a sessão conectada pertence a um número presente em `ADMIN_NUMBER` ou `ADMIN_NUMBERS`.
Mensagens de clientes com os mesmos textos são ignoradas como comando de autorização.

## Persistência
O cadastro continua salvo no SQLite em `/data`, portanto sobrevive a reinícios e novos deploys do Render.
