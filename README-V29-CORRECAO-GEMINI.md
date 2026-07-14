# V29 — Correção Gemini no WhatsApp

Correções:
- Mensagens livres sem sessão agora são enviadas ao Gemini.
- Perguntas escritas enquanto o menu está aberto também são enviadas ao Gemini.
- Números 1 a 6 e fluxos de serviço/Pix continuam tratados pelo sistema.
- Log de inicialização mostra se a IA está ativa e se a chave foi encontrada.

Variáveis no Render:

WHATSAPP_AI_ENABLED=true
GEMINI_API_KEY=chave_nova_criada_no_Google_AI_Studio
GEMINI_MODEL=gemini-3.5-flash
WHATSAPP_AI_MAX_TOKENS=350
WHATSAPP_AI_TIMEOUT_MS=25000

Depois do deploy, procure no log:
🤖 IA WhatsApp: ATIVA (gemini-3.5-flash)
