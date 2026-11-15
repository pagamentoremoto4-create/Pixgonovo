# Correções Hero SMS — revisão da documentação fornecida

Base: arquivo OpenAPI `api-pt (1).json` enviado nesta conversa.

## Corrigido

- Troca de número: a resposta REST documentada é `{ data: [ActiveActivationSchema] }`.
  O código agora seleciona a ativação pelo ID do pedido e valida o telefone.
  Respostas vazias, ambíguas ou de outra ativação ficam em conferência, sem repetir a troca.
- Mensagem de troca: remove sequências literais `\\n` e corrige a retirada do `+` do telefone.
- Sincronização: lê `otpLast.smsCode`, mantendo zeros iniciais, e alimenta a fila de entrega.
- Histórico: corrige a expressão que não reconhecia códigos numéricos em `moreCodes`.
  Um código recuperado não reabre uma ativação já finalizada.
- Paginação: respeita `meta.hasMore`, com fallback para `meta.total` e tamanho da página.
- Atualização de telefone não reabre pedidos cancelados, finalizados ou com cancelamento pendente.
- Evita ciclos simultâneos de sincronização e consulta de SMS dentro do mesmo processo.
- Notificações de mudança de status são tentadas novamente depois de falha no envio.
- Recupera SMS salvo antes de uma interrupção entre a gravação do código e a criação da notificação.

Também foram mantidas as correções anteriores de inicialização em banco vazio
(criação antecipada de configs e tabelas de operadoras eSIM) e o lockfile atualizado.

## Verificação

`npm run test:hero`: 15 testes aprovados, incluindo cenários executados com as funções
reais do index.js, SQLite em memória e respostas HTTP simuladas.
`node --check index.js`: aprovado.
Inicialização com banco vazio: concluída, servidor e painel HTTP 200.

## Limites antes de produção

Não foram realizadas compras, cancelamentos, trocas ou cobranças reais.
A autenticação REST `Authorization: ApiKey ...` e os formatos usados acima foram
conferidos no documento. Nenhuma chave privada é incluída neste pacote.

O schema `ActivationStatusTypes` enumera 1,2,3,4,6,7,8,10, mas não descreve o significado
individual desses valores. A associação legada do histórico 10=reembolso, 8=cancelamento
e 6=finalização não foi alterada nem comprovada por esse documento. É necessário
confirmar esse mapeamento com o fornecedor antes de confiar no estorno automático
por sincronização de histórico. O status 8 enviado a `setStatus` e a confirmação
`ACCESS_CANCEL` são documentados separadamente; não se deve presumir que o enum
recebido no histórico tenha necessariamente a mesma semântica do parâmetro enviado.

Os arquivos hero-sms-v277.js e hero-sms-v280-checkout.js são módulos isolados que não
são usados pelo servidor index.js. Esta revisão corrige o fluxo efetivamente ativo.

Para repetir os testes, instale as dependências e execute `npm run test:hero`.
Para iniciar, configure seu .env a partir do exemplo e execute `npm start`.
O projeto declara Node 20.x; os testes locais foram executados no Node 24.22.1.

## Atualização: mensagem editável e auditoria de cancelamento

Implementado no servidor ativo:

- Referência persistente da mensagem por pedido, incluindo canal, ID da mensagem,
  sessão WhatsApp original e último conteúdo confirmado.
- O SMS atualiza a mensagem do número. O card não oferece consulta manual de código
  nem atualização manual, e remove troca/cancelamento quando houver código.
- Cada pedido tem sua própria fila de atualização no processo; conteúdo inalterado
  não gera envio nem edição repetida. A referência continua válida após reinício.
- Telegram usa editMessageText e atualiza os botões. Mensagem apagada/não editável
  permite substituição. Erro transitório mantém o pedido para nova tentativa.
- WhatsApp Baileys usa o mesmo socket/conta que enviou a mensagem e sua chave original.
  Após 14 minutos, aplica fallback conservador, enviando a atualização em uma nova
  mensagem. A mensagem substituta passa a ser a referência atual. Evolution, mantido
  como compatibilidade, usa substituição porque seu adaptador atual não implementa edição.
- A consulta de SMS continua a cada 20 segundos: atualização automática por polling,
  sem alegação de webhook ou de entrega instantânea. Conteúdo inalterado não é reenviado.
- Falha de envio não marca a notificação como entregue nem transforma compra de número
  já confirmada em uma compra de resultado incerto.
- Sessões antigas de menu são atualizadas antes de interpretar a nova numeração das ações.

