# CentralUnlocker — Site do cliente integrado

Esta versão adiciona a área navegável do cliente sem separar os dados dos bots.

## Acesso

- Usuário e senha já cadastrados na conta do cliente.
- Código de 6 dígitos pelo mesmo bot do WhatsApp.
- Código de 6 dígitos pelo Telegram vinculado.
- O código só é enviado para cliente com conta ativa e `bot_ativo=1`.
- Os códigos duram 5 minutos, possuem limite de tentativas e são salvos somente como hash.

## Funções disponíveis

- Dashboard com saldo e resumo dos pedidos.
- Solicitação dos serviços ativos do catálogo.
- Preços e modalidade pré/pós-pago configurados por cliente.
- Compra de eSIM usando o estoque atual.
- Histórico com status, busca e período.
- Cópia e exportação de IMEIs em TXT ou CSV.
- Download dos dados/resultados de cada pedido.
- Cancelamento apenas de pedidos pendentes autorizados pelo administrador, com estorno quando aplicável.
- Conta, saldo e orientação de suporte pela opção 8 do bot.

## Implantação

Use o mesmo procedimento já utilizado para executar o sistema:

1. Configure o arquivo `.env` e o diretório persistente `DATA_DIR`.
2. Instale as dependências com `npm install`.
3. Inicie com `npm start`.
4. Acesse `/cliente` no domínio do sistema, por exemplo `https://painel.centralunlocker.store/cliente`.

As tabelas novas são criadas automaticamente na primeira inicialização. O banco, as contas, o saldo, os serviços, os pedidos e as sessões existentes dos bots permanecem compartilhados.
