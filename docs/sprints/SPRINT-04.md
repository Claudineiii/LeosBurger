# Sprint 04 — Detalhes de um item

**Estado:** Concluída e validada após a Sprint 3.

## Objetivo
Implementar ou auditar `GET /itens/:id` com validação de identificador e exposição segura dos dados públicos.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Conferir o contrato de `GET /itens` e o tipo real de `Item.id` no Prisma.
2. Definir `GET /itens/:id`, schema Zod para `params` e respostas documentadas para sucesso e não encontrado.
3. Buscar o item pelo identificador usando Prisma; retornar somente se estiver ativo.
4. Selecionar explicitamente os campos públicos do item e os dados públicos necessários da categoria. Não expor relações ou JSON administrativo sem necessidade.
5. Tratar identificador malformado e item inexistente/inativo conforme o padrão de erros do projeto.
6. Escrever testes para item ativo, ID inválido, ID inexistente e item inativo; validar também os campos da resposta.
7. Rodar testes específicos, suíte de API, suíte completa e build; atualizar a documentação.

## Arquivos envolvidos
- ``src/routes/itens.ts`, `tests/api/itens.test.ts` ou arquivo específico existente, `docs/05_PLANO_DE_APIS.md``

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
- [x] O recurso correto é retornado; inválidos e ausentes são tratados; item inativo não aparece; resposta pública explícita; testes passam.

## O que esta sprint ensina
Parâmetros de rota, busca única, status HTTP e contrato de recurso.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes: `npm test -- --run tests/api/itens.test.ts` passou (1 arquivo, 9 testes; 5 de listagem e 4 de detalhe); `npm test -- --run` passou (7 arquivos, 37 testes).
- Resultado do build: `npm run build` passou.
- Arquivos atualizados nesta tarefa: `tests/api/itens.test.ts`, `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md`, `docs/06_PADRAO_DAS_ROTAS_API.md` e este registro. `src/routes/itens.ts` já estava modificado antes do início; a implementação e seus schemas foram auditados e preservados sem sobrescrever essa alteração.
- Documentação atualizada: rota de detalhe, parâmetros, respostas, regra de ocultação de itens inativos e status da sprint.
- Pendências ou riscos: `adicionais` continua fora da resposta por não haver contrato público definido. Nenhuma alteração de schema ou migration foi necessária.
