# V66 — Perfil VIP e Normal no WhatsApp

## Perfis

- **Normal:** mantém a resposta atual de “Opção inválida” quando envia uma mensagem fora do menu/fluxo.
- **VIP:** ignora silenciosamente mensagens fora de um fluxo ativo.

## Regras preservadas

- Cliente com bot desativado continua sem receber nenhuma resposta.
- O comando `menu` continua abrindo o menu para Normal e VIP.
- Durante fluxos ativos (serviço, eSIM, pagamento, CPF/CNPJ etc.), as validações continuam funcionando normalmente.
- Clientes existentes ficam como **Normal** até serem alterados manualmente.

## Como configurar

Painel administrativo → Clientes → Editar → Perfil do cliente → Normal ou VIP → Salvar cadastro.
