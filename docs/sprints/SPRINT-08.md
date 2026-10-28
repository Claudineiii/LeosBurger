# Sprint 08 — Administração de categorias e itens

**Estado:** Concluída após a Sprint 7.

## Objetivo
Criar e atualizar categorias e itens e permitir ativação/desativação, sem exclusão física.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Consultar regras originais, schema Prisma, endpoints planejados e contratos públicos já implementados.
2. Definir os caminhos e métodos administrativos antes de codificar; usar convenção de plural em português e evitar conflito com rotas públicas.
3. Proteger todas as rotas administrativas com autenticação e autorização ADMIN.
4. Definir schemas Zod para parâmetros e corpos. Validar nome, descrição, categoria, preço, ordem e URL de imagem conforme o schema real; para `adicionais`, validar somente JSON válido, sem inventar uma estrutura de domínio.
5. Implementar criação e atualização de categoria sem violar unicidade de nome.
6. Implementar criação e atualização de item, verificando se a categoria existe e se a combinação categoria/nome não viola a restrição do banco.
7. Implementar ativação/desativação; não criar DELETE físico.
8. Manter `adicionais` no JSON existente. A forma de negócio ainda depende de decisão futura; o checkout não deve confiar em preços enviados pelo cliente.
9. Documentar respostas e erros no OpenAPI. Tratar conflito de unicidade com resposta coerente e sem expor detalhes do banco.
10. Testar usuário não autenticado, usuário não ADMIN, dados inválidos, categoria inexistente, conflito de nome, criação/atualização e ativação/desativação.
11. Executar testes e build; atualizar plano de APIs e regras administrativas.

## Arquivos envolvidos
- `Rotas administrativas de categorias/itens, schemas de entrada/saída, testes e documentação`

Os caminhos são indicativos. Confirme a estrutura real antes de criar arquivos e reutilize os existentes quando apropriado.

## Como validar
Execute primeiro o teste específico da rota ou funcionalidade, depois a suíte completa e o build. Comandos conhecidos:

```bash
npm test -- --run
npm run build
git diff --check
```

Confira `package.json` antes de usar um comando específico de teste. Não contorne a proteção do banco de testes.

## Critérios de conclusão
- [x] Somente ADMIN modifica catálogo; Zod valida entradas; não há exclusão física; restrições são respeitadas; testes passam.

## O que esta sprint ensina
CRUD sem exclusão física, validação de corpo, autorização por papel, unicidade e JSON de adicionais.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes: `npm test -- --run tests/api/catalogo-admin.test.ts` passou (1 arquivo, 11 testes); `npm test -- --run` passou (10 arquivos, 81 testes), incluindo autenticação e consultas públicas existentes.
- Resultado do build: `npm run build` passou.
- Arquivos alterados: `src/app.ts`, `src/routes/catalogo-admin.ts`, `tests/api/catalogo-admin.test.ts`, `docs/01_ESTADO_ATUAL.md`, `docs/03_REGRAS_DE_NEGOCIO.md`, `docs/05_PLANO_DE_APIS.md`, `docs/06_PADRAO_DAS_ROTAS_API.md`, `docs/sprints/MAPA.md`, `docs/sprints/README.md` e este registro.
- Documentação atualizada: caminhos/métodos, permissões, validações, respostas de erro, contratos OpenAPI, comportamento das listagens públicas e estado da sprint.
- Pendências ou riscos: `adicionais` permanece um JSON sem estrutura de domínio aprovada; a API administrativa valida apenas que seja JSON válido e o mantém fora das respostas públicas. Combos administrativos continuam no escopo da Sprint 9. Nenhuma alteração de schema, migration ou dependência foi necessária.
