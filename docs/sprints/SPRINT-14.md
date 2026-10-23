# Sprint 14 — Histórico de pedidos do cliente

**Estado:** Executar após Sprint 12 e autenticação.

## Objetivo
Permitir que cliente autenticado liste seus pedidos e consulte detalhes sem acessar compras de terceiros.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Inspecionar o schema do pedido e decidir os campos de resposta pública com base no contrato de negócio.
2. Definir rota de listagem e rota de detalhe, seguindo a convenção do projeto.
3. Obter a identidade do cliente pelo JWT validado; não confiar em `usuarioId` enviado em query ou body.
4. Listar somente pedidos pertencentes ao usuário autenticado. Pedidos de visitante não devem aparecer na conta de outra pessoa.
5. Exibir os valores históricos gravados no pedido, sem substituir nome/preço por dados atuais do catálogo.
6. Definir paginação somente se necessária pela especificação ou pelo volume esperado; não introduzir complexidade sem requisito.
7. Testar lista vazia, lista com pedidos, detalhe próprio, pedido inexistente e tentativa de consultar pedido de outro usuário.
8. Executar testes, build e atualizar OpenAPI e documentação.

## Arquivos envolvidos
- `Rotas de pedidos do cliente, testes e documentação`

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
- [ ] Propriedade dos pedidos é validada; histórico é fiel à compra; nenhum dado de outro usuário é exposto.

## O que esta sprint ensina
Autorização por propriedade, listagem, detalhe e consistência histórica.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
