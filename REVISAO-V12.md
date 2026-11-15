# CENTRALUNLOCKER V12 — revisão e correções

Base: CENTRALUNLOCKER-V11-TELA-INFORMATIVA-WHATSAPP.zip.

Esta entrega contém as correções de código, testes automatizados e este relatório. Não foi implantada em produção e não executou cobranças, compras de números ou mensagens reais.

## Falhas identificadas e tratadas

| Área | Falha da V11 | Tratamento na V12 |
|---|---|---|
| Saldo Hero SMS | Débito e mudança do pedido eram gravações separadas | Transação SQLite em conexão exclusiva: débito e confirmação juntos |
| Compra Hero SMS | Erro depois de obter o número podia transformar compra concluída em incerta | Ativação validada e persistida; mensagem em fila; erro posterior não desfaz o estado recebido |
| Compra incerta | Risco de repetir chamada externa após timeout | Reserva condicional; estado incerto bloqueia repetição automática |
| Pagamentos | Crédito podia perder atualização concorrente ou ficar separado da confirmação | Incremento SQL e confirmação/lançamento na mesma transação |
| Mercado Pago | Consulta aprovava apenas pelo status | Validação de identificação, moeda BRL, método PIX e valor em centavos |
| MisticPay | Consulta aprovava apenas pelo status | Mesma transação, depósito PIX e valor bruto `value` compatível com o pedido |
| PixGo legado | Confirmação não conferia identidade/valor da resposta | Resposta aprovada sem `data.payment_id` e `data.amount` compatíveis fica sem liberação automática |
| Reinício | Retomada periódica estava concentrada na DePix | Recuperação de cobranças pendentes dos gateways e entregas confirmadas |
| SMS | Consulta concorrente ao cancelamento podia enfileirar código obsoleto | Atualização condicional por estado e ativação; gravação do código e fila na mesma transação |
| SMS histórico | Expressão regular procurava barras literais, sem reconhecer OTP comum | Extração corrigida e inserção apenas se o código foi salvo no pedido correspondente |
| Avisos SMS | `enviarTexto` retorna false; o código tratava isso como entrega | Confirmação somente com sucesso explícito; reenvio enquanto pendente |
| Avisos de status | Estado era confirmado antes de enviar e falhas eram esquecidas | Último estado confirmado só avança após envio; primeiro evento terminal também gera aviso |
| Troca/cancelamento | Espera partia da criação, inclusive antes de pagar | Timestamp de recebimento do número e reinício do prazo após troca |
| Troca | Resposta sem formato válido e quebras de linha literais | Validação de número/ativação e texto corrigido; timeout bloqueia nova troca |
| Estorno Hero SMS | Transação na conexão compartilhada podia misturar callbacks | Conexão exclusiva, leitura atual e crédito único |
| Estorno falho | Confirmação do fornecedor não tinha marcador próprio recuperável | Marcador persistido permite retomar o crédito sem cancelar novamente |
| Cancelamento comum | Duas requisições podiam estornar duas vezes | Estado, saldo e lançamento de auditoria juntos em transação |
| Finalização | Podia finalizar/cobrar pedido já cancelado | Conferência do estado atual e cobrança transacional |
| Dhru | Timeout podia cancelar localmente e devolver dinheiro mesmo com compra externa existente | Envio incerto fica em conciliação e mantém os fundos; cancelamento local exige confirmação externa |
| Dhru confirmado | Créditos de rejeição eram separados da marca de estorno | Crédito e estado juntos em transação |
| eSIM em lote | Debita antes de reservar; dois compradores podiam disputar o mesmo estoque | Reserva integral, débito e pedidos juntos; falha reverte todo o lote |
| eSIM entrega | Falha no envio podia ser considerada entrega; sem fila persistente | Fila por unidade vendida, reenvio do mesmo QR e validação do retorno do canal |
| eSIM PIX | Reprocessamento podia consumir outra unidade | Vínculo único por pagamento; recuperação reutiliza a entrega original |
| Serviço pago | IMEI duplicado era descartado depois do débito integral | Só entradas aceitas são debitadas; IMEIs repetidos não geram cobrança extra |
| Serviço pago | Reprocessamento podia recriar pedidos | Recibo por pagamento, pedidos e débito atômicos; usa preço registrado no contexto da compra |
| Assinatura | Falha intermediária/repetição podia somar dias ou gerar chave novamente | Licença, recibo de pagamento e avisos na mesma transação; aviso privado persistido com os botões originais |
| Migração | Inicializações simultâneas podiam disputar criação de colunas | Inicialização compartilhada por Promise, com nova tentativa após falha |

