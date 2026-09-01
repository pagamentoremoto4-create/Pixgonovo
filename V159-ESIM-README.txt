V159 - eSIM automático iPhone / Android

Implementado:
- Leitura automática do QR Code ao adicionar estoque.
- Extração e armazenamento do LPA completo, SM-DP+, código de ativação e confirmação.
- Bloqueio de QR/eSIM duplicado pelo hash do LPA.
- Cliente escolhe iPhone ou Android antes da entrega.
- iPhone: NÃO recebe QR; recebe SM-DP+, código de ativação e confirmação.
- Android: recebe QR Code + LPA original completo, sem reconstruir/alterar caracteres.
- Reenvio respeita o aparelho usado na venda.
- Pagamento PIX preserva a escolha iPhone/Android.
- QR antigo no estoque é lido automaticamente na primeira entrega, quando possível.

Novas dependências:
- jsqr
- sharp

No Render, o npm install padrão instalará as dependências do package.json.
