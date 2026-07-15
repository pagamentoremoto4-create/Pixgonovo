# V59 — IA conectada ao catálogo em tempo real

- A OpenAI recebe os produtos ativos diretamente do SQLite a cada pergunta.
- Inclui nome, categoria, preço atual, descrição, estoque e campanha ativa.
- A IA foi instruída a nunca inventar preço ou disponibilidade.
- Produtos sem estoque são informados como indisponíveis.
- Intenção de compra orienta o cliente a digitar COMPRAR e abrir o fluxo seguro do bot.
- Alterações feitas no painel passam a valer automaticamente, sem editar o prompt.
