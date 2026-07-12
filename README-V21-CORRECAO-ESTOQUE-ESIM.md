# V21 — Correção da exibição do estoque eSIM

Corrigida a lista de eSIM exibida ao cliente.

A consulta do banco retorna a quantidade disponível no campo `qtd`, mas a mensagem usava o campo inexistente `estoque`, fazendo qualquer produto aparecer com estoque 0.

Agora a lista utiliza `qtd`, exibindo corretamente a quantidade de QR Codes disponíveis, como os 9 QR Codes do TIM Pré.
