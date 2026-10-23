# Sprint 03 — Listagem pública de itens

**Estado:** Próxima sprint de implementação, salvo se a rota já tiver sido criada.

## Objetivo
Implementar ou auditar `GET /itens`, retornando itens ativos e permitindo filtro opcional por categoria.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Inspecionar `src/routes/categorias.ts`, `src/app.ts`, o modelo `Item` no Prisma e os testes atuais. Confirmar que `GET /itens` ainda não existe ou decidir auditar a versão existente.
2. Definir o contrato: método `GET`, caminho `/itens`, query opcional `categoriaId`, resposta de lista e erros documentados. Usar nomes de campos coerentes com `/categorias`.
3. Decidir quais campos são públicos olhando o schema e a tela do cardápio. Selecionar campos explicitamente; não retornar o registro Prisma inteiro.
4. Usar o Prisma para buscar somente itens ativos. Se `categoriaId` for informado, validar o formato e filtrar por essa categoria. Não aceitar filtro inválido silenciosamente.
5. Ordenar por `ordem` e por um segundo campo determinístico, usando um critério existente e compatível com o schema.
6. Adicionar o schema Zod da query e o schema da resposta no contrato OpenAPI. Não inventar um formato definitivo para `adicionais`; verificar o JSON existente e expor apenas se houver contrato compreensível e seguro.
7. Escrever testes de lista vazia, item ativo, item inativo, filtro de categoria, filtro inválido, ordenação e campos públicos. Criar e limpar dados de teste próprios.
8. Executar o teste específico, a suíte de API, a suíte completa e o build. Atualizar o plano de APIs e o estado atual.

## Arquivos envolvidos
- ``src/routes/itens.ts` (se esse nome não conflitar com arquivo existente), `src/app.ts`, `tests/api/itens.test.ts`, `docs/05_PLANO_DE_APIS.md`, `docs/01_ESTADO_ATUAL.md``

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
- [ ] Somente itens ativos são listados; filtro funciona; ordenação é estável; entradas inválidas são tratadas; resposta não expõe campos internos; testes e build passam.

## O que esta sprint ensina
GET, query string, filtros Prisma, schema de resposta, ordenação estável e testes via `app.inject()`.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
