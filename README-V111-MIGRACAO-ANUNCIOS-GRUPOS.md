# V111 — Migração de anúncios antigos de grupos

- Migra automaticamente campanhas da tabela antiga `campanhas_grupos_whatsapp` para `campanhas_anuncios`.
- Preserva nome, mensagem, foto, grupos, intervalos, frequência, status, próximo/último envio e contadores.
- Migra também o histórico antigo para a Central de Anúncios.
- Desativa o worker legado para evitar disparos duplicados.
- A migração é idempotente e não duplica campanhas ao reiniciar o Render.
- Fotos antigas salvas em `/data/ads-images` passam a funcionar na Central de Anúncios.
