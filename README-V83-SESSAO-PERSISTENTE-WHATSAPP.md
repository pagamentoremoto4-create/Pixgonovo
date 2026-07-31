# V83 — Sessão persistente do Bot de Serviços

- O Bot de Serviços procura automaticamente uma sessão válida em:
  - caminho definido em `WHATSAPP_SESSION_DIR`;
  - `/data/whatsapp-session`;
  - `/data/whatsapp-services-session`.
- A pasta que já contiver `creds.json` registrado será usada automaticamente.
- O botão **Gerar QR Code/Conectar** não apaga mais uma sessão válida; ele tenta restaurá-la primeiro.
- A sessão só é apagada pelo botão **Desconectar**, após confirmação.
- O log mostra `DATA_DIR`, a pasta escolhida e o estado das credenciais.

Configuração recomendada no Render:

```env
DATA_DIR=/data
WHATSAPP_SESSION_DIR=/data/whatsapp-session
```

O Persistent Disk deve estar montado em `/data`.
