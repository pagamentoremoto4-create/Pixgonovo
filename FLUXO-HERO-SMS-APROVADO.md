# Hero SMS — fluxo combinado para revisão

Registrado em 15/11/2026. Status: implementado na versão 10.1.7 e validado localmente (127 testes); instalação na hospedagem pendente.
Este documento registra decisões do usuário. A configuração do webhook no provedor e a instalação na hospedagem são passos externos pendentes.

## Canais e menu

Mesmo fluxo funcional no WhatsApp e Telegram. WhatsApp usa opções numéricas; Telegram usa botões.
Menu: saldo atual; 1 Comprar número; 2 Meus números e códigos; 0 Voltar ao menu principal.
Sem Preciso de ajuda e sem consulta manual de código.

## Compra

Mostrar países habilitados no painel e com estoque. Preservar preço individual existente, R$ 25 como padrão.
Confirmação mostra aplicativo, país, DDD aleatório para Brasil, preço e saldo atual.
Opções: 1 Pagar com saldo; 2 Pagar com Pix; 0 Voltar.
Pix usa gateway padrão do painel. Comprar na Hero somente após pagamento confirmado.
Não repetir automaticamente compras de resultado incerto.

## Número entregue

Mostrar marca, pedido, país, número, tempo restante, aguardando SMS e aviso de atualização automática.
NÃO mostrar saldo, valor pago nem forma de pagamento no cartão do número.
Usar expiração real retornada pela Hero; não fixar 20 minutos universalmente.
Atualizar tempo periodicamente e eventos no mesmo cartão, sem enviar mensagens repetidas.
Após espera mínima e quando permitido, antes de qualquer SMS: 1 Trocar número; 2 Cancelar ativação; 0 Voltar.
Troca confirmada atualiza número, ID da ativação e expiração retornados pela Hero, sem nova cobrança ao cliente.
Troca incerta fica em acompanhamento antes de outra tentativa.

## SMS

Guardar todos os SMS recebidos, não apenas o primeiro código.
Exibir em ordem de chegada: Código 1, Código 2, Código 3, com horários.
Não duplicar o mesmo evento recebido novamente pela API/webhook.
SMS sem código identificado também fica registrado e tem texto exibido.
A partir do primeiro SMS, bloquear troca e cancelamento no servidor, inclusive opções antigas.
Após SMS, ações: 1 Finalizar ativação; 0 Voltar. Não usar letra F.
Numeração dos códigos é informativa, distinta das opções de ação.

## Meus números

Selecionar pedido abre cartão visível com número atual, prazo atualizado, SMS salvos e ações elegíveis.
Esse cartão passa a receber as próximas atualizações.
WhatsApp: edição limitada pelo canal; se não puder editar, criar cartão substituto e continuar nele.
Não prometer edição da primeira mensagem durante toda a ativação.

## Finalização

Cliente escolhe 1 Finalizar ativação e confirma; Telegram usa botão equivalente.
Usar POST /activations/{activationId}/finish. Confirmar resultado antes de mostrar sucesso.
Sem devolução ao finalizar ativação com sucesso. Preservar códigos no histórico.
No prazo real de expiração:
- Com SMS: conferir estado na Hero e solicitar finalização se ainda ativa e operação aceita.
- Sem SMS: acompanhar cancelamento e reembolso antes de devolver crédito.
- Falha da API: mostrar Encerramento em verificação e conciliar depois.
Não declarar finalização ou reembolso apenas porque o relógio zerou.
Após finalização confirmada, cartão mostra códigos e opções:
1 Comprar outro número; 0 Voltar.
Comprar outro número abre a seleção de países, tanto após finalização manual quanto automática.

## Cancelamento e devolução

Antes de SMS, confirmar cancelamento com cliente e solicitar à Hero.
Também acompanhar cancelamentos feitos diretamente no painel da Hero.
Se SMS chegar antes de concluir, atualizar e aplicar bloqueio de cancelamento.
Separar estado cancelado de reembolso confirmado.
Até confirmação: Ativação cancelada / Devolução do crédito em verificação.
Após crédito registrado: Devolução concluída; valor devolvido; saldo atual consultado na conta.
Devolver valor integral da venda à carteira uma única vez, com transação, auditoria e proteção contra duplicidade.
Compras por Pix também devolvem à carteira; não prometer estorno bancário automático.
Histórico documentado: 6 concluída, 8 cancelada, 10 reembolso.
Manter fila específica para cancelados com devolução pendente, sem depender apenas de janela geral de pedidos recentes.
Pedido #15 permanece test_closed, sem crédito nem alteração financeira.

## Integração e validação

Persistir expiração, custo/moeda reais, histórico SMS e confirmações de encerramento/reembolso.
Integrar webhook sms-incoming depois de confirmar configuração e autenticação; manter consultas de recuperação.
A chegada de webhook repetido não pode gerar duplicidade nem permitir SMS de outro pedido.
Confirmar regras e elegibilidade no fornecedor antes de ações; tratar falhas e resultados incertos sem compras repetidas.
Separar pagamento, ativação e devolução no painel, com diagnóstico das pendências.
Este registro não executa compras, cancelamentos, finalizações, devoluções nem alterações de saldo.
