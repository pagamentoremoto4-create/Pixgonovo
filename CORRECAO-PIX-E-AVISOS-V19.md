# Versão 10.1.19 — confirmação Pix, recusa de compra e avisos repetidos

## Confirmação visível do pagamento

Após a validação financeira existente, o WhatsApp recebe uma NOVA mensagem de texto com **Pagamento confirmado** e o valor. O sistema não depende mais de editar o cartão Pix com mídia para exibir essa confirmação.

O envio é registrado por gateway e identificador do pagamento em `whatsapp_pix_notices`. Consultas repetidas e reinício não reenviam uma confirmação já registrada. Uma transmissão interrompida/sem confirmação fica `uncertain`, sem repetição automática cega. Aceitação de envio continua sendo diferente de prova de exibição no aparelho.

A referência da mensagem de texto passa a estar disponível para a entrega. O cartão inicial continua com QR, código completo e Copiar Pix. O menu em texto e suas opções permanecem iguais.

## Hero recusou a compra com NO_NUMBERS

O caso conhecido foi um Pix de R$ 5,00 para Austrália, pedido #34. O gateway foi reconhecido como pago, mas a Hero respondeu HTTP 400 e `NO_NUMBERS`. Antes, qualquer erro de compra virava `uncertain` e bloqueava a compra seguinte.

Para NOVAS recusas, esta versão exige uma resposta estruturada HTTP 400, código e título exatos `NO_NUMBERS`, sem dados de ativação, além de um pedido local sem número, ativação ou SMS. A recusa fica auditada em `hero_sms_purchase_rejections`.

- **Pix:** o crédito exige pagamento e recibo de verificação com cliente, transação, gateway e valor correspondentes e status financeiro elegível.
- **Saldo:** a devolução exige o débito original do mesmo pedido, cliente e valor.
- **Pós-pago sem débito:** o pedido fecha sem criar crédito grátis.
- **Bot externo compartilhado:** não recebe crédito na carteira local por este mecanismo.
- **Timeout, HTTP 5xx, resposta incompleta ou ambígua:** continuam em conferência, sem recompra nem crédito automático.

O crédito ocorre em uma transação SQLite, com registro único no ledger por pedido. Dois processos concorrentes, reinício ou repetição da mesma consulta não criam outro crédito. Se houver inconsistência financeira ou conta ausente, a transação é revertida e o pedido fica pendente de recuperação/conferência.

O cliente recebe **Compra não concluída — sem números** e a devolução só é afirmada após o crédito registrado. O estado Pix local `wallet_credited` indica crédito na carteira, NÃO devolução ao banco nem estorno executado na Hero.

A oferta no país/serviço/custo recusado fica com estoque zero localmente, evitando oferecer novamente aquele snapshot. Uma nova sincronização do catálogo pelo painel poderá restaurar a oferta. Não há aumento automático de custo nem tentativa de comprar outro país.

Uma recusa já comprovada, mas com crédito ainda pendente por falha local, pode ser retomada pelo worker. O estoque do fornecedor pode mudar entre a oferta e a compra; o número mostrado no catálogo não reserva estoque.

## Pedido #34 e outros pedidos antigos

A atualização NÃO usa apenas uma mensagem de erro antiga para creditar automaticamente pedidos em verificação. Eles precisam de revisão explícita.

Depois de instalar:

1. Abra `/admin/herosms/pedidos/34`.
2. Confira no histórico do fornecedor que não há ativação correspondente e confira que não foi feito crédito manual desse valor.
3. Se o pedido possuir a recusa antiga NO_NUMBERS reconhecida, aparecerá **Compra recusada: NO_NUMBERS**.
4. Marque **Conferi que não existe ativação e que este valor não foi creditado manualmente**.
5. Clique em **Conferir Pix e resolver recusa**.

A ação consulta o gateway de novo e valida identificador, cliente, valor e contexto do pagamento. Só depois registra a prova revisada e o crédito único na carteira. Não compra número, não cancela outra ativação e não cria Pix. Se qualquer conferência falhar, o valor não é liberado à força.

Não use **Encerrar pedido de teste** para resolver uma compra real paga. O #34 do servidor não foi alterado durante o desenvolvimento.

## Cancelamentos antigos reenviados

A causa encontrada era a inclusão do saldo atual no cartão. Quando a carteira mudava, o texto de todos os cancelamentos antigos mudava; a edição vencida podia gerar várias mensagens novas.

O mensageiro agora reconhece o evento de cancelamento/devolução já comunicado, independentemente de mudanças de saldo ou nome do país. Reaproveita também os fingerprints antigos reconhecidos, evitando uma rajada de mensagens na atualização.

Uma mudança real de **devolução pendente** para **crédito confirmado** continua sendo comunicada. Abrir o pedido explicitamente em Meus números também continua mostrando seus dados atuais. O crédito financeiro de cancelamentos mantém suas próprias proteções; a correção de mensagens não executa um estorno.

## Avisos públicos de venda

Um Pix pago sem número confirmado não deve gerar **Compra realizada** no grupo. A publicação Hero agora depende dos dados de entrega; a prova de pagamento sozinha não basta. Eventos antigos sem entrega confirmada também são tratados para retirada pela fila existente. Nenhum preço individual é adicionado aos avisos públicos.

## Instalação e verificação

Preserve banco, sessões, disco persistente e configurações. Não substitua o banco por outro vazio. A atualização não muda modos de ativação do menu/Pix nem instala automaticamente no Render.

307 testes automatizados passaram: Hero 169, menu/Pix 66, comunidade 32, cobrança 19 e laboratório 21. Incluem execução real do handler com recusa/timeout simulados, créditos concorrentes, rollback, confirmação em texto sem edição do cartão, proteção do aviso após reinício, cancelamentos com saldo alterado e bloqueio de anúncio sem número. O painel e o formulário do #34 foram conferidos em banco temporário, inclusive bloqueio de POST sem token, sem alterar carteira nem chamar gateway real.

Não foram executados pagamentos, compras, créditos no banco de produção, mensagens reais ou deploy durante os testes. O recebimento no iPhone ainda deve ser conferido após instalar, especialmente nas etapas que utilizam edição de mensagem.
