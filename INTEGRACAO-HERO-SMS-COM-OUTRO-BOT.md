# CENTRALUNLOCKER 10.1.10 + Telegramesim V22.0

A integração usa a URL e chave já configuradas para compartilhar eSIM. O Central
é o único sistema com a credencial Hero. O consumidor tem seu próprio pagamento,
preços e carteira. O estoque eSIM existente continua com o mesmo contrato.

## Instalar

1. Atualize o projeto Node com CENTRALUNLOCKER 10.1.9 e preserve seu DATA_DIR/banco,
   sessões e variáveis. Use npm ci / npm start como antes.
2. Abra /admin/herosms/compartilhado e habilite vendas pelos bots conectados.
   A conexão geral em Estoque eSIM compartilhado deve estar habilitada. Os países
   são os ativos com estoque em Hero SMS > Países.
3. Atualize o projeto Python com Telegramesim V22.0. Preserve O BANCO DELE e as
   credenciais/gateways dele. Use pip install -r requirements.txt / python bot.py.
4. No painel Python, abra /admin/herosms, teste, sincronize e marque Exibir serviço.
   Não precisa cadastrar outra chave: aproveita Estoque compartilhado já conectado.
5. Abra /start no outro Telegram. País novo custa R$ 25. Edite o preço em Produtos;
   sincronizar preserva preço e a decisão local de desativar um produto.

Use bancos e discos independentes. Não copie database.db de um projeto para o outro.
Ambos os ZIPs são completos, mas pertencem a serviços diferentes. Nenhum inclui
banco, senha ou token privado. A instalação nos seus servidores não foi executada.

## Contrato HTTP v1

Cabeçalho: x-shared-esim-key. URL base: /api/shared-herosms.

- GET /health e GET /catalog: disponibilidade e países habilitados com estoque.
- POST /orders: source, customer_id, external_order_id, country, sale_price_brl.
- GET /orders/:externalId: source e customer_id na query.
- POST /orders/:externalId/actions: identidade, action (replace/cancel/finish) e
  request_id. Repetir o mesmo request_id não repete a operação.
- POST /orders/:externalId/refund-ack: identidade e reference do comprovante.

Compra: identidade e valor ficam congelados. Nunca use um ID novo para recuperar
uma compra de resultado incerto. Um ID rejeitado definitivamente por estoque não
pode comprar mais tarde. O consumidor conserva o mesmo ID após reinício.

Consulta: order contém phone, expires_at, status, messages em sequência, actions,
refund e sale_price_brl. actions é informativo: os handlers do servidor verificam
novamente SMS, estado e espera antes de executar. Expirar o relógio do consumidor
não autoriza crédito nem declara encerramento.

Devolução: apenas refund.state confirmed/acknowledged, valor correspondente à venda
local e referência HERO-SHARED-REFUND-<central_order_id> autorizam crédito local.
Mensagens action_message são informativas e não substituem o comprovante financeiro.
O consumidor grava ledger único e crédito juntos; só então envia ACK. ACK não
movimenta dinheiro no Central. Cancelamento sem prova de reembolso fica pendente.
Pix também volta à carteira, sem estorno bancário automático.

O cliente externo usa saldo/Pix do outro bot. O custo do número é consumido do saldo
Hero do Central, como numa compra nativa; o gateway do Central não cobra esse cliente.
A carteira das revendas do Central não participa dessas vendas externas.

## Recuperação e apresentação

O Central acompanha Hero e expiração. O Python consulta os pedidos a cada ciclo
nominal de 20 segundos, edita o cartão, guarda snapshot e reapresenta pelos pedidos.
Não promete entrega instantânea. Códigos são numerados e paginados, sem perder os
anteriores. Após SMS, bloqueia troca/cancelamento e oferece finalizar; finalização
confirmada oferece comprar outro. O cartão entregue não exibe saldo/pagamento.

Recusa de estoque antes da compra devolve o pagamento local uma vez. Falha de rede
não prova recusa: se já foi enviado e o Central não localizar, exige conferência,
sem refazer compra automaticamente. Troca/cancelamento/finalização usam seus IDs
próprios, sem recriar compra. Preservar ambos os bancos é necessário para recuperação.

No Python, pagamentos/depósitos pendentes são confirmados por consulta autenticada
ao gateway com ID e valor correspondentes; webhook não é prova isolada. Os Pix
Hero pendentes também são conferidos pelo worker. Dados incompletos/divergentes
mantêm o pagamento pendente, sem compra. Preço não é redefinido pela sincronização.

## Validação

135 testes Node e 19 testes Python aprovados com SQLite e dependências isoladas.
Inclui teste HTTP entre os dois projetos usando handlers reais e Hero simulada;
carteira nativa do Central permaneceu intacta e devoluções locais ocorreram uma vez.
Teste de startup e telas administrativas com HTTP 200 em banco de teste.
Nenhuma compra/cobrança/estorno real, envio Telegram real nem deploy foi realizado.

Para repetir: npm run test:hero no Node e python -m unittest discover -s tests -v
no Python. Para incluir o teste HTTP, configure HERO_CENTRAL_PROJECT com o caminho
do projeto Node já instalado com suas dependências. Sem ele, esse caso é ignorado.

A configuração do ícone WhatsApp SMS da versão 10.1.8 está incluída.
Na versão 10.1.10, os anúncios do painel central oferecem WhatsApp SMS — Escolher país.
O cliente abre os países e confirma o pagamento; clicar no anúncio não compra.
