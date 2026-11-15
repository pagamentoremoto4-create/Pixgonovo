# CENTRALUNLOCKER 10.1.11 — primeiro bot

## Configuração

1. Atualize o código completo e mantenha o disco persistente e as variáveis de ambiente atuais. Não substitua o banco de dados nem as sessões.
2. No painel, abra **Canais e vendas** (`/admin/comunidade`). As funções começam desativadas.
3. Telegram: adicione o bot como administrador do canal de anúncios e do grupo de vendas. Autorize publicações no canal. Informe os IDs negativos completos (incluindo o sinal `-`) ou o @username público dos destinos. Para um grupo privado, informe o ID e seu convite `https://t.me/+...`.
4. WhatsApp: mantenha conectada uma sessão habilitada para **Anúncios em Grupos**. A lista usa essa sessão já existente. Escolha o grupo de vendas. Para o canal, cole o link `https://whatsapp.com/channel/...` ou o identificador `...@newsletter`. A sessão deve administrar o canal. A integração usa o Baileys instalado, sem trocar de biblioteca.
5. Marque **Publicar novas vendas confirmadas**. Se desejar a regra de entrada, marque **Exigir entrada no grupo Telegram para novas compras** e informe o convite desse mesmo grupo de vendas.
6. Clique **Validar e salvar**. A validação consulta os destinos e as permissões; não publica mensagens. Os quatro destinos são independentes dos contatos privados de avisos administrativos e não concedem acesso administrativo.
7. Os botões **Enviar teste** publicam uma mensagem de teste no destino escolhido. Use depois de conferir os destinos.
8. Na **Central de Anúncios**, selecione explicitamente **Canal Telegram de anúncios** e/ou **Canal WhatsApp de anúncios** para cada campanha. Os destinos anteriores de campanhas existentes são preservados. Use RASCUNHO para preparar sem enviar.

## Cliente e vendas

- O cliente que precisa entrar no grupo vê **Entrar no grupo** e **Já entrei — Verificar acesso**. A participação é consultada na API do Telegram em cada nova interação de compra; não depende de eventos de entrada nem de uma autorização antiga em cache.
- Os anúncios públicos abrem uma conversa privada de compra. Um anúncio de números abre a escolha de país. eSIM, serviços e Premium encaminham ao produto selecionado. A intenção do anúncio é persistida para continuar depois da entrada no grupo.
- Pedidos já pagos, histórico, instalação manual de eSIM, códigos SMS, troca/cancelamento/finalização de ativações existentes e suporte continuam disponíveis após sair do grupo. Os trabalhos de pagamento, entrega e devolução não dependem dessa exigência.
- A exigência é aplicada ao atendimento de compras do bot Telegram principal. O bot próprio ConsultaVIP continua com suas regras de licenças e uso em grupos; não é o segundo bot parceiro de eSIM.
- Publicações de vendas cobrem pedidos genéricos pagos/debitados (eSIM, DHRU, serviços próprios e GGSOMA/Premium), pedidos Hero locais com comprovante de débito ou Pix e assinaturas ConsultaVIP com pagamento confirmado.
- Criar Pix, criar pedido manual ainda sem cobrança ou fazer recarga não gera aviso de venda. As vendas do bot parceiro não são incluídas como se fossem compras do primeiro bot.
- Ao ativar pela primeira vez, pedidos históricos ficam fora das publicações. Um pedido novo que aguarda pagamento pode ser anunciado quando a cobrança se confirma.
- O aviso contém serviço, valor, referência e nome/telefone parcialmente ocultos. IDs Telegram que aparecem em cadastros antigos no campo WhatsApp são omitidos. O telefone comprado na Hero, SMS, credenciais, QR Codes, documentos, IMEI e dados de consulta não são publicados.
- O botão **Comprar também** do Telegram é um link para o privado, sem botões de compra executados dentro do grupo/canal.
- A fila verifica mudanças a cada 30 segundos. Cancelamento e crédito devolvido só aparecem conforme os estados registrados pelo fluxo financeiro existente. Este módulo não concede crédito nem altera cobranças.

## Fila e recuperação

Os eventos usam referências separadas (`pedido:`, `hero:`, `consulta:`), e cada envio é identificado por evento, destino e plataforma. Referências das mensagens e estados da fila sobrevivem a reinícios no banco existente.

- `pending`: aguardando processamento.
- `retry`: indisponibilidade confirmada antes do envio ou limitação explícita da API.
- `sent`: referência retornada pelo provedor.
- `failed`: rejeição explícita da API. Corrija permissões/configuração e utilize a ação do painel.
- `uncertain`: conexão interrompida, timeout ou processo interrompido durante o envio. A mensagem pode ter chegado. Confira o destino antes de clicar **Reenviar após conferir**; **Arquivar sem reenviar** encerra esse registro.

Cancelamentos e devoluções tentam editar o aviso original. O WhatsApp impõe limites de edição, e o Telegram exige permissões. Uma edição recusada fica registrada; não é enviada automaticamente uma sequência de mensagens substitutas. O histórico das campanhas identifica os canais públicos como **fila**; a confirmação efetiva aparece em Canais e vendas.

Mudanças de destino não provocam publicação em massa de vendas antigas. Mensagens dirigidas a um destino anterior ficam suspensas se ele deixar de ser o destino configurado.

Anúncios preservam a imagem selecionada da campanha. O Telegram usa legenda dentro do limite da plataforma e mantém o botão de compra mesmo se a mensagem for longa. Campanhas existentes continuam com seus clientes privados, grupos e Status anteriores.

## Verificação desta entrega

- Testes automatizados com SQLite em memória e transportes Telegram/WhatsApp simulados: máscara de dados, proteção dos pedidos pagos, participação no grupo, comprovantes, isolamento financeiro, duplicação, recuperação, atualização e separação dos quatro destinos.
- Regressão da integração Hero SMS.
- Inicialização do sistema com banco temporário, páginas administrativas autenticadas, formulário de campanhas e proteção de login.
- Nenhuma compra, cobrança ou mensagem real foi executada nesses testes. A publicação real em canais WhatsApp e as permissões finais dependem da sessão e dos destinos configurados no seu painel. O pacote não atualiza o Render automaticamente.

## Referências

- https://core.telegram.org/bots/api#getchatmember
- https://core.telegram.org/bots/features#deep-linking
- https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/newsletter.ts
- https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/messages-send.ts
