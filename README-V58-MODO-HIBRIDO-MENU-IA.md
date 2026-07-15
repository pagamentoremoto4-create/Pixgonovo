# V58 — Modo híbrido Menu + IA no WhatsApp

## Regra
- Os fluxos ativos do sistema continuam tendo prioridade absoluta: PIX, CPF/CNPJ, IMEI, confirmação, compra, saldo e suporte.
- No menu principal, as opções 1 a 6 continuam abrindo as funções normais.
- Qualquer outra mensagem no menu é encaminhada automaticamente à OpenAI.
- Isso inclui perguntas, respostas curtas como “sim” e números fora de 1 a 6.
- Depois da primeira resposta, o cliente entra na sessão exclusiva da IA.
- `menu`, `comprar`, `atendente`/`suporte` e `cancelar` continuam como comandos de saída da IA.
