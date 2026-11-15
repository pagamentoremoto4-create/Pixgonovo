# CENTRALUNLOCKER 10.1.8 — correções consolidadas

## Pedido declarado como teste

O administrador pode encerrar um pedido em `uncertain`, sem ativação, telefone ou
código registrados. O formulário exige autenticação, token de formulário e declaração
explícita de que se trata de teste encerrado no fornecedor. A ação atualiza somente
o pedido selecionado para `test_closed`, guarda auditoria e coloca a mensagem do
cliente na fila de atualização. Ela não consulta/cria/cancela cobranças, não altera
o estado financeiro do Pix, não movimenta a carteira e não remove o histórico.
O worker ignora o teste encerrado. Uma confirmação repetida não repete efeitos.
Não é permitido encerrar por essa opção uma ativação real já identificada.

O pedido #15 da hospedagem do usuário não foi acessado nem alterado nesta revisão.
Depois de instalar, use `/admin/herosms/pedidos/15` e a seção "Encerrar pedido de teste".

## Compra e troca Hero SMS

Novas compras usam a rota REST documentada `POST /api/v1/activations`, autenticada
com `Authorization: ApiKey ...`, corpo com país inteiro, serviço, quantidade 1 e
verificação SMS. A resposta precisa conter exatamente uma ativação em `data`.
Um ID válido é preservado mesmo quando faltar o número; a operação fica em
conferência e não é repetida automaticamente. Erros registram título/detalhe
seguros retornados pelo fornecedor, em vez de apenas "Request failed with status code".

Na documentação enviada, `getNumberV2` declara HTTP 404 como método não encontrado
(`BAD_ACTION`). O registro antigo do #15 conservou só o HTTP 404; seu corpo original
não pode ser reconstruído. A migração REST não executa novamente o #15.
O teste de compra real no painel também usa a rota REST; só ocorre por ação explícita.

Troca usa a resposta autenticada da solicitação para o ID original. Uma única
ativação válida retornada pode possuir um novo ID. O número e o ID atualizam o mesmo
pedido, sem nova cobrança. Resposta com múltiplas ativações fica em conferência;
resposta incompleta conserva o ID conhecido para sincronização. Se o fornecedor
retornar o mesmo telefone, não anuncia falsamente que um número diferente chegou.

## Telegram e WhatsApp

Cada pedido conserva a referência da mensagem e o último conteúdo confirmado.
O código SMS atualiza o card. Conteúdo inalterado não gera envio repetido. A fila
por pedido evita concorrência dentro do processo, e referências persistem no SQLite.
No Telegram, abrir o pedido ou solicitar troca adota a mensagem atual do callback;
mensagem com mídia usa edição de legenda. O novo número e os próximos SMS aparecem
no card que o cliente está vendo, em vez de ficarem apenas numa mensagem antiga.

No WhatsApp, edição usa a conta/sessão original e a chave da mensagem. Fora da janela
conservadora de edição, uma mensagem substituta passa a ser a referência atual.
Falha temporária de conexão é tratada como tentativa pendente. A consulta de SMS
ocorre a cada 20 segundos; não há promessa de atualização instantânea via webhook.
As opções manuais de consultar código e atualizar não fazem parte do card.

## Pix

Hero SMS utiliza exclusivamente o gateway padrão ativo do painel, sem substituí-lo
pela preferência individual da revenda. Padrão desativado bloqueia nova geração.
Cobranças já existentes são consultadas no gateway gravado em cada pagamento.
DePix Pay recebe CPF/CNPJ válido salvo, ou coleta o documento antes de criar cobrança.
A imagem QR usa a sessão de atendimento e o JID/LID resolvido para o cliente.

MisticPay normaliza `transaction.value`, valor em reais, sem descontar `fee` nem
converter por suposição. Referência consultada: https://docs.misticpay.com/ ,
seção POST /api/transactions/check. Compatibilidade com amount/transactionAmount
foi mantida para respostas antigas, com value como primeira opção.

Confirmação exige consulta autenticada, ID, valor, cliente, método e contexto local
correspondentes. `HERO_PIX_VALIDATION` distingue o campo ausente ou divergente sem
registrar documentos ou credenciais. Um valor realmente divergente não libera número.
Comprovantes persistentes e recuperação após reinício evitam perda de pagamentos e
compras duplicadas. `delivered` só é usado após ativação/número persistidos;
compra incerta continua pendente e nunca é repetida automaticamente.

## Cancelamento e carteira

Cancelamento pelo bot exige elegibilidade e confirmação `ACCESS_CANCEL` antes do
crédito integral do preço pago à carteira. É crédito em saldo interno, inclusive
para compra paga por Pix; não é estorno bancário. Transação SQLite dedicada, registro
por pedido e comprovante persistente impedem crédito repetido e permitem recuperação
quando a confirmação foi salva antes de uma falha de crédito.
A espera de 120 segundos conta da entrega do número, e é reiniciada numa troca.

O polling reconhece `STATUS_CANCEL`, independentemente da consulta REST de histórico.
Eventos externos ficam em fila persistente mesmo sem card anterior. Falha de envio
não marca evento como entregue. Pedidos incertos com ID conhecido são acompanhados;
ID ausente nunca é adivinhado por telefone, horário ou preço.

Há um formulário separado para associar o ID exato de uma ativação cancelada
manualmente, após declaração do administrador e confirmação `STATUS_CANCEL` do
fornecedor. Não cancela novamente e não credita saldo sozinho.

O esquema `ActivationHistoryStatus` do OpenAPI enviado define expressamente
6=concluída, 8=cancelada e 10=reembolso. A definição genérica de status não
repete as descrições. O reembolso 10 é registrado como prova para a ativação
exata antes do crédito; 8/STATUS_CANCEL isolados aguardam confirmação financeira.
A consulta inclui pedidos antigos pendentes, sem cortar a busca em 30 dias.

