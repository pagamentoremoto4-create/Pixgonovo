# V36 — Correção das respostas da IA no WhatsApp

## Corrigido
- Mensagens livres como “Bom dia”, “Faz SSP?” e “Tem alguém aí?” não ficam mais presas na resposta padrão.
- Tentativa automática com o modelo principal configurado em `GEMINI_MODEL`.
- Caso o modelo principal falhe, o sistema tenta os modelos informados em `GEMINI_FALLBACK_MODELS`.
- Respostas locais de emergência para saudação, SSP e atendimento humano quando a API Gemini estiver indisponível.
- Logs agora mostram o modelo, código HTTP e erro devolvido pela API.
- Erros de chave/permissão (401/403) não causam tentativas desnecessárias.

## Variáveis recomendadas no Render
```env
WHATSAPP_AI_ENABLED=true
GEMINI_API_KEY=SUA_CHAVE
GEMINI_MODEL=gemini-3.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash
```

Depois de atualizar o código, faça um novo deploy e teste no WhatsApp:
1. `Bom dia`
2. `Faz SSP?`
3. `Tem alguém aí?`
