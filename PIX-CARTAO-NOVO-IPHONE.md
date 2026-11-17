# Versão 10.1.18 — cartão Pix novo e teste sem cobrança

## O que foi corrigido

O log do iPhone mostrou envio aceito de uma edição com `cta_copy`, `image:true` e `edit:true`, mas o aparelho exibiu somente o aviso de mensagem editada. A apresentação agora evita transformar texto em um cartão de mídia.

Ao gerar um Pix real pelo checkout compacto:

1. O bot envia **Gerando seu Pix…**.
2. Após registrar a cobrança existente e preparar o QR real, envia o cartão pronto como uma **mensagem nova**, com QR Code, valor, código completo e Copiar Pix.
3. Edita o aviso inicial somente com texto: **✅ Pix gerado. Confira abaixo.**
4. A referência do cartão NOVO é guardada para confirmação e entrega. O aviso inicial não é apagado e não é usado como referência da entrega.

As regras de pagamento, geração de cobrança, saldo, autorização, entrega e estorno não foram alteradas. O monitoramento continua usando o pagamento que já foi criado; não é feita outra cobrança para apresentar o cartão.

Depois da confirmação, permanecem as tentativas de edição do cartão e a continuidade da referência da versão 10.1.17. Edição rejeitada ou prazo encerrado permite nova mensagem de entrega, cuja referência passa a ser usada nas atualizações seguintes. A exibição dessas edições posteriores também depende do cliente WhatsApp.

## Teste primeiro sem pagar nem gerar cobrança

1. Instale o ZIP completo preservando banco, disco e sessões.
2. Abra `/admin/menu-whatsapp/testes`.
3. Escolha a sessão conectada e seu telefone privado, diferente do bot, com DDI e DDD.
4. Em Demonstração, escolha **Cartão Pix novo com QR — demonstração sem cobrança**.
5. Clique em **Enviar teste privado** e confira no iPhone e no Android.

O telefone deve receber:

- Um aviso de geração de demonstração.
- Uma mensagem NOVA com QR ilustrativo, valor ilustrativo R$ 10,00, texto **DEMONSTRAÇÃO — NÃO PAGUE**, código de demonstração e botão Copiar Pix.
- O aviso inicial editado apenas com texto simples.

O conteúdo copiado é `CENTRALUNLOCKER-TESTE-SEM-VALOR-NAO-E-UM-PIX`. O QR codifica esse texto, não um pagamento, e não deve ser usado no banco. Toque no botão, cole de volta na conversa e confira a confirmação do teste. O laboratório não chama gateway, não movimenta carteira, não cria pedido e não usa dados reais de cobrança.

No painel, marque **Apareceu e funcionou**, **Não apareceu** ou **Apareceu, mas falhou**. `submitted` significa somente aceitação do envio. `copy_pasted` significa que o texto do teste foi recebido do telefone/mesma conexão, não que houve um pagamento.

Se o cartão NOVO também ficar invisível no iPhone, o problema não é apenas a transformação por edição. Use o formato anterior de QR comum + botão separado, que havia funcionado nesse aparelho, enquanto esse componente é investigado. Não gere cobranças repetidas para testar.

## Menu em texto e listas

O menu em texto, foto, nomes e ordem continuam iguais. O Pix segue independente da ativação das listas, pela página `/admin/menu-whatsapp/modelos`.

Os testes relatados no iPhone indicaram: banner separado aparece, lista não; outros formatos nativos também não apareceram. Portanto o menu com listas NÃO é declarado compatível e não é ativado por esta atualização. A demonstração de lista tradicional permanece opcional e isolada do fluxo real.

## Limitações e evidência

A imagem nativa aparece acima do texto. A posição do QR abaixo da instrução da prévia não é garantida pelo componente. Aceitação de envio e status de entrega não comprovam exibição nem edição no celular. Esta versão precisa do teste no iPhone real antes de liberar o cartão aos clientes.

277 testes automatizados passaram: Hero 143, comunidade 31, cobrança 19, menu/Pix 63 e laboratório 21. Incluem cartão novo sem edição de mídia do texto inicial, referência correta do cartão, código integral, QR de demonstração, cópia verificada, isolamento de telefone, falha de upload e ausência de tabelas financeiras no laboratório. O painel também foi conferido em banco temporário.

Nenhuma mensagem real, compra, cobrança ou implantação no Render foi executada no desenvolvimento. Instruções de versões anteriores que falam em transformar o aviso inicial em cartão por edição foram substituídas por este fluxo.
