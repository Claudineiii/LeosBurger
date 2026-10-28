# Regras de negócio aprovadas — LEOSBurger

Este documento registra o escopo conhecido do MVP. Se uma regra precisar mudar, o agente deve explicar o impacto e pedir decisão ao usuário antes de alterar schema, endpoints ou interface.

## 1. Escopo do produto

- Cardápio digital compartilhável por link.
- Cliente navega pelo cardápio e finaliza pedidos online.
- Área administrativa para gerenciar itens, categorias, combos e pedidos.
- Dashboard/fechamento com visão diária e mensal, além de análises semestrais e anuais planejadas.
- Pagamento simulado no MVP.
- Entrega e retirada disponíveis.
- Interface planejada em HTML, TypeScript e Tailwind; sem React.

## 2. Categorias e catálogo

Categorias previstas:

- Lanches
- Acompanhamentos
- Bebidas
- Sobremesas

Regras:

- Combo é uma entidade própria, não uma categoria.
- Acompanhamentos podem aparecer como sugestões de interface/adicionais; não devem virar automaticamente uma tabela ou uma aba separada do cardápio.
- Exemplos de adicionais mencionados: bacon, cheddar, ovo e molho.
- Produtos como Coca-Cola lata podem não aceitar adicionais.
- Não há módulo de estoque no MVP.
- Itens e combos podem ser ativados/desativados no painel administrativo.
- Combos são cadastrados pelo proprietário; não dependem de data de validade semanal/sazonal.
- Não excluir ou alterar dados históricos de pedidos ao editar o catálogo atual.
- Bebidas esperadas inicialmente incluem Coca-Cola lata e Guaraná, mas isso é conteúdo inicial de catálogo, não regra rígida de código.

## 3. Conta e checkout

- Visitante pode fazer pedido sem criar conta somente se escolher PIX.
- Para os demais métodos de pagamento, exige-se conta autenticada.
- Cadastro público cria apenas usuários do tipo `CLIENTE`; a senha é armazenada com bcrypt e nunca aparece em respostas.
- E-mails são removidos de espaços externos e convertidos para minúsculas no cadastro e login.
- A autenticação usa JWT HS256 em cookie `HttpOnly`, `SameSite=Strict` e `Path=/`; o cookie recebe `Secure` em produção.
- O JWT dura 30 dias para `CLIENTE` e 12 horas para `ADMIN`. O token contém o identificador do usuário; o servidor consulta a conta ativa e o papel atual antes de autorizar cada requisição protegida.
- Logout limpa o cookie do navegador, mas não revoga JWTs copiados; eles continuam válidos até a expiração, enquanto o usuário permanecer ativo. Não há tabela de sessões, refresh token ou revogação nesta versão.
- CORS com credenciais permite somente a origem exata configurada em `FRONTEND_ORIGIN`; operações de escrita recusam uma origem diferente.
- O cliente pode escolher entrega ou retirada.
- Em entrega, usar endereço do cliente, confirmar/editar os dados e calcular taxa.
- Em retirada, informar o endereço do restaurante e apresentar o status do pedido.
- Endereço atual do perfil pode mudar, mas pedidos antigos preservam o endereço usado no momento da compra.

## 4. Pagamentos

Métodos previstos no MVP:

- PIX
- Crédito
- Débito
- Dinheiro

Regras:

- O pagamento é simulado.
- Não integrar gateway real nem movimentar dinheiro no MVP.
- Guardar método e estado de pagamento necessários para simular o fluxo, sem armazenar dados completos de cartão.
- Não confiar no total enviado pelo frontend; o backend recalcula subtotal, adicionais, desconto, taxa e total.
- Visitante sem conta só pode finalizar com PIX.

## 5. Entrega e distância

- A taxa de entrega é calculada por faixas de distância.
- O restaurante usa uma localização fixa para a simulação.
- O fluxo esperado: endereço do cliente → distância em quilômetros → faixa correspondente → taxa → salvar distância e taxa no pedido.
- O campo de distância em quilômetros (`distanciaKm`) foi discutido para registrar a distância calculada.
- A taxa e a distância usadas no pedido são históricas e não devem ser recalculadas retroativamente quando as regras mudarem.
- A forma final de obter distância (coordenadas/geocodificação ou serviço por CEP) deve ser confirmada antes da implementação. Não inventar valores de faixas sem consultar a decisão ou pedir ao usuário.
- Localização fixa é para simulação do MVP; API de mapas pode ser futura.

## 6. Pedidos e histórico

- Pedido pode pertencer a usuário cadastrado ou visitante (`usuario_id` anulável no modelo aprovado).
- Um registro de item do pedido representa um item individual OU um combo; nunca os dois.
- Preservar nome, preço, quantidade, adicionais e valores aplicados no momento da compra.
- Preservar composição do combo no pedido para que mudanças futuras no combo não alterem pedidos antigos.
- Preservar endereço, dados do cliente necessários ao pedido, taxa, desconto e total históricos.
- Identificador interno do pedido é UUID; número sequencial de exibição pode ser usado para facilitar atendimento/visualização, sem substituir o identificador de rastreio.
- O status atual fica no pedido e o histórico de mudanças fica em JSONB no próprio pedido, evitando uma tabela extra no MVP.
- Status devem ter transições controladas; não permitir mudanças arbitrárias de qualquer estado para qualquer outro.
- O histórico deve registrar mudanças de status de forma consistente, idealmente na mesma transação da alteração do pedido.

## 7. Cupons

Há uma decisão histórica a esclarecer antes de implementar:

- Documentação arquitetural anterior incluía cupom e registro de código/desconto aplicado no pedido.
- A decisão mais recente restringiu o schema a oito tabelas e não inclui uma tabela de cupons.
- Não criar tabela de cupons nem implementar regras de quantidade/validade sem autorização.
- Se o recurso for confirmado no MVP, armazenar no pedido o código e o desconto efetivamente aplicados, conforme campos já existentes no schema; primeiro verificar o schema real.
- Até a decisão ser confirmada, tratar cupons como pendência de escopo, não como funcionalidade pronta.

## 8. Dashboard e administração

- Administração de categorias, itens, combos e pedidos.
- Combos ativos/inativos manualmente; não por agenda.
- Dashboard calculado a partir dos pedidos existentes.
- Visões diária/mensal e semestral/anual foram planejadas.
- Não gerar relatórios contábeis em PDF no MVP.
- Não incluir módulo de atendimento telefônico.

## 9. Exclusões explícitas do MVP

- Estoque.
- Atendimento por telefone.
- Pagamento real ou gateway de pagamento.
- Relatórios contábeis em PDF.
- Tabela de cupons sem nova decisão.
- Tabela separada para carrinho no banco.
- Tabela separada para histórico de status.
- React.
- Ampliação automática do schema para além das oito tabelas.

## 10. Regras de integridade e segurança

- Quantidades devem ser positivas.
- Uma linha de pedido não pode apontar simultaneamente para item e combo.
- Totais e valores devem ser calculados no backend.
- Endereço e preço históricos precisam ser imutáveis em relação a alterações posteriores no perfil/catálogo.
- Pedido com entrega deve ter os dados históricos de endereço exigidos pelo schema.
- E-mail deve ser normalizado/validado.
- CEP deve ser validado/normalizado para os dígitos esperados.
- Hash de senha nunca deve aparecer em resposta de API.
- Rotas administrativas exigem autorização.
- Proteger login e checkout contra abuso ao implementar essas rotas.
