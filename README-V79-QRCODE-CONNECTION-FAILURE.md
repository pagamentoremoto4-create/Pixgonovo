# V79 — Correção definitiva do QR Code

- Usa a versão Web atual retornada pelo próprio Baileys antes de criar o socket.
- Mantém fallback para o padrão interno caso a consulta falhe.
- Não entra em reconexão automática durante um novo pareamento.
- Evita invalidar o QR Code com sockets sucessivos.
- Reconecta automaticamente apenas sessões já registradas.
- Fluxo exclusivo por QR Code.
