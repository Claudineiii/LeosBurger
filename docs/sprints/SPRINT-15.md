# Sprint 15 — Administração de pedidos

**Estado:** Executar após Sprint 13.

## Objetivo
Permitir que a administração consulte e gerencie pedidos segundo as regras de status e permissões.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Definir os filtros administrativos necessários com base na documentação original; não adicionar filtros por conveniência sem justificativa.
2. Proteger as rotas com autenticação e papel ADMIN.
3. Definir respostas explícitas para listagem e detalhe, evitando campos internos desnecessários.
4. Permitir alterações de status somente conforme o fluxo aprovado e a matriz de permissões definida na Sprint 13.
5. Registrar toda transição no histórico do pedido.
6. Não permitir que a administração altere silenciosamente valores históricos, taxa de entrega ou composição de pedidos existentes.
7. Testar acesso sem autenticação, usuário não ADMIN, filtros válidos/inválidos, transições permitidas/proibidas e preservação de valores.
8. Executar suíte completa, build e atualizar documentação.

## Arquivos envolvidos
- `Rotas administrativas de pedidos, testes e documentação`

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
- [ ] Somente ADMIN consulta/gerencia; transições respeitam regras; histórico e valores permanecem consistentes.

## O que esta sprint ensina
Rotas administrativas, filtros, autorização e proteção de dados financeiros históricos.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
