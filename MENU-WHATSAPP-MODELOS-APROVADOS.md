# Menu WhatsApp — definições aprovadas

Registrado em 16/11/2026, horário de Brasília.

Status: implementação autorizada e concluída na versão 10.1.15, desativada por padrão. A instalação não ativa o modelo nem envia mensagens. Veja MENU-WHATSAPP-PREMIUM.md.

## Quatro modelos disponíveis no painel

1. **Tecnológico:** preto, prata e azul/ciano.
2. **Elegante:** preto e dourado.
3. **Leve e moderno:** branco e verde.
4. **Premium:** grafite, prata e ciano, com nomes melhorados quando os padrões não foram personalizados.

Cada modelo terá seu banner. As imagens apresentadas na conversa são prévias ilustrativas; o aplicativo WhatsApp controla a aparência dos componentes nativos. Os modelos não mudam os serviços ou as regras financeiras.

## Ativação e teste

- A funcionalidade deve vir **desativada por padrão**.
- Desativada: todos os clientes continuam recebendo o menu atual.
- O painel permite escolher um modelo e digitar o número pessoal de teste, com DDI e DDD.
- No modo de teste, **somente o número informado recebe o novo menu**. Todos os demais permanecem no menu atual.
- Esse teste deve permitir navegar no menu selecionado para conferir o comportamento antes da liberação geral. A demonstração isolada da versão 10.1.14, que não executa compras, é uma ferramenta separada; não deve ser confundida com a liberação restrita do novo menu.
- Após conferir no celular, o administrador pode ativar explicitamente para todos pelo painel.
- É possível trocar o modelo no painel e desativar a funcionalidade a qualquer momento para retornar ao menu atual.
- Instalar uma atualização, reiniciar o servidor ou abrir a página do painel não deve ativar o novo menu nem disparar mensagens automaticamente.

## Menu atual a preservar

Usar as opções reais do código e respeitar os nomes, emojis, ordem e visibilidade personalizados no painel:

1. REALIZAR CONSULTA
2. SERVIÇOS & DESBLOQUEIOS
3. WHATSAPP SMS
4. COMPRAR ESIM
5. ASSINATURAS PREMIUM
6. MINHA CONTA
7. CANCELAMENTO
8. SUPORTE

A apresentação proposta é banner, saudação, saldo real do cliente e botão **Abrir menu**, que abre a lista de opções tocáveis. Cada opção deve acionar a função existente, com identificação estável para evitar que renomear ou reordenar abra o serviço errado. As prévias de saldo de R$ 50,00 são exemplos, não um valor fixo.

Manter navegação numérica como alternativa. Não adicionar ou remover serviços, não alterar preços, cobrança, cancelamentos, devoluções ou Telegram nesta mudança de apresentação.

## Próxima etapa

Instalar o pacote e validar primeiro no telefone de teste pelo painel. A liberação geral é uma escolha explícita do administrador; o pacote não foi implantado automaticamente no servidor.
