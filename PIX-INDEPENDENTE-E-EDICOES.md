# Versão 10.1.17 — Pix independente e continuidade das mensagens

## Menu principal preservado

O menu em texto, seus nomes padrão, emojis, ordem e montagem não foram modificados. Nenhum dos cinco modelos visuais apresentados foi aplicado. A configuração anterior é preservada; instalar não ativa listas, Pix ou disparos.

## Configuração recomendada para o primeiro teste

Abra `/admin/menu-whatsapp/modelos`:

1. **Funcionamento** do menu visual: **Desativado — menu atual**.
2. **Ativação do Pix com botão**: **Teste — somente o telefone Pix**.
3. **Telefone de teste do Pix**: seu número privado com DDI e DDD.
4. **Apresentação do Pix**: **Cartão único com QR, código e Copiar Pix — experimental**.
5. Salve. Envie `menu` ao bot: o menu continua no formato antigo.
6. Solicite um pagamento pelo fluxo normal para testar o cartão. Isso gera cobrança real; não é necessário pagar para conferir a exibição inicial. Não crie cobranças repetidas se já houver uma pendente.

Pix e listas agora possuem ativação independente. `menu texto` não desativa o botão Pix. Depois da validação no celular, o administrador pode escolher Pix ativo para todos, mantendo o menu visual desativado.

As configurações antigas sem os campos novos herdam a ativação Pix anterior, sem habilitação automática extra. O modo e telefone Pix ficam independentes depois de salvos. A opção **Formato anterior** do Pix também permanece disponível, inclusive com o botão de cópia separado que funcionava nos dois aparelhos.

## Uma mensagem acompanhando o fluxo

O fluxo tenta usar a mesma referência:

- Gerando seu Pix…
- Cartão aguardando pagamento, com QR, valor, código completo e Copiar Pix.
- Pagamento confirmado, aguardando entrega.
- Entrega ou estado do pedido.
- Próximas atualizações relacionadas ao pedido.

O aviso de geração não é apagado. O bot tenta transformá-lo em cartão usando uma mensagem de edição do protocolo WhatsApp. Se o envio dessa edição falhar, envia o cartão e edita o aviso para indicar a mensagem seguinte. Não gera uma segunda cobrança.

O QR é gerado do código completo real e o mesmo código aparece no texto e no botão. A imagem é um cabeçalho nativo e fica acima do texto: a ordem ilustrada com QR abaixo da instrução não é garantida nesse componente.

**Limite importante:** o protocolo pode aceitar uma edição sem o celular exibi-la. Transformar texto em cartão com mídia/botão e depois em entrega ainda precisa de validação no Android e no iPhone. Não foi comprovado nos aparelhos durante o desenvolvimento. Se o cartão ficar invisível, use o formato anterior com QR e botão separados pelo painel.

## Pagamento tardio e referência nova

Editar não reinicia o prazo do WhatsApp. O sistema usa margem conservadora de 14 minutos desde o envio original.

Para serviços com cartão Pix registrado, se a confirmação não puder ser editada, o bot aguarda a entrega/estado do pedido em vez de criar mais um aviso separado de pagamento confirmado. A entrega tenta reutilizar a referência; se não puder, envia uma nova mensagem e salva sua referência. As atualizações seguintes editam essa nova mensagem. Se o prazo dela também acabar, o procedimento se repete.

A recarga de carteira usa sua confirmação como estado final e, se necessário, envia esse estado em uma nova mensagem. Erros de envio sem confirmação não são prova de entrega no telefone.

## Cobertura dos pedidos

- **Hero SMS:** o primeiro cartão do pedido tenta aproveitar a referência do Pix. A referência que o mensageiro Hero salvar passa a receber número, SMS, troca, cancelamento e finalização pelo mecanismo existente. Se o cartão Pix não puder ser editado, é criado um cartão de pedido novo. Não são alterados critérios da API nem estornos.
- **eSIM por Pix no checkout direto:** o pedido é ligado ao Pix e a entrega tenta atualizar o cartão com o QR real de ativação, dados e opções de instalação. Falha de edição envia a entrega nova e salva a referência. Reconsultas de entrega pelo histórico continuam usando o fluxo existente. Lotes e compras com saldo mantêm suas regras e entregas individuais.
- **Serviços próprios/DHRU:** pedidos criados pelo checkout Pix são ligados à referência; avisos explícitos do pedido reutilizam essa referência quando possível. Notificações Telegram continuam pelo canal original.
- **GGSOMA:** o vínculo de apresentação é criado antes da execução do pedido. A entrega e as recuperações usam o ID explícito do pedido. Tokens, estoque, saldo e autorização continuam nos mecanismos anteriores.
- **ConsultaVIP e outros fluxos próprios:** não foram convertidos automaticamente; mantêm seu fluxo especializado.

Em compras com vários pedidos, apenas o primeiro herda o cartão Pix. Os demais possuem referências próprias, para um pedido não sobrescrever a entrega de outro. Mensagens administrativas, anúncios, menus e dados de outro cliente não entram nessa cadeia.

Os vínculos ficam em tabelas de apresentação no SQLite e sobrevivem ao reinício. O destinatário, gateway, pagamento, valor e cliente do pedido são conferidos. Essas tabelas não confirmam pagamento, não cobram, não creditam nem devolvem dinheiro.

## Outro teste para iPhone

Em `/admin/menu-whatsapp/testes`, escolha **Lista tradicional — comparar iPhone e Android** e seu telefone privado. É um formato diferente do native-flow single_select e usa uma lista tradicional do protocolo. O teste não altera o menu em produção e não compra serviços nem gera Pix.

Abra a lista e toque em uma opção. O bot responde somente com confirmação de demonstração. Registre no painel se apareceu e funcionou. Se também não aparecer, mantenha o menu em texto; esta versão não anuncia compatibilidade iPhone comprovada.

## Validação

273 testes automatizados passaram: Hero 143, comunidade 31, cobrança 19, laboratório WhatsApp 17, menus/Pix/continuidade 63. Incluem pagamento tardio, referência nova usada pela atualização seguinte, reinício, cliente incorreto, lote com pedidos separados, QR de ativação e protocolo real de edição. O painel também foi conferido com banco temporário sem envio externo.

Nenhuma mensagem real, pagamento ou implantação no Render foi executada durante o desenvolvimento. Preserve banco, disco persistente, sessões e configurações ao instalar o ZIP completo.
