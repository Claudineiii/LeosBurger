# Sprint 09 — Administração de combos e composição

**Estado:** Executar após Sprint 8.

## Objetivo
Gerenciar combos e suas composições, respeitando referências e histórico.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Inspecionar o schema de `Combo` e `ItemCombo`, suas restrições e as rotas já existentes.
2. Definir contratos de criação, atualização, ativação/desativação e atualização de composição.
3. Proteger todos os endpoints com autenticação e papel ADMIN.
4. Validar nome, preço, ordem, descrição e referências dos itens componentes.
5. Validar que os itens referenciados existem e que as quantidades respeitam as regras do schema.
6. Definir o comportamento para substituição da composição sem apagar ou modificar a composição histórica de pedidos existentes.
7. Não permitir exclusão física de combos. Desativar em vez de excluir.
8. Testar combo válido, nome duplicado, item inexistente, quantidade inválida, tentativa não autorizada e desativação.
9. Testar que pedidos antigos continuam com a composição histórica, mesmo após alteração do combo no catálogo.
10. Executar testes, build e atualizar a documentação.

## Arquivos envolvidos
- `Rotas administrativas de combos, schemas, testes e documentação`

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
- [ ] ADMIN controla combos; composição atualiza corretamente; histórico antigo permanece intacto; sem DELETE físico; testes passam.

## O que esta sprint ensina
Tabelas de junção, transações quando necessárias, integridade referencial e histórico imutável.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
