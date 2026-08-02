# V114 — bloqueio definitivo do sistema legado de anúncios

- A migração da tabela antiga de campanhas roda apenas uma vez.
- Campanhas apagadas na Central de Anúncios não reaparecem após reiniciar o Render.
- Ao apagar uma campanha migrada, a origem legada correspondente também é removida.
- Todos os endpoints antigos de criação/edição/toggle/apagar redirecionam para a Central de Anúncios e não gravam mais na tabela antiga.
- O worker antigo continua bloqueado e a tabela antiga é mantida com `ativo=0` e `proximo_envio=NULL`.
- A V113 continua responsável pela rodada correta: um grupo por vez, intervalo em minutos e repetição somente após o último grupo.
