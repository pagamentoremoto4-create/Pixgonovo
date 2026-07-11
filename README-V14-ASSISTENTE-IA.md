# V14 — Assistente de IA OpenAI

## Novidades

- Opção **🤖 Assistente IA** no menu do Telegram e opção **7** no WhatsApp.
- Mesmo histórico de IA para a conta vinculada do Telegram e WhatsApp.
- Comandos: `IA`, `MENU`, `COMPRAR` e `HUMANO`.
- A IA não executa pagamentos, não altera saldo e não cria ou cancela pedidos.
- Durante CPF/PIX, escolha de serviço, IMEI e confirmação de eSIM, o fluxo normal tem prioridade.
- Serviços, planos e preços são lidos diretamente do banco de dados antes de cada resposta.

## Variáveis de ambiente

Adicione no Render/Railway:

```env
IA_ENABLED=true
OPENAI_API_KEY=cole_sua_chave_no_servidor
OPENAI_MODEL=gpt-5-mini
```

Nunca coloque a chave real no GitHub ou envie pelo chat.

## Como usar

### Telegram

Toque em **🤖 Assistente IA** ou digite `/ia`.

### WhatsApp

Digite `menu` e escolha `7`, ou digite `ia`.

Dentro da conversa:

- `COMPRAR`: abre a lista de serviços.
- `MENU`: encerra a IA e volta ao menu.
- `HUMANO`: solicita atendimento e avisa o administrador.

## Instalação

Execute:

```bash
npm install
npm start
```
