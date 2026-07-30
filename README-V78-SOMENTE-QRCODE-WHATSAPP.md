# V78 — WhatsApp somente por QR Code

Alterações:

- Removida do painel a conexão por número/código de pareamento.
- As três sessões agora exibem apenas o botão **Gerar QR Code**.
- Ao fechar a conexão antes da leitura, o sistema entra em **REGERANDO_QR** e tenta criar outro QR automaticamente.
- O QR é convertido para imagem Base64 e exibido no painel.
- O painel atualiza a cada 3 segundos para mostrar o QR assim que for recebido.
- Ao clicar em Gerar QR Code, somente a sessão escolhida é limpa e reiniciada.

Uso:

1. Abra **Painel > WhatsApp**.
2. Na sessão desejada, clique em **Desconectar** para apagar credenciais antigas.
3. Clique em **Gerar QR Code** uma única vez.
4. Aguarde o status **AGUARDANDO QR CODE**.
5. No celular: WhatsApp > Aparelhos conectados > Conectar aparelho.
