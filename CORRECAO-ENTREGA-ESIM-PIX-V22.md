# v10.1.22 — Entrega do eSIM após Pix

Para a compra de eSIM por Pix no WhatsApp:

1. A cobrança continua com QR do pagamento e botão Copiar Pix.
2. Na confirmação, o bot tenta atualizar o texto do Pix, dentro do prazo de edição. A falha dessa edição não impede a entrega. Não envia uma mensagem separada de preparação para essa compra.
3. O QR de ativação do eSIM é enviado como NOVA imagem, sem converter a confirmação de texto em mídia. A legenda reúne plano, DDD, pedido, dados de instalação, aviso de uso único e opções Como instalar / Meus pedidos / Menu.
4. O retorno do envio é propagado. Se falhar, o Pix fica delivery_pending, o administrador é avisado e a mesma unidade já vinculada ao pedido é preservada. Não há novo débito nem compra de outra unidade nessa falha.

O registro de estoque VENDIDO continua significando que a unidade foi atribuída à compra; o resultado da entrega do Pix fica separado. Pedido/estoque não voltam para disponível após falha de envio. Aceite do envio pelo WhatsApp não comprova leitura ou ativação do QR no aparelho.

Sem reenvio automático de pedidos antigos: casos já entregues manualmente, incluindo o relatado, não são reprocessados nesta versão. Uma entrega pendente precisa ser conferida pelo administrador antes do reenvio manual da mesma unidade. A correção não inclui um novo recuperador automático de entregas.

O ajuste da mensagem de confirmação sem preparação é específico para contexto ESIM. Os demais produtos preservam seus avisos. A regra de enviar imagens de entrega como mídia nova evita a edição de texto em imagem também em outras entregas que usam o mesmo utilitário.

Validação: 321 testes aprovados, incluindo envio de QR como nova imagem, edição da confirmação sem mensagem extra, falha na edição sem bloquear entrega, legenda completa em uma imagem e falha do envio sem sucesso falso. Painel verificado com banco temporário; nenhuma compra, ativação ou mensagem real foi feita. Validação em iPhone real deve ocorrer após instalar.

Instalação: substituir arquivos da aplicação, preservando banco, credenciais, sessões e arquivos do estoque, e reiniciar o serviço. Não instalado no servidor nesta entrega.
