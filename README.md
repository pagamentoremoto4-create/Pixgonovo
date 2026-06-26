# CentralUnlocker Dual WhatsApp - eSIM Manual

Versão com:

- WhatsApp 1 mantido para revendas/serviços.
- WhatsApp 2 para venda de eSIM cliente final.
- Mesmo estoque eSIM para os dois WhatsApps.
- QR Code dos eSIM salvo em disco persistente.
- Plano eSIM pode continuar disponível mesmo quando o estoque automático acaba.
- Área `/admin/esim/manuais` para entregar QR manual depois do pagamento.
- Botão `📤 Entregar QR` nos pedidos manuais de eSIM.

## Variáveis recomendadas no Render

```txt
DB_PATH=/data/database.db
DATA_DIR=/data
ESIM_DIR=/data/esim
```


## Correção eSIM manual revenda
- Pedidos eSIM manuais de revenda agora aparecem em `/admin/esim/manuais`.
- A entrega manual pelo painel envia o QR para revenda ou cliente corretamente.
- O botão `📤 Entregar QR` aparece para qualquer pedido com `entrada_label` contendo eSIM.
