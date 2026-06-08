# CentralUnlocker - Cadastro de Revenda pelo WhatsApp

## Novo fluxo

O admin pode cadastrar revenda direto na conversa do WhatsApp com o bot.

### Opção 1: cadastro guiado
Envie para o bot:

```txt
cadastrar revenda
```

O bot vai perguntar:
1. Nome da revenda
2. WhatsApp da revenda com DDD

Depois ele salva no banco, ativa a revenda e envia boas-vindas/tutorial para ela.

### Opção 2: cadastro rápido em uma linha
Envie:

```txt
addrevenda Nome da Revenda | 5575999999999
```

Ou:

```txt
cadastrar revenda Nome da Revenda | 5575999999999
```

### Exemplo
```txt
addrevenda João Unlock | 75999999999
```

O sistema normaliza automaticamente para Brasil `55 + DDD + número`.

## Observação
Apenas o número configurado na variável `ADMIN_NUMBER` consegue cadastrar revendas pelo WhatsApp.
