# Sprint 09 — Administração de combos e composição

**Estado:** Concluída. Testes focados, suíte completa, build e auditoria passaram; a migration foi aplicada ao banco isolado de testes e ao banco de desenvolvimento.

## 1. Escopo implementado

- Listagem e detalhe administrativos de combos, inclusive inativos.
- Criação de combos com composição inicial e preço manual.
- Edição parcial de dados, preço, estado e composição.
- Remoção lógica de associações de composição por `ItemCombo.removidoEm`.
- Reativação da associação existente ao readicionar o mesmo item, com quantidade atualizada e unicidade `(comboId,itemId)` preservada.
- Ativação e desativação administrativa de combos.
- Catálogo público limitado a combos ativos com pelo menos um componente vigente e todos os componentes vigentes ativos.

## 2. Contratos da administração

As rotas exigem sessão e papel `ADMIN`; POST e PATCH também passam por `app.verificarOrigem`.

| Método | Caminho | Contrato |
|---|---|---|
| GET | `/admin/combos` | Lista combos ativos/inativos e a composição vigente. |
| GET | `/admin/combos/:id` | Consulta combo por UUID, inclusive inativo. |
| POST | `/admin/combos` | Cria combo ativo e composição inicial transacionalmente. |
| PATCH | `/admin/combos/:id` | Atualiza campos permitidos, estado e alterações explícitas de composição transacionalmente. |

As consultas GET aceitam `?incluirRemovidos=true`. A resposta sempre contém `itens` com associações vigentes e `itensRemovidos`; por padrão, GET deixa esta última lista vazia. Quando solicitada, ela contém associações não apagadas fisicamente e inclui `removidoEm`. A resposta do PATCH de remoção também mostra a associação recém-removida em `itensRemovidos`.

O PATCH recebe `removerItemIds: string[]` para remover associações atualmente vigentes e `itens: [{ itemId, quantidade }]` para criar, atualizar ou reativar associações. Uma omissão nunca remove um item. Os arrays rejeitam duplicidades; um item não pode ser removido e adicionado na mesma requisição. Remover ID sem associação vigente retorna `400`. Reativar uma associação limpa `removidoEm` e atualiza `quantidade`, sem duplicar o par único.

O mesmo PATCH aceita `ativo: boolean`. Ativar combo com componente inativo é permitido, pois não existe regra de negócio que proíba a operação; o combo permanece indisponível publicamente enquanto qualquer componente vigente estiver inativo. A administração continua consultando combos inativos.

## 3. Modelo, transações e histórico

`ItemCombo.removidoEm` é nullable: `null` significa associação vigente e timestamp preenchido significa removida da composição atual. A migration adiciona somente a coluna `removido_em TIMESTAMP(3)` à tabela existente, preservando as oito tabelas e a unicidade `(comboId,itemId)`.

Criação e atualização de campos/composição acontecem em transação Prisma. As referências são validadas antes das gravações; erros de unicidade e de referência não deixam alterações parciais. Nenhuma rota administrativa exclui fisicamente associações, itens, combos ou pedidos.

Alterar composição, preço ou estado atuais não atualiza `ItemPedido` nem seus campos históricos, incluindo `nomeHistorico`, `precoUnitarioHistorico` e `composicaoHistorica`. O checkout ainda não está implementado: a persistência completa do snapshot no momento da compra não pode ser comprovada nesta sprint e precisa de testes quando o fluxo existir.

## 4. Disponibilidade pública

`GET /combos` e `GET /combos/:id` retornam somente associações vigentes. Um combo é ocultado se estiver inativo, não possuir componente vigente ou se algum componente vigente estiver inativo. Associações removidas não aparecem e não afetam a disponibilidade.

## 5. Arquivos envolvidos

- `prisma/schema.prisma` e `prisma/migrations/20261028154500_item_combo_removido_em/migration.sql`.
- `src/routes/combos-admin.ts` e `src/routes/combos.ts`.
- `tests/api/combos-admin.test.ts` e `tests/api/combos.test.ts`.
- Documentação de estado atual, regras de negócio, modelo de dados, plano de APIs, padrão das rotas e testes.

## 6. Validação desta entrega

| Verificação | Resultado |
|---|---|
| `npx prisma validate --schema prisma/schema.prisma` | Aprovado. |
| `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` | Gerou somente `ALTER TABLE "itens_combo" ADD COLUMN "removido_em" TIMESTAMP(3);`. |
| `npm run db:test:migrate` | Aprovado; migration aplicada ao banco isolado `leosburger_test`. |
| Aplicação da migration no banco de desenvolvimento | Aplicada ao banco `leosburger_db`; Prisma informou que o banco está sincronizado com o schema. Prisma Client 6.19.3 regenerado. |
| `npm test -- --run tests/api/combos-admin.test.ts tests/api/combos.test.ts` | Aprovado — 2 arquivos, 23 testes. |
| `npm test -- --run` | Aprovado — 11 arquivos, 96 testes. |
| `npm run build` | Aprovado (`tsc --noEmit`). |
| OpenAPI | Aprovado nos testes de contrato das rotas públicas e administrativas. |
| `git diff --check` e `git diff --cached --check` | Aprovados; apenas avisos de conversão LF/CRLF em arquivos preexistentes. |

A migration foi criada, validada e aplicada aos bancos de teste e desenvolvimento. Não houve `db push`, reset do banco, exclusão de volume, staging ou commit.

## 7. Sprint seguinte

A Sprint 10 permanece dedicada a **Perfil e Endereços**, conforme `SPRINT-10.md`. Administração de combos não foi transferida para a Sprint 10.
