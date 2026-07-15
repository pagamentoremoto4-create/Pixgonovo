# V55 — OpenAI somente no WhatsApp

## Configuração no Render

Adicione em **Environment**:

```env
OPENAI_API_KEY=cole_sua_chave_aqui
OPENAI_MODEL=gpt-5-mini
OPENAI_MAX_OUTPUT_TOKENS=300
IA_ENABLED=false
```

Depois do deploy, abra **Painel > Configurações > IA no WhatsApp**, edite as instruções e selecione **Ativada**.

## Proteções

- A IA não funciona no Telegram.
- PIX, CPF/CNPJ, pedidos, compras, estoque e menus têm prioridade.
- A IA atende apenas mensagens livres no WhatsApp.
- A chave fica somente nas variáveis do Render.
- O histórico mantido em memória é curto e é apagado quando o serviço reinicia ou quando a configuração é salva.
