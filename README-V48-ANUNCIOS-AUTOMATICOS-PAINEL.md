# V48 — Anúncios automáticos no painel

## Implementado

- Nova aba **📣 Anúncios automáticos** no menu administrativo.
- Cadastro de campanha com nome, texto e imagem opcional.
- Intervalos de 1, 2, 4, 12 ou 24 horas.
- Seleção de envio por WhatsApp, Telegram ou pelos dois canais.
- Envio apenas para clientes ativos.
- Botões **Ativar**, **Pausar**, **Anunciar agora** e **Apagar**.
- Primeiro envio em instantes quando a campanha é criada já ativada.
- Worker automático verifica campanhas a cada minuto.
- Em falha interna, nova tentativa é programada para 10 minutos depois.
- Resultado do último disparo exibido no painel.
- O botão **Anunciar agora** executa em segundo plano para não travar nem derrubar a página.
- Banco atualizado automaticamente com a tabela `campanhas_anuncios`.

## Observações

- WhatsApp precisa estar conectado para os envios desse canal.
- Telegram precisa estar iniciado, e o cliente precisa possuir `telegram_id` cadastrado.
- Uma conta vinculada pode receber nos dois canais quando ambos forem marcados.
- As imagens são armazenadas no disco persistente configurado por `DATA_DIR`.