## Catálogo e Render

O catálogo não carrega todas as ofertas no Node para gerar uma página gigante.
Busca e paginação no SQLite retornam até 100 registros por página; totais são
calculados sobre todo o catálogo. Testes com 15 mil ofertas verificam busca após
os primeiros 10 mil registros e navegação. Nomes vindos da busca são escapados.

`render.yaml` apontava healthCheckPath=/health, mas essa rota não existia. A versão
cria `/health`, verifica a conexão do banco e informa versão 10.1.7. O serviço de
produção respondeu 200 na página inicial e 401 no catálogo sem login na checagem
pública feita após o relato de 502. Não foi possível atribuir aquele 502 a uma causa
única sem logs do Render; a paginação reduz a carga da rota, mas não comprova sozinha
que não ocorrerão falhas da hospedagem.

## Verificação e pacote

127 testes passaram com SQLite e respostas simuladas. Incluem compra REST, troca
com novo ID, Telegram com texto/legenda, valor e ID do Pix, saldo, cancelamento,
filas, teste encerrado, repetição de operações e catálogo com 15 mil registros.
Não foram feitas operações financeiras reais nem deploy na conta do usuário.
O ZIP completo preserva código, imagens, módulos e testes, sem .env privado,
banco local, sessões, chaves geradas ou node_modules. Configure seu ambiente e
preserve o DATA_DIR existente na atualização. O projeto declara Node 20.x; os testes
locais foram executados no Node 24.22.1.

## Países e abertura de pedidos — 10.1.6

Sincronização via GET /api/v1/activations/offers/sms?services=wa, com snapshot validado e transação própria. Países novos começam ocultos e as escolhas administrativas são preservadas. O painel /admin/herosms/paises permite sincronizar e ativar cada país. WhatsApp e Telegram exibem países habilitados com estoque e mantêm o preço individual existente, com padrão R$ 25.

Selecionar um pedido na lista do WhatsApp transforma a mensagem visível da lista no cartão do pedido; sessões antigas recebem um cartão novo. Atualizações automáticas posteriores usam esse cartão. Troca e cancelamento continuam condicionados ao estado, ausência de SMS e espera de 120 segundos.

Validação local com testes automatizados e respostas simuladas. Não foram realizadas compras, pagamentos nem implantação na hospedagem.

## Fluxo completo — 10.1.7

O módulo hero-sms-lifecycle.js persiste snapshot de compra/troca com expiração,
custo/moeda e estado do fornecedor; recupera todos os SMS paginados por ativação;
deduplica eventos por ID e concilia o código provisório da API compatível.
Mensagens sem código também bloqueiam troca/cancelamento. Os handlers consultam
SMS/status antes de executar essas ações e usam trava condicional no banco.

O cartão apresenta prazo em minutos, códigos numerados com horários de Brasília,
páginas de 8 mensagens e opções elegíveis. Saldo e pagamento ficam fora do cartão
entregue; saldo aparece no menu/checkout e na devolução concluída. Ao abrir Meus
números, o cartão visível é adotado. Listas de pedidos têm paginação. WhatsApp
respeita seu limite de edição; legendas Telegram longas migram para texto.

Finalização usa POST /activations/{id}/finish, com resposta 204 esperada. A opção
é numérica no WhatsApp e botão no Telegram; exige SMS e confirmação do cliente.
Ao expirar, consulta o fornecedor: com SMS finaliza se ainda ativa; sem SMS,
solicita cancelamento quando possível e aguarda prova de reembolso. Falha de rede
não confirma finalização nem autoriza crédito. Histórico 6 resolve finalização
pendente; uma listagem ativa autenticada permite nova tentativa da finalização
pendente que falhou. Nunca se repete compra incerta.

A fila de conciliação seleciona pendentes por última verificação, incluindo
cancelados não creditados antigos. Reembolso 10 e ACCESS_CANCEL têm comprovantes
persistidos; falha no crédito preserva a prova para recuperação. Transação de
carteira e ledger impedem crédito duplicado. Pedido com SMS exige conferência,
sem crédito automático. Encerrar ativação com sucesso não devolve valor.

Débito de saldo e estado pago são gravados em uma transação SQLite própria,
com ledger único. Reinício antes da compra recupera apenas pedidos ainda pagos,
nunca purchasing/uncertain. Clientes não recebem cobrança dupla na recuperação.

Webhook opcional POST /webhooks/herosms/:token usa HERO_SMS_WEBHOOK_SECRET
(min. 32 caracteres) e consulta a API autenticada antes de aceitar SMS. Valida país,
serviço e vínculo da ativação. Sem segredo fica desabilitado. O cadastro da URL no
provedor depende de recurso da conta Hero; não há endpoint de configuração na
especificação enviada. Polling continua como recuperação independente do webhook.

Testes: 127 casos com banco isolado e fornecedores/canais simulados. Health 200
com versão 10.1.7 e páginas administrativas verificadas; migração de schema antigo
confirmada, preservando pedido #15 test_closed/refund none. Node local 24.22.1;
o projeto mantém declaração de Node 20.x. Sem compras/pagamentos reais ou deploy.

## Ícone do WhatsApp na HOME — 10.1.8

O botão WhatsApp existente usa TG_ICON_WHATSAPP_SMS. A lista de ícones animados
exibe WHATSAPP SMS, com captura do Custom Emoji e persistência pela configuração
visual existente. TG_ICON_WHATSAPP continua exclusivo de Vincular WhatsApp.
Sem ícone configurado, o botão mantém o emoji comum. Não cria outro botão nem
altera compras, saldo ou anúncios. Compra direta Hero SMS em anúncios segue pendente.