## Preservado

Menus, numeração, botões e navegação existentes. A suíte compara hashes de 14 funções de menus da V11, incluindo WhatsApp, Telegram, Hero SMS e eSIM. Isso não substitui validação visual nos aplicativos.

WhatsApp Brasil, DDD aleatório, preço padrão de R$ 25 e preços personalizados permanecem. A compra Hero SMS ocorre somente após pagamento ou débito confirmado. A regra preexistente de DePix `delayed` continua condicionada à elegibilidade já existente; não foi redefinida como uma nova regra comercial.

O cancelamento Hero SMS continua devolvendo à carteira interna, inclusive em compras PIX, como na V11. Crédito na carteira não é uma devolução bancária PIX. Não foi implementado saque ou estorno bancário automático.

GGSOMA, Premium e WhatsApp aquecidos mantêm seus mecanismos próprios; não foram substituídos pelo checkout experimental V280. Os módulos de checkout V277/V280/V281 existem no pacote, mas o fluxo ativo Hero SMS permanece em index.js. Os testes antigos desses módulos são testes isolados e não comprovam a integração de produção.

## Testes e seus limites

Executar na pasta do projeto:

```sh
npm test
npm run check
```

A suíte usa SQLite real, bancos temporários e respostas simuladas dos fornecedores/canais. Quando sqlite3 não está instalado, usa Python 3 como ponte para SQLite. Nenhum teste usa as credenciais de produção. Foram verificados todos os arquivos JavaScript com `node --check`.

O ambiente desta revisão usa Node 24.22.1. O projeto mantém Node 20.x no package.json. A suíte não representa um boot completo com todas as dependências, sessões WhatsApp e banco de produção. Os scripts antigos test:ggsoma e test:premium já apontavam para arquivos ausentes na V11; o comando válido para esta entrega é npm test.

## Pontos que ainda exigem homologação externa

1. Compras e trocas com resultado incerto permanecem para conferência. A V12 não consegue concluir sozinha se um fornecedor efetivou uma chamada cujo retorno se perdeu; repetir a compra seria arriscado.
2. As rotas REST de troca/histórico e os códigos numéricos de status Hero SMS foram herdados da V11 e não foram exercitados numa conta real. A página oficial de documentação não expôs o esquema ao leitor nesta revisão. Conferir esses contratos antes da operação em produção.
3. PixGo legado exige identidade e valor no formato indicado acima. Se a conta fornecer outro formato, homologar o adaptador; não liberar apenas pelo texto “completed”.
4. Estornos, reservas e pagamentos anteriores à V12 não são recalculados retroativamente. Histórico inconsistente deve ser conciliado com o banco e fornecedores.
5. Filas oferecem reenvio persistente. Se o canal aceitar a mensagem e o processo cair antes de registrar a confirmação, a mensagem pode ser reenviada; não há garantia de entrega exatamente uma vez no WhatsApp/Telegram. A proteção financeira não depende dessa confirmação.
6. Os workers usam travas em memória para envio. Operar uma instância do bot por banco/sessão; múltiplas instâncias podem duplicar mensagens. As operações financeiras corrigidas usam exclusão no SQLite.
7. Revisão de código não é garantia de ausência de toda falha possível. Os testes cobrem os casos descritos; compras reais, disponibilidade e mudanças de contrato de API não foram validadas.

## Instalação

1. Faça backup do diretório persistente, banco e sessões da instalação atual.
2. Substitua o código pelo conteúdo de Pixgonovo-main, mantendo as variáveis e o diretório de dados existente. Não apague o banco para instalar a V12.
3. Rode os comandos acima. As novas tabelas e coluna são adicionadas automaticamente; não há exclusão ou migração destrutiva de dados.
4. Faça o primeiro deploy com uma instância. Confira configuração dos gateways, recuperação das sessões e pedidos em conciliação antes de liberar vendas.
5. Não use arquivos .bak ou versões históricas como index.js. Eles foram preservados do pacote original e não são o ponto de entrada.

## Referências consultadas

- MisticPay: https://docs.misticpay.com/ — identificação e valor da consulta de transação.
- Mercado Pago: https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro/get-payment/get — dados do pagamento.
- Hero SMS: https://hero-sms.com/pt/api — página oficial acessível, esquema não exposto no leitor.

O arquivo RESULTADO-TESTES-V12.txt contém a execução final da suíte.
