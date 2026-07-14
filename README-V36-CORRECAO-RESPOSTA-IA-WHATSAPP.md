# V36 — Correção da IA no WhatsApp

## Problema corrigido

O projeto estava usando `gemini-3.5-flash` como modelo padrão. Quando a API recusava esse modelo, toda mensagem livre caía na resposta fixa “Não consegui responder agora”.

## Alterações

- Modelo padrão alterado para `gemini-2.5-flash`.
- Adicionado modelo alternativo automático `gemini-2.5-flash-lite`.
- Mantida prioridade dos fluxos de menu, PIX, CPF/CNPJ, pedidos, IMEI e eSIM.
- Logs agora mostram o modelo que falhou e diferenciam chave inválida, limite de API e modelo indisponível.
- Saudações e perguntas livres dentro ou fora do menu são encaminhadas à IA quando `WHATSAPP_AI_ENABLED=true`.

## Variáveis no Render

```env
WHATSAPP_AI_ENABLED=true
GEMINI_API_KEY=SUA_CHAVE
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite
```

Após atualizar as variáveis, faça um **Manual Deploy / Restart**.
