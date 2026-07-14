# V34 — IA de atendimento inteligente no WhatsApp

## Implementado
- Roteador híbrido: regras locais rápidas + Gemini para linguagem natural.
- Entendimento de frases como “qual faz SSP?”, “quero contratar desbloqueio”, “meu saldo” e “atendimento humano”.
- Busca de serviços e preços diretamente no banco de dados.
- Resposta local de segurança quando a API Gemini estiver indisponível.
- Histórico recente da conversa para manter contexto.
- Transferência direta para atendimento humano.
- IA pausada individualmente durante o atendimento humano.
- Retorno pelo comando `ativar IA` ou `menu`.
- Métricas no painel: respostas da IA, transferências e atendimentos humanos ativos.

## Variáveis novas
- `WHATSAPP_AI_HISTORY_LIMIT=12`
- `WHATSAPP_AI_HUMAN_TIMEOUT_MIN=120`

## Gemini
Configure no Render:
- `WHATSAPP_AI_ENABLED=true`
- `GEMINI_API_KEY=...`
- `GEMINI_MODEL=gemini-3.5-flash`
- `WHATSAPP_AI_ROUTER=true`

Depois do deploy, abra **Painel > IA WhatsApp** e ative a IA.
