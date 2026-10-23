# Sprint 05 — Listagem pública de combos

**Estado:** Executar após as Sprints 3 e 4.

## Objetivo
Implementar ou auditar `GET /combos` respeitando ativação do combo e de seus componentes.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Inspecionar os modelos `Combo`, `ItemCombo` e `Item`, as relações Prisma e o contrato atual do catálogo.
2. Definir a resposta pública de combo, incluindo somente dados necessários e composição útil para o cardápio.
3. Consultar apenas combos ativos.
4. Aplicar a regra aprovada: ocultar o combo se qualquer item componente estiver inativo. Definir a consulta Prisma mais clara para representar essa regra, respeitando as relações reais.
5. Ordenar combos de forma determinística com `ordem` e critério secundário existente.
6. Escrever testes para combo ativo com componentes ativos, combo inativo, combo com componente inativo, combo sem composição se o schema permitir, lista vazia e ordenação.
7. Verificar que os dados retornados não revelam campos internos e que a composição é coerente.
8. Executar testes, build e atualizar a documentação.

## Arquivos envolvidos
- ``src/routes/combos.ts`, `src/app.ts`, `tests/api/combos.test.ts`, documentação de API`

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
- [ ] Só combos ativos e válidos aparecem; um componente inativo oculta o combo; ordenação estável; testes e build passam.

## O que esta sprint ensina
Relações Prisma, filtros relacionais, composição e regras de catálogo.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
