# V94 - Persistência das sessões WhatsApp

- Cada sessão usa caminho canônico em `/data/whatsapp-sessions/<session_key>`.
- Migração automática de credenciais antigas/fora do caminho esperado.
- Recuperação por número conectado quando o banco aponta para uma pasta sem credenciais.
- `saveCreds()` forçado ao abrir a conexão para garantir `creds.json` persistente.
- Reconexão automática da V93 mantida.
