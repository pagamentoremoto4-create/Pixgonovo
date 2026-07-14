# V30 - Correção da IA WhatsApp

Correção do erro:

`SQLITE_ERROR: no such column: preco`

A consulta da IA agora usa as colunas reais do banco:

- `servicos_catalogo.preco_padrao`
- `precos_revenda.preco`
- `esim_planos.nome_plano`
- `esim_planos.preco_cliente`
- `esim_planos.preco_revenda`
- estoque calculado a partir de `esim_estoque`

Também foi adicionado tratamento de erro para impedir que uma falha ao carregar o contexto comercial interrompa o atendimento do WhatsApp.
