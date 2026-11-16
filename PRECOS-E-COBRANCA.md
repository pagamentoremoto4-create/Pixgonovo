# Preços e cobrança — versão 10.1.13

A tela fica em **Clientes → cliente → Preços e cobrança**, no endereço `/admin/revenda/ID/precos`.

## Organização

| Bloco | Preço individual | Modalidade |
| --- | --- | --- |
| Serviços via API (DHRU e outros do catálogo) | Por serviço | Pré ou pós-pago por cliente e serviço |
| Serviços próprios | Por serviço | Pré ou pós-pago por cliente e serviço |
| Premium / GGSOMA | Por produto | Pré ou pós-pago por cliente e produto |
| eSIM | Por plano | Uma modalidade para todos os planos daquele cliente |
| Números WhatsApp / Hero SMS | Por cliente, aplicado a todos os países | Pré ou pós-pago para compras pela conta; Pix continua antecipado |

Cada bloco tem seu próprio botão de salvar. Cada serviço/plano exibe preço padrão, personalizado e aplicado agora. Vazio ou zero no preço personalizado usa o padrão. Os campos aceitam `25,00` ou `25.00`, e a tela também aceita `1.234,56`. Valores inválidos impedem o salvamento do bloco inteiro. O preço aplicado exibido é o que está salvo; após editar, salve o bloco para atualizar a indicação.

## Clientes antigos e novos

A atualização não altera preços, saldos, `tipo_revenda`, `modalidade_esim` ou modalidades por serviço dos cadastros antigos. Não converte clientes nem cobra pedidos históricos.

Clientes novos continuam nas rotinas de cadastro com padrão **pré-pago**. O administrador pode alterar manualmente cada modalidade na nova tela.

**Compatibilidade GGSOMA:** o código anterior sempre exigia pagamento antecipado, mesmo quando o seletor genérico antigo estava em pós-pago. Para não ativar crédito automaticamente nos clientes antigos, essa integração mantém sua regra efetiva de pré-pago até uma alteração manual para pós-pago no novo bloco Premium. A configuração antiga não é regravada pela atualização.

Hero continua pré-pago nos cadastros sem escolha manual. Sua nova preferência é independente dos outros serviços.

## Como cobra

- **Pré-pago:** exige saldo e cobra antes de comprar do fornecedor/criar o pedido. Pix é confirmado antes da entrega.
- **DHRU e próprios pós-pagos:** preservam a cobrança na conclusão do pedido. O pedido já criado mantém sua condição de cobrança.
- **GGSOMA pós-pago:** cria o pedido sem descontar antecipadamente do cliente. Depois da resposta de entrega concluída, debita uma única vez. Uma falha definitiva antes da entrega não desconta nem cria um estorno fictício. Pedidos já existentes sem a nova modalidade registrada mantêm a regra antiga.
- **Hero pós-pago:** autoriza a compra do número sem debitar a carteira do cliente. A finalização confirmada da ativação cobra uma única vez, com recuperação após reinício. Troca continua vinculada ao mesmo pedido. Cancelamento confirmado antes da cobrança fecha sem dar crédito extra. SMS, finalização, prazo e bloqueios de cancelamento mantêm as regras existentes.
- **eSIM pós-pago:** permite confirmar a compra pela conta mesmo sem saldo disponível. No automático, o pedido conclui na entrega do QR e o débito ocorre nessa conclusão. Em entregas manuais pendentes, mantém a cobrança na finalização pelo fluxo existente.

**Pós-pago pode deixar a carteira negativa.** O fornecedor continua cobrando da loja conforme a API dele. Serviços com entrega instantânea, como GGSOMA e eSIM automático, podem concluir e cobrar imediatamente após a confirmação do cliente; pós-pago não cria um prazo de dias para pagamento.

## Confirmação DHRU no Telegram

A confirmação dos campos coletados agora é tratada também no Telegram: `1` confirma, `2` corrige e `0` volta. A confirmação expira em 30 minutos. O caminho compartilhado impede duas confirmações simultâneas do mesmo contato de criar dois pedidos concorrentes. Os dados e o saldo são validados novamente antes da criação.

## Operação e verificação

Faça backup do banco e mantenha o disco persistente, as variáveis e as sessões ao atualizar. Não substitua seu banco por um banco de teste. As estruturas novas são criadas automaticamente; não há migração de valores ou modalidades dos clientes existentes.

Testes locais incluem regressões Hero e avisos públicos; SQLite temporário com API simulada para opções por serviço, preservação de clientes antigos, validação e salvamento por bloco, cobrança única, saldo insuficiente, cancelamento sem crédito indevido, confirmação DHRU no Telegram e compra de eSIM pós-pago. O sistema também foi inicializado com banco temporário e as telas administrativas foram verificadas por HTTP autenticado.

Nenhuma compra, cobrança ou mensagem real foi executada nos testes. O ZIP precisa ser instalado no servidor; esta entrega não publica automaticamente no Render.
