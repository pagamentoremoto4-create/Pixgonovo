# Versão 10.1.16 — teste iPhone e Pix compacto

A atualização preserva o modo, telefone, tema e apresentação já configurados. Não ativa recursos, não publica anúncios e não envia mensagens ao instalar. As opções novas só mudam após salvar no painel.

## Menu no iPhone

Abra `/admin/menu-whatsapp/modelos`:

1. Funcionamento: **Teste — somente o número informado**.
2. Informe seu telefone de teste com DDI e DDD.
3. Formato da lista: **Lista sem imagem — testar no iPhone**.
4. Salve e envie `menu` ao bot pelo iPhone. O comando `menu` também remove a preferência individual anterior por texto.
5. Confira se aparece Abrir menu e se as opções funcionam. Compare com Android.
6. Se funcionar, teste **Banner separado + lista sem imagem**. O banner será uma imagem comum e a lista virá depois.

O formato **Banner junto da lista (anterior)** permanece disponível. Todos os formatos respeitam a ativação e o número restrito. Não detectamos automaticamente Android/iPhone: esse dado não é confiável nas mensagens recebidas.

Se a lista sem imagem também não aparecer, use `menu texto`, mantenha a liberação geral desativada e envie os novos logs. A alteração é um teste de compatibilidade, não uma correção comprovada em aparelhos. O WhatsApp pode aceitar a mensagem sem exibi-la no destinatário.

## Pix compacto

Na mesma página, escolha **Cartão único com QR, código e Copiar Pix — experimental**. O modo teste aplica o cartão somente ao telefone informado, respeitando também `menu texto`. Clientes fora da ativação mantêm a apresentação anterior.

O fluxo WhatsApp passa a ser:

1. **Gerando seu Pix…**, enquanto o gateway existente gera a cobrança.
2. Cartão com QR Code, valor, aguardando pagamento, instrução, código completo visível e botão **Copiar Pix**.
3. Após enviar o cartão com sucesso, o bot tenta apagar o aviso de geração. Ele não transforma texto em imagem por edição.
4. Após a confirmação validada pelo fluxo de pagamento existente, o bot tenta editar o cartão para pagamento confirmado. O número/serviço é entregue pelo mecanismo original.

**Limites da apresentação:** a imagem é o cabeçalho do componente WhatsApp e aparece acima do texto. A ordem da prévia gráfica, com QR abaixo da instrução, não é reproduzível nesse componente nativo. A edição de cartão interativo para texto também depende do aplicativo: envio aceito não comprova exibição. Por isso o formato anterior continua selecionável e o cartão precisa ser testado no iPhone e no Android.

O código visível e o botão usam o mesmo código completo; o QR é gerado desse código. Nenhum código é cortado. Códigos acima de 2.048 caracteres, ausência de dados, falha de upload ou envio nativo voltam ao formato anterior com código completo em texto. Se o cartão for aceito pelo servidor mas invisível no aparelho, não há detecção automática confiável: volte ao formato anterior pelo painel.

A edição usa a conexão original e tem limite conservador de 14 minutos. Quando uma edição de confirmação falha no envio, o fluxo comum mantém seu aviso de confirmação. Ao apagar o aviso de geração, uma falha pode deixá-lo visível. Cartões já enviados continuam vinculados ao pagamento mesmo após reinício; não dependem da sessão de navegação do cliente.

Escolher o Pix compacto vale para geração de saldo, serviços/eSIM e Hero que passam pelo checkout principal WhatsApp. ConsultaVIP possui fluxos próprios; Telegram mantém sua apresentação. O modo de teste usa contas e cobranças REAIS: não confirme compras se deseja apenas testar a navegação. A demonstração sem compras v14 permanece separada.

## Segurança financeira e diagnóstico

As novas funções só leem os pagamentos para verificar identificador, gateway, destinatário e valor. Elas não alteram status financeiro, saldo, cobrança, autorização de compra, estorno ou entrega. Atualizações de sucesso só ocorrem depois que a verificação financeira existente registra a confirmação.

Logs `WA_VISUAL` incluem tipo `single_select`/`cta_copy`, presença de imagem, conexão e ID da mensagem. Não incluem código Pix, chave de API ou telefone completo. Eventos SENT e EDIT_SUBMITTED significam aceitação do envio, não prova de renderização no celular. Correlacione o ID com WA STATUS ENVIO e informe o que aparece no telefone.

## Verificação da entrega

259 testes automatizados passaram: Hero 143, comunidade 31, cobrança 19, laboratório WhatsApp 15, menu e cartão Pix 51. Incluem código integral, QR gerado do código real, isolamento por cliente/gateway/valor, confirmação antecipada, expiração, reinício, falha de edição e retorno ao formato anterior. O painel também foi verificado em banco temporário sem envio real.

Nenhuma implantação no Render, mensagem real ou cobrança real foi executada durante o desenvolvimento. Preserve banco, disco persistente, sessões e configurações ao atualizar.
