# V113 - Rodada persistente de anúncios em grupos

Correções:
- O intervalo em minutos agora avança um grupo por vez e grava o índice no banco.
- O mesmo grupo não é repetido dentro da mesma rodada por reinício do Render.
- IDs de grupos duplicados são removidos.
- Telegram e Status são enviados uma única vez no início de cada rodada.
- As horas de repetição só começam a contar depois do último grupo.
- O agendador legado de campanhas de grupos foi desativado definitivamente.
- Ao editar/reativar uma campanha, o progresso da rodada é reiniciado de forma limpa.
