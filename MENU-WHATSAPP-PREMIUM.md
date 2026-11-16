# Menu visual WhatsApp — versão 10.1.15

Implementação entregue desativada por padrão. Instalar ou reiniciar não ativa o menu e não dispara mensagens. O Telegram mantém sua apresentação atual.

## Primeiro teste no seu telefone

1. Instale o pacote completo preservando o banco, o disco persistente e as sessões existentes.
2. Abra **Menu WhatsApp → Modelos e ativação**, ou `/admin/menu-whatsapp/modelos`.
3. Escolha **Teste — somente o número informado**.
4. Informe seu telefone privado com DDI e DDD, por exemplo `5575999991234`.
5. Escolha **Premium** ou outro modelo e salve.
6. Pelo telefone informado, envie `menu` ao bot. Os outros clientes continuam no menu anterior.
7. Confira lista, banner, navegação e Copiar Pix no seu WhatsApp. Depois, se desejar, escolha **Ativado — todos os clientes**.

Salvar não envia mensagens. O teste restrito usa os fluxos reais: confirmar uma compra segue as regras normais de estoque, pagamento e cobrança. A demonstração da versão 10.1.14, em `/admin/menu-whatsapp/testes`, continua separada e não executa compras.

Para voltar ao formato anterior para todos, escolha **Desativado — menu atual**. O cliente pode digitar `menu texto` para usar o menu numérico por 24 horas; enviar `menu` remove essa preferência individual.

## Quatro modelos

- **Tecnológico:** preto, prata e ciano.
- **Elegante:** preto e dourado.
- **Leve e moderno:** branco e verde.
- **Premium:** grafite, prata e ciano, com nomes mais claros quando ainda estão no padrão.

Os quatro banners estão incluídos em `media/menu-modelos`. O aplicativo WhatsApp controla a aparência final dos botões e listas. Os testes locais validam o protocolo; o teste no seu telefone confirma a apresentação real.

## Menu principal Premium

Banner, saudação pelo primeiro nome, saldo real e botão **Abrir menu**.

Produtos e serviços:

- Consultas VIP
- Serviços e desbloqueios
- Números WhatsApp
- Comprar eSIM
- Assinaturas digitais

Sua conta e atendimento:

- Carteira e pedidos
- Solicitar cancelamento
- Central de atendimento

Nomes, ordem, emojis e visibilidade personalizados no painel são respeitados. Os nomes Premium substituem apenas nomes que ainda são os padrões. As opções mantêm identificadores estáveis ao reordenar ou ocultar serviços.

## Navegação e compras

As etapas compatíveis recebem listas tocáveis; etapas de digitação continuam aceitando CPF, IMEI e outros dados normalmente. Listas longas têm páginas e pesquisa. Países usam os países habilitados no catálogo e o preço real de cada cliente.

A oferta eSIM permite alterar quantidade e voltar à confirmação com o total correto. Preço e estoque são conferidos no fluxo existente. A entrega mantém QR Code e dados privados, com opções de continuidade e instalação.

O Pix usa o gateway já configurado. O botão **Copiar Pix** copia o código completo gerado pelo gateway. Se o botão não puder ser enviado ou o código exceder o limite suportado, o código completo segue em texto. Copiar não confirma pagamento.

As regras existentes de pré/pós-pago, preços individuais, validação de pagamento, cancelamento e estorno continuam nos mecanismos de compra originais.

## Pedidos e cancelamento

**Carteira e pedidos → Meus pedidos** organiza serviços, eSIMs, números/SMS e assinaturas. Cada consulta usa o cliente autenticado; dados de entrega só são recuperados para pedidos próprios concluídos. As listas de pedidos comuns consultam até 200 registros recentes por categoria, com paginação visual e pesquisa nos registros carregados.

O seletor de cancelamento mostra pedidos elegíveis e mantém a confirmação do fluxo original. As condições são conferidas novamente antes da ação. As listas de cancelamento consultam até 100 registros recentes por categoria. Hero sem SMS segue as regras existentes de prazo; após SMS, usa finalização.

Os números Hero continuam com o cartão de acompanhamento e seus SMS atualizados pelo mecanismo existente. Ao abrir um pedido explicitamente, a lista de ações complementa o cartão; o acompanhamento automático não gera novas listas a cada atualização.

## Validação e recuperação

Cliques são vinculados ao telefone, à conexão e à etapa atual. Expiram após 30 minutos; cliques consumidos não repetem a operação. Mudança de etapa invalida a seleção antiga. Solicite um menu atualizado para continuar.

Falha de envio nativo nos menus adaptados mantém o envio anterior como alternativa. Para voltar à navegação numérica individualmente, digite `menu texto`.

A versão foi verificada com testes automatizados de protocolo, isolamento por cliente, contexto de cliques, busca, Pix, cobrança e regressões Hero/comunidade. Nenhuma compra, mensagem real ou implantação no Render foi feita durante a validação. O teste visual no celular deve ser feito pelo painel antes da liberação geral.