Cancelamento pelo bot:

1. Confere a titularidade do pedido, ausência de código e estado elegível.
2. A espera local de 120 segundos passa a contar da entrega do número, e reinicia
   após uma troca. Pedidos legados sem esse campo usam a data de criação.
   O exemplo EARLY_CANCEL_DENIED no OpenAPI contém minActivationTime=120; o fornecedor
   continua sendo a autoridade para aceitar ou recusar a operação.
3. Bloqueia a ativação antes da chamada setStatus(status=8).
4. Só ACCESS_CANCEL autoriza o crédito. Aceita a string simples ou codificada em JSON.
5. Recusa HTTP explícita libera o estado local sem crédito; timeout, 5xx e resposta
   desconhecida ficam em conferência, sem nova chamada automática de cancelamento.
6. Salva comprovante da confirmação antes de creditar a carteira.
7. Crédito usa conexão SQLite dedicada, transação e ledger UNIQUE por pedido, evitando
   mistura com outras consultas do servidor e crédito repetido em chamadas concorrentes.
8. Se o crédito falhar depois da confirmação, conserva o comprovante e tenta recuperar
   o crédito, sem cancelar novamente no fornecedor.
9. O valor integral da venda é creditado na carteira em compras por SALDO ou PIX.
   Não há estorno bancário do Pix implementado nesse fluxo.
10. SMS que chega durante cancelamento incerto continua sendo acompanhado e entregue;
    cancelamento já confirmado por comprovante não é reaberto pelo polling de SMS.

Verificação desta atualização: 41 testes aprovados com SQLite e canais/provedor
simulados; análise sintática aprovada. Não houve operação real com contas conectadas.

Pendência mantida e identificada na auditoria: o caminho legado de sincronização do
histórico continua interpretando status 10 como reembolso, independentemente de um
ACCESS_CANCEL local. O ledger impede crédito repetido, mas não comprova o significado
desse status. O documento fornecido não define os rótulos dos valores do enum do
histórico. Essa interpretação precisa de homologação com a Hero SMS antes de produção.
O status 8 do histórico apenas marca cancelamento, sem crédito por si só.


## Correção de compra com saldo e diagnóstico — pacote V10.1.1

- O WhatsApp reutiliza o cadastro identificado/autorizado no início do atendimento.
  A confirmação da compra não faz nova busca simplificada por telefone/JID, que
  podia retornar nenhum cliente ou selecionar um cadastro duplicado.
- Saldo insuficiente mostra preço e saldo real atual, sem comprar número.
- Pedido em verificação mostra o ID que está impedindo outra compra.
- Falhas inesperadas mostram referência HERO-... e geram log HERO_CHECKOUT com
  diagnóstico limitado; URLs e parâmetros de credenciais são omitidos.
- O Telegram também usa mensagens específicas de checkout.
- Datas from/to do histórico usam YYYY-MM-DDTHH:MM:SSZ, sem milissegundos;
  to passa a representar o momento atual, sem um minuto no futuro.
- Erros HTTP 422 do cliente REST priorizam os campos rejeitados na mensagem do log,
  para que o motivo completo do erro from possa ser investigado sem truncamento precoce.

47 testes aprovados, incluindo checkout com saldo real em SQLite, saldo insuficiente,
cliente com telefone formatado, pedido em verificação e formato de datas.

Limite da investigação: os logs enviados mostram erro 422 no campo from, mas cortam
seu motivo completo. O erro da tentativa de compra não foi registrado pela versão
anterior. As correções acima precisam ser testadas na hospedagem do usuário; não
comprovam retrospectivamente qual condição causou a mensagem genérica original.
Nenhum saldo, pedido real ou credencial do usuário foi acessado ou alterado aqui.


## Revisão Pix e diagnóstico de pedidos pendentes — pacote V10.1.2

Regra solicitada: o checkout Hero SMS usa exclusivamente o gateway PADRÃO ATIVO
no painel, no WhatsApp e Telegram. A preferência individual da revenda não interfere
nesse checkout. Se o padrão estiver inativo, não escolhe outro gateway nem cria Pix.
Cobranças já geradas continuam consultadas no gateway registrado em cada cobrança.

Correções:
- DePix Pay recebe CPF/CNPJ salvo no cadastro. Sem documento válido, solicita o
  cadastro antes de criar pedido/cobrança, preserva a oferta e retoma o checkout Hero.
  Documento inválido, cancelamento e expiração da coleta não geram cobrança.
- QR Code no WhatsApp usa a sessão de atendimento e o destino LID resolvido,
  inclusive quando a conexão principal não está disponível.
