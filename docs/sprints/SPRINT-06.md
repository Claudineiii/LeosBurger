# Sprint 06 — Detalhes de um combo

**Estado:** Executar após a Sprint 5.

## Objetivo
Implementar ou auditar `GET /combos/:id`, incluindo composição e a regra de disponibilidade.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Conferir o tipo de `Combo.id`, a relação `itensCombo` e o contrato da listagem.
2. Definir e documentar o schema de parâmetros e a resposta de detalhe.
3. Buscar o combo pelo identificador, incluindo os itens componentes necessários à resposta.
4. Retornar somente se o combo estiver ativo e todos os componentes estiverem ativos.
5. Selecionar explicitamente os campos do combo e dos itens que compõem o combo; preservar a quantidade de cada componente.
6. Testar combo válido, ID inválido, inexistente, combo inativo e combo com componente inativo.
7. Executar testes específicos, suíte completa e build; documentar rota e regra.

## Arquivos envolvidos
- ``src/routes/combos.ts`, testes de combos, `docs/05_PLANO_DE_APIS.md``

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
- [ ] Detalhe segue a mesma regra de disponibilidade da listagem; composição correta; erros consistentes; testes passam.

## O que esta sprint ensina
Detalhe de recurso, inclusão de relações e consistência entre endpoints.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
