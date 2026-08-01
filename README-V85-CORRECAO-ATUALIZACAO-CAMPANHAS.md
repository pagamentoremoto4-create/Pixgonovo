# V85 — Correção da atualização do painel e abertura das campanhas WhatsApp

## Corrigido

1. A tela `/admin/whatsapp` não recarrega mais a cada 3 segundos de forma permanente.
2. O recarregamento automático agora só acontece enquanto alguma sessão está em `INICIANDO`, `AGUARDANDO_QR` ou `REGERANDO_QR`.
3. O intervalo foi aumentado para 8 segundos e o reload é evitado quando o usuário está preenchendo um campo.
4. A busca dos grupos do WhatsApp agora tem timeout de 15 segundos para impedir que a página de campanhas fique presa caso o Baileys/WhatsApp não responda.

## Resultado esperado

- Com as sessões conectadas, a página WhatsApp fica parada e não atualiza sozinha.
- O botão **Abrir campanhas do WhatsApp** pode ser clicado normalmente.
- Se a busca de grupos travar, a página abre exibindo o erro em vez de ficar carregando indefinidamente.
