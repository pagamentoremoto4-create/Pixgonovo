# v10.1.21 — Links curtos de compra e identificação do eSIM

Os avisos de compras do grupo e as campanhas com destino configurado usam códigos estáveis no WhatsApp:

- Comprar S123: serviço do catálogo (próprio ou API), incluindo identificação do provedor para abrir o fluxo correto.
- Comprar P123: oferta Premium.
- Comprar E45: plano eSIM.
- Comprar SMS: escolha de país dos números WhatsApp SMS.
- Assinar ConsultaVIP: planos de assinatura, preservado.

Exemplo de aviso: https://wa.me/SEU_NUMERO?text=Comprar%20S123

O nome comercial continua no aviso. No Telegram, permanece o botão Comprar também com seu destino habitual. Abrir o link não cobra, compra ou entrega: o cliente continua o fluxo existente com sua precificação e regras de pagamento. Nenhum saldo, assinatura ou preço foi migrado.

## Correção do eSIM

O link antigo procurava primeiro um registro ativo do catálogo e exigia que seu ID fosse idêntico ao ID selecionado pela lista de estoque. Entretanto, a lista de venda usa o estoque disponível como fonte de verdade, inclusive para cadastros inativos com estoque, e escolhe um registro canônico quando há planos duplicados. Essa divergência podia informar indisponibilidade indevidamente.

Os links antigos por nome passam a usar a lista real de estoque. Os códigos E usam o nome do plano correspondente ao ID e encontram o plano canônico disponível, preservando o preço específico do cliente. A consulta de DDD passa a comparar nomes sem diferenças de espaços nas pontas e maiúsculas/minúsculas, como a lista de estoque já faz. Unidades vendidas ou reservadas não são tratadas como disponíveis. Se o estoque acabar, o bot continua informando indisponibilidade.

Links antigos de serviços, eSIM e números SMS continuam reconhecidos. Mensagens antigas já publicadas não são reescritas. Não foi alterada a deduplicação dos avisos de compras, nem o envio de consultas DHRU.

## Validação e instalação

Testes dos códigos, roteamento real extraído do bot, preços por cliente, banco SQLite temporário com planos duplicados/inativos e estoque vendido/reservado, compatibilidade dos links antigos e regressões existentes. Teste local do painel com banco temporário, sem compras ou mensagens reais.

Instalar substituindo os arquivos da aplicação e reiniciando o serviço; preservar banco, credenciais, sessões e arquivos do estoque. A instalação e a disponibilidade real no servidor não foram verificadas nesta entrega.
