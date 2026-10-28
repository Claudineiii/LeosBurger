# Modelo de dados e integridade — LEOSBurger

## 1. Diretriz

O modelo foi reduzido deliberadamente para **oito tabelas**. Não criar novas tabelas por conveniência sem apresentar justificativa e obter aprovação. O schema real é `prisma/schema.prisma`; este documento resume decisões, não substitui o arquivo.

## 2. Tabelas aprovadas

| Tabela         | Responsabilidade resumida                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `usuarios`     | Contas de clientes e administrador, incluindo dados de autenticação e perfil.                   |
| `enderecos`    | Endereços atuais vinculados a usuários.                                                         |
| `categorias`   | Categorias do cardápio.                                                                         |
| `itens`        | Produtos/itens individuais do cardápio.                                                         |
| `combos`       | Combos definidos pelo proprietário.                                                             |
| `itens_combo`  | Composição dos combos com itens e quantidades.                                                  |
| `pedidos`      | Pedido, cliente/visitante, modalidade, pagamento simulado, totais, endereço e status histórico. |
| `itens_pedido` | Linhas históricas de item individual ou combo, com valores e dados históricos.                  |

`ItemCombo` possui `removidoEm` opcional (`removido_em` no banco). `null` identifica uma associação vigente; um timestamp a mantém armazenada, mas fora da composição atual. A chave única `(comboId, itemId)` permanece, portanto a readição reativa o mesmo registro em vez de criar duplicata. Essa alteração adiciona uma coluna à tabela existente e mantém as oito tabelas.

## 3. Enums aprovados

Os quatro enums registrados no histórico:

- `tipo_usuario`
- `tipo_entrega`
- `status_pedido`
- `metodo_pagamento`

Os valores exatos devem ser lidos em `prisma/schema.prisma`; não inferir grafia ou acrescentar estados sem conferir o schema.

## 4. Regras estruturais

- O modelo possui oito tabelas.
- `usuarios` pode estar ausente em pedido de visitante.
- Endereço de perfil é o endereço atual; pedido guarda cópia histórica necessária para a compra.
- Preços históricos não devem depender do preço atual de `itens` ou `combos`.
- Composição histórica de combo deve sobreviver a alterações futuras do combo.
- A composição vigente é composta apenas por associações `ItemCombo` com `removidoEm = null`; associações removidas não são apagadas fisicamente.
- `itens_pedido` deve apontar para item individual ou combo, nunca ambos simultaneamente.
- Histórico de status fica em JSONB no próprio pedido.
- Cupons não têm tabela aprovada.
- Carrinho não precisa de tabela no MVP; pode existir no estado do frontend até checkout, sujeito à validação dos dados no backend.

## 5. Constraints

O histórico indica **11 constraints CHECK** na migração definitiva `20260929005013_schema_definitivo`, além de chaves, relacionamentos e unicidades. As categorias das regras incluem:

- exclusividade entre `item_id` e `combo_id` na linha de pedido;
- quantidades positivas;
- consistência dos totais;
- endereço histórico obrigatório para pedido de entrega;
- restrições adicionais de domínio e integridade definidas na migration.

Antes de alterar uma constraint:

1. localizar a constraint exata em `prisma/migrations/`;
2. identificar qual regra de negócio ela protege;
3. atualizar ou adicionar teste que demonstre o comportamento;
4. nunca remover a regra apenas para fazer um teste passar;
5. solicitar decisão se a mudança afetar uma regra aprovada.

## 6. Unicidade e nomes

Decisões registradas:

- nome de categoria único;
- nome de combo único;
- nome de item único dentro da categoria;
- campos de endereços foram discutidos para representar CEP, logradouro, número, bairro e cidade; conferir nomes e tipos definitivos no schema.
- número de endereço deve permitir valores textuais como `S/N` ou complemento alfanumérico quando assim definido pelo schema; não converter automaticamente em inteiro sem verificar o modelo.

## 7. Dados históricos

Ao criar pedido, o backend deve persistir os dados necessários para que uma alteração futura de:

- nome do item;
- preço do item;
- nome/preço do combo;
- composição do combo;
- adicionais;
- endereço de usuário;
- taxa de entrega;
- desconto applied;
  não modifique o registro histórico da compra.

## 8. Processo seguro para alteração de banco

1. Conferir Docker/PostgreSQL ativo.
2. Ler o schema e migration atuais.
3. Explicar a necessidade da mudança.
4. Pedir autorização se ampliar escopo ou mudar regra aprovada.
5. Alterar schema e criar migration apropriada.
6. Atualizar seed se necessário.
7. Atualizar testes de integridade.
8. Executar `npx prisma validate`, testes e build.
9. Revisar migration e diff antes de commit.

Não executar `prisma migrate reset` ou `docker compose down -v` como solução rotineira.
