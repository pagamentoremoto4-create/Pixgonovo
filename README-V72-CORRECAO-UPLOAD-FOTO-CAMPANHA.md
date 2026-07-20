# V72 — Correção do upload de foto nas campanhas

## Erro encontrado
A página de campanhas do WhatsApp executava `location.reload()` a cada 5 segundos, mesmo sem campanha em andamento. No celular, esse recarregamento fechava o seletor de arquivos antes da escolha da foto e também repetia a consulta dos grupos, podendo provocar `rate-overlimit`.

## Correção
- A página não recarrega mais automaticamente enquanto o formulário está sendo preenchido.
- A atualização automática de 5 segundos acontece somente quando uma campanha está em andamento.
- O botão manual “Atualizar grupos/progresso” continua disponível.
- Mantida a correção anterior de débito do saldo do cliente no Telegram.
