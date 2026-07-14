# V32 — IA como roteador central do WhatsApp

## O que mudou

- Gemini classifica a intenção do cliente antes de executar ações seguras.
- Mensagens naturais podem abrir serviços, eSIM, saldo, histórico, suporte e menu.
- Fluxos críticos ativos continuam com prioridade: IMEI, CPF/CNPJ, PIX, confirmação e pagamento.
- Corrigido o estado do submenu Minha Conta: opção 5 agora abre Adicionar saldo.
- Corrigido o comando 0 para voltar ao menu.
- Histórico e Suporte agora mantêm estado próprio.
- Perguntas livres continuam sendo respondidas pela IA especialista.

## Variável nova no Render

```env
WHATSAPP_AI_ROUTER=true
```

Mantenha também:

```env
WHATSAPP_AI_ENABLED=true
WHATSAPP_AI_SPECIALIST=true
WHATSAPP_AI_ALLOW_GENERAL=true
GEMINI_API_KEY=SUA_CHAVE_NOVA
GEMINI_MODEL=gemini-3.5-flash
WHATSAPP_AI_MAX_TOKENS=500
WHATSAPP_AI_TIMEOUT_MS=30000
```

## Testes sugeridos

- `Qual o preço dos serviços?`
- `Quero comprar 2 eSIM`
- `Quero adicionar 50 reais de saldo`
- `Quanto tenho de saldo?`
- `Mostre meus pedidos`
- `Quero contratar desbloqueio TIM`
- `Quero falar com atendente`
- `menu`

## Segurança

A IA apenas identifica a intenção e orienta o fluxo. PIX, saldo, pedidos, estoque e entrega continuam sendo executados e confirmados pelo código e pelas APIs do sistema.
