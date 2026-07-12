# V26 — Revisão completa de estabilidade e segurança

Esta versão mantém a correção do botão **Pagar este serviço** e adiciona uma revisão preventiva do projeto.

## Correções e proteções adicionadas

- Inicialização ordenada: o banco é preparado antes do painel, Telegram e WhatsApp.
- Proteção por login aplicada a todas as rotas `/admin`.
- Sessões de menus e pagamentos passam a ser persistidas no SQLite em mais etapas do fluxo.
- PIX pendentes voltam a ser consultados depois de reinício ou novo deploy.
- Evita verificações duplicadas do mesmo pagamento.
- Tratamento de falhas durante a consulta do status PIX.
- Banco configurado com `WAL`, timeout de bloqueio e índices para melhorar estabilidade.
- Limpeza automática de sessões abandonadas há mais de dois dias.
- Upload de QR Code usa extensão validada pelo tipo real da imagem e nome aleatório seguro.
- Endpoint `/health` para verificar servidor, banco, Telegram e WhatsApp.
- Tratamento geral de erros HTTP e registro de falhas não tratadas.
- Avisos no log quando a senha padrão do painel ou a chave PixGo não foram configuradas.

## Configuração obrigatória no Render

Use uma senha forte e diferente da padrão:

```env
ADMIN_PANEL_USER=seu_usuario
ADMIN_PANEL_PASS=sua_senha_forte
PIXGO_API_KEY=sua_chave_pixgo
DATA_DIR=/data
DB_PATH=/data/database.db
ESIM_DIR=/data/esim
BACKUP_DIR=/data/backups
WHATSAPP_SESSION_DIR=/data/whatsapp-session
```

## Verificação feita

- Sintaxe completa do `index.js` validada com `node --check`.
- Rotas administrativas revisadas.
- Fluxos de sessão do Telegram e WhatsApp revisados.
- Fluxo de geração e acompanhamento do PIX revisado.
- Persistência do banco e dos arquivos revisada.

O teste de execução completo com serviços externos depende das chaves reais do Telegram, PixGo e da sessão do WhatsApp no Render.
