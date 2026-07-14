# V31 — Gemini especialista CentralUnlocker

A IA do WhatsApp foi configurada para atuar como especialista em:
- desbloqueio e bloqueio de operadora;
- TIM, SSP e Mi Account/Xiaomi;
- IMEI;
- eSIM, planos e estoque;
- saldo, PIX, pedidos e suporte.

Ela usa preços, serviços e estoque diretamente do banco e não deve inventar dados.

## Variáveis no Render

WHATSAPP_AI_ENABLED=true
WHATSAPP_AI_SPECIALIST=true
WHATSAPP_AI_ALLOW_GENERAL=true
GEMINI_API_KEY=CHAVE_NOVA
GEMINI_MODEL=MODELO_CONFIGURADO
WHATSAPP_AI_MAX_TOKENS=500
WHATSAPP_AI_TIMEOUT_MS=30000

Opcional:
WHATSAPP_AI_BUSINESS_NOTES=Horário de atendimento: 08h às 18h. Outras regras da empresa...

Não coloque segredos ou chaves em WHATSAPP_AI_BUSINESS_NOTES.
