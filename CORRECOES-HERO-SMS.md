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
