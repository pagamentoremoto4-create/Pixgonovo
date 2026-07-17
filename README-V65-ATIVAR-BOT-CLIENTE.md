# V65 — Ativação individual do bot por cliente

## Alterações

- Novos clientes do WhatsApp são cadastrados automaticamente com o bot desativado.
- O primeiro contato não recebe saudação, menu ou resposta da IA.
- Uma migração única desativa a comunicação automática para todos os clientes já cadastrados.
- A lista de clientes mostra o status do bot: Ativado ou Desativado.
- O cadastro do cliente possui os botões **Ativar Bot** e **Desativar Bot**.
- Ao ativar um cliente com WhatsApp, o sistema envia imediatamente a saudação aprovada e, em seguida, o menu atual.
- Ao desativar, a sessão de menu e a sessão exclusiva da IA são encerradas.

## Saudação enviada na ativação

👋 Olá, NOME DO CLIENTE!

Seja bem-vindo à CentralUnlocker.

Como posso ajudar você hoje?

Selecione uma das opções do menu abaixo:

## Observação

A migração usa a configuração `migracao_bot_clientes_desativados_v65` para rodar apenas uma vez e não desativar novamente clientes que você já liberou após a atualização.
