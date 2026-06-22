# CentralUnlocker - Dual WhatsApp

## O que foi adicionado

- WhatsApp 1 continua com o fluxo atual: revendas, serviços, IMEI, Lock Code, saldo e eSIM para revenda.
- WhatsApp 2 foi adicionado apenas para venda automática de eSIM para cliente final.
- Os dois WhatsApps usam o mesmo painel, mesmo banco e mesmo estoque `esim_estoque`.
- O painel agora tem a página **Conexões WhatsApp** para mostrar os QR Codes dos dois números.
- O cadastro de eSIM agora tem dois preços: **Preço Revenda** e **Preço Cliente**.

## Sessões WhatsApp

O WhatsApp 1 usa a pasta:

```txt
auth/
```

O WhatsApp 2 usa a pasta:

```txt
auth_esim/
```

No Render, use disco persistente para manter o banco e as sessões salvas.

## Fluxo WhatsApp 1

```txt
menu
1 - Serviços
2 - Comprar eSIM
3 - Histórico
4 - Conta
```

## Fluxo WhatsApp 2

```txt
menu
1 - Comprar eSIM
2 - Suporte
```

Depois o cliente escolhe o plano, gera PIX, paga e recebe o QR Code automaticamente.
