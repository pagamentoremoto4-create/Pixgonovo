# V24 — PIX monoespaçado no WhatsApp

- Mantido todo o fluxo atual do PIX.
- Alterado somente o envio do código PIX no WhatsApp.
- O código agora é enviado entre três crases para aparecer em formato monoespaçado.
- Aplicado `trim()` apenas nas extremidades, sem alterar o conteúdo interno do PIX.
- Não foi adicionado QR Code e nenhuma outra etapa foi modificada.
