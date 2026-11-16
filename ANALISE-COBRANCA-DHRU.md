> Atualização 10.1.13: a confirmação DHRU no Telegram descrita abaixo foi corrigida e testada. Este texto preserva a análise anterior. Consulte PRECOS-E-COBRANCA.md para o funcionamento atual.

# Análise da cobrança DHRU — 16/11/2026

Esta análise descreve o código local do primeiro bot. Não houve alteração na cobrança, no estorno ou nos cadastros financeiros, nem acesso ao banco de produção.

## Regra atual

`modalidadeServicoRevenda` consulta a modalidade específica do cliente para o serviço em `modalidades_servico_revenda`. Se não houver configuração específica, utiliza `revendas.tipo_revenda`; o padrão é pré-pago. O preço também respeita a configuração individual do cliente em `precos_revenda` antes do preço padrão do serviço.

- **Pré-pago:** o fluxo de criação valida saldo, grava o pedido como cobrado e desconta o valor da carteira. Para DHRU com campos coletados, isso acontece depois da confirmação explícita, não durante a digitação dos dados.
- **Pós-pago:** o fluxo cria o pedido sem cobrança imediata. `finalizarPedido` realiza a cobrança quando o serviço termina, usando o valor registrado no pedido e evitando um segundo débito por uma nova finalização.
- **Rejeição/cancelamento:** o retorno DHRU confere se houve cobrança antes de devolver o valor, marca o estorno e cancela o pedido.

No painel, a modalidade por serviço pode ser conferida em **Clientes → cliente → Preços e cobrança**, no endereço `/admin/revenda/ID/precos`. A configuração específica do serviço tem prioridade sobre o tipo geral do cadastro.

## Problema identificado no caminho de campos do Telegram

Ao terminar a coleta `dhru_campo`, `processarMensagemTelegram` chama `processarEntradaDhruColetadaWhatsApp` sem a confirmação aprovada. A função prepara a sessão `confirmacao_servico` e pede a opção 1. O tratamento dessa etapa existe no processamento WhatsApp, mas não no processamento Telegram.

Isso pode deixar esse caminho do Telegram sem criar o pedido e, consequentemente, sem cobrar ou enviar à API. Não explica sozinho um pedido já confirmado na API e sem débito: nesse caso, devem ser conferidos a modalidade efetiva, o pedido, o cadastro vinculado e a versão implantada.

## Verificação

O caminho compartilhado foi executado isoladamente com dados simulados: antes de confirmar não cria nem cobra; após confirmar desconta no pré-pago e não desconta imediatamente no pós-pago. Nenhuma chamada real à DHRU foi realizada.

A confirmação Telegram precisa de uma correção própria, com verificação de cobrança única e devolução, se for autorizada posteriormente. Esta entrega altera somente os avisos públicos e preserva a regra financeira existente.
