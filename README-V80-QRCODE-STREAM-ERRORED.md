# V80 — QR Code e Stream Errored

- Trata o código 515 / restartRequired do Baileys como reinicialização normal.
- Gera um novo QR automaticamente quando o socket fecha durante o pareamento.
- Limita a três reinicializações para impedir ciclo infinito.
- Mantém as sessões independentes e inicia somente a sessão escolhida.
- Remove o estado FALHA_QR prematuro após o QR ter sido criado.
