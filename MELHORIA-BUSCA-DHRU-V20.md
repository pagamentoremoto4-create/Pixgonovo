# v10.1.20 — Busca dos comandos DHRU por assinatura

Em Consultas por assinatura → Comandos Dhru do grupo:

- Busca instantânea por nome exibido, nome original, ID local ou UUID, com paginação e filtros por status e tipo.
- Cada resultado mostra os campos exigidos, o custo do fornecedor na moeda original e a data da última sincronização. Não há preço de venda: o acesso do cliente continua sendo pela assinatura.
- O serviço vinculado permanece visível ao abrir a página. Para trocar, digite a busca, clique em Selecionar serviço e confirme em Salvar vínculo.
- Alterar o texto limpa a seleção; o servidor rejeita salvar um ID que não corresponde ao texto selecionado. Produtos sem UUID sincronizado não podem ser selecionados.
- Comandos existentes, comandos Yan, assinaturas e regras de cobrança permanecem preservados. Nenhum vínculo é migrado automaticamente.

O custo mostrado vem da última sincronização do catálogo, sem conversão presumida de moeda. O ID local (#450, por exemplo) e o UUID da API são apresentados separadamente.

Esta versão melhora a configuração do vínculo; não altera o envio de pedidos ao fornecedor e não comprova a causa dos pedidos /icloud pendentes. Para essa investigação ainda é necessário verificar a resposta do fornecedor e o UUID configurado no servidor.

Validação: testes unitários do seletor, teste da página e dos endpoints com banco temporário, teste no Chromium e regressões Hero SMS, Pix/menu, comunidade, cobrança e laboratório WhatsApp. Nenhuma compra, mensagem ou crédito real foi executado. Para instalar, substitua os arquivos da aplicação e reinicie; preserve seu banco, credenciais e sessões.