- Falha incerta ao criar Pix preserva payment_reconciliation e bloqueia uma nova
  geração automática; recusa HTTP explícita fica registrada como payment_failed.
- Compra do número exige consulta autenticada com status elegível, ID e valor
  correspondentes, vínculo do cliente e contexto correto do pedido.
- Mercado Pago e MisticPay passam a fornecer ID e valor no retorno normalizado de
  consultarStatus. Se esses dados estiverem ausentes/divergentes, não libera compra.
  Os campos MisticPay utilizados são transaction.transactionId e amount ou
  transactionAmount; o formato real precisa ser homologado na conta do usuário.
- Comprovante local de verificação em hero_sms_pix_receipts e recuperação periódica
  de cobranças Hero SMS após reinício, para os gateways configurados.
- Pix só recebe estado delivered após a ativação/número estar persistida. Compra
  de resultado incerto fica delivery_pending, sem nova compra automática.
- Confirmações repetidas não duplicam a compra e não creditam/debitam a carteira.
- Preserva a regra legada DePix para delayed e mantém a consulta autenticada como
  fonte da confirmação. Notificação de webhook isolada não libera número.
- Estados pendentes agora têm textos específicos no card do cliente.
- Painel Hero SMS > Pedidos > Abrir mostra motivo registrado, estado do pedido,
  ativação, número, método de pagamento e situação do Pix. É somente leitura.
- Falhas futuras da compra geram log HERO_PURCHASE com referência ao pedido.

Sobre o pedido #15 mostrado na conversa: ele permanece protegido contra uma nova
compra. Esta atualização não altera esse registro na hospedagem do usuário. Após
atualizar, abra /admin/herosms/pedidos/15 e confira o motivo salvo e o histórico do
fornecedor antes de decidir pela recuperação ou pelo crédito. Ausência de número
local não comprova que o fornecedor deixou de executar a operação.

Verificação: 70 testes passaram com SQLite e provedor/canais simulados, incluindo
Pix com/sem documento, retomada por CPF, QR em múltiplas sessões, confirmação duplicada,
valor/ID divergentes, pedido incerto, expiração, recuperação e gateway padrão.
Não foram geradas cobranças nem executadas compras reais nesta revisão.


## Cancelamento manual no fornecedor — pacote V10.1.3

- Polling compatível passa a tratar a resposta documentada STATUS_CANCEL e marcar
  o pedido cancelado. Esse caminho é independente do endpoint REST de histórico.
- Pedidos uncertain com ID conhecido continuam sendo acompanhados; pedidos sem ID
  não são associados por suposição, telefone aproximado, valor ou horário.
- ID de ativação recebido em uma resposta incompleta de compra é preservado,
  mesmo se o número vier ausente e o resultado exigir conferência.
- Sincronização REST inclui compras incertas com ID conhecido e permite recuperar
  o telefone pelo ID exato quando a ativação ainda está ativa.
- Cancelamento/finalização/reembolso externo gera evento persistente. A atualização
  do cliente não depende de existir um card anterior. Estado já comunicado não é
  enviado novamente; falha de canal mantém o evento pendente para nova tentativa.
- Tela administrativa do pedido possui formulário para associar/conferir o ID da
  ativação de um cancelamento manual. Requer autenticação, token de formulário e
  confirmação explícita do administrador de que a ativação pertence ao pedido.
  O fornecedor precisa responder STATUS_CANCEL em consulta GET getStatus.
  ID divergente, ativação já vinculada a outro pedido, estado incompatível e
  cancelamento não confirmado são rejeitados sem mudar o saldo.
- O formulário não executa setStatus/cancelamento novamente e não credita carteira.
  Cancelamento e confirmação financeira de estorno continuam sendo eventos distintos.
  O caminho legado status 10 do histórico permanece sujeito à homologação já descrita.

Para recuperar o pedido #15 na hospedagem do usuário: após atualizar, abra
Hero SMS > Pedidos > #15 > Cancelado manualmente na Hero SMS?, informe o ID exato
obtido no fornecedor e confirme o vínculo. A fila atualiza o cliente no próximo
ciclo (até cerca de 30 segundos, sujeito à conexão do canal).
O registro real não foi acessado nem alterado durante o desenvolvimento.

Verificação: 79 testes simulados aprovados, incluindo STATUS_CANCEL, compra incerta,
ID ausente, ID associado a outro pedido, falha de notificação e reconciliação
administrativa somente após confirmação do fornecedor.
