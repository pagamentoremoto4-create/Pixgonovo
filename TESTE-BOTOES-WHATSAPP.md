# Teste privado de botões WhatsApp — 10.1.14

Esta versão adiciona uma área administrativa de demonstração. Os menus e os Pix reais dos clientes continuam no formato atual. Nenhum envio de teste acontece automaticamente ao instalar, iniciar o servidor ou abrir a página.

## Como testar no celular

1. Atualize o código completo, mantendo seu banco de dados, variáveis, disco e sessões atuais.
2. Abra **Painel → Menu principal do WhatsApp → Testar menu com botões e Copiar Pix no meu celular**. Endereço: `/admin/menu-whatsapp/testes`.
3. Escolha uma sessão conectada e habilitada para o bot.
4. Informe **seu número pessoal com DDI e DDD**, diferente do número da sessão do bot. Isso permite conferir também a resposta ao clique. Grupos e canais não são aceitos.
5. Escolha **Menu com lista de serviços** e clique **Enviar teste privado**.
6. No celular, abra **Abrir serviços** e toque em uma opção. O bot deverá responder confirmando o teste, sem executar a função escolhida, criar cadastro, comprar serviço ou movimentar saldo.
7. Volte ao painel, escolha **Botão Copiar Pix — texto sem cobrança** e envie essa demonstração.
8. No celular, toque **Copiar Pix** e cole o resultado de volta na conversa com o bot. O texto esperado é `CENTRALUNLOCKER-TESTE-SEM-VALOR-NAO-E-UM-PIX`. Não é um Pix válido e não existe cobrança.
9. Confira o histórico no painel e marque o resultado observado: **Apareceu e funcionou**, **Não apareceu** ou **Apareceu, mas falhou**.

## O que o histórico confirma

- `submitted`: a rotina de envio retornou. Não confirma entrega nem renderização dos botões no celular.
- `click_received`: o bot recebeu um clique vinculado ao teste, ao telefone informado e à sessão de origem.
- `copy_pasted`: o bot recebeu de volta o texto de demonstração. O WhatsApp não informa quando um usuário copia o conteúdo; esse estado confirma apenas o texto colado, não qual gesto foi usado para copiá-lo.
- `uncertain`: o envio ficou sem confirmação ou foi interrompido. Confira o celular antes de fazer outro envio; não existe reenvio automático.

Os botões do menu de teste têm validade de 30 minutos. Repetir a mesma opção não provoca repetição da resposta. O conteúdo colado de volta também é interceptado como demonstração e não cadastra cliente.

## Compatibilidade

O Baileys instalado é `7.0.0-rc13`. Os campos antigos de botões e listas passados como conteúdo comum não são suportados pela rotina atual de geração de mensagem. O teste utiliza o formato nativo e `relayMessage`, sem trocar a biblioteca.

Os pacotes nativos de menu e cópia foram serializados com a biblioteca real instalada. A exibição final depende da sessão, do servidor WhatsApp e da versão do aplicativo no aparelho. O teste no celular é necessário antes de aplicar o formato às compras dos clientes.

## Escopo desta versão

- Página protegida pelo login administrativo, com proteção adicional no formulário de envio.
- Demonstrações enviadas somente ao número privado digitado pelo administrador.
- Histórico persistente de envios e cliques.
- Leitura de respostas nativas limitada aos IDs próprios do teste; os demais menus mantêm a interpretação anterior.
- Sem alteração de preços, cobrança, estoque, pedidos ou Pix reais.
- Sem alteração no Telegram. O limite de 256 caracteres do botão de cópia Telegram foi identificado na análise anterior; não há novo botão de Pix real ativado nesta versão.

Referência Telegram: https://core.telegram.org/bots/api#copytextbutton

## Verificação local

206 testes passaram: 141 Hero, 31 avisos públicos, 19 preços/cobrança e 15 da área de teste WhatsApp. Foram verificados também inicialização e páginas autenticadas em banco temporário, proteção do POST, preservação de dados financeiros e isolamento da demonstração. Nenhuma mensagem, compra ou cobrança real foi executada por esses testes.
