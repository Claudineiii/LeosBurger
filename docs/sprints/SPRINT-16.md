# Sprint 16 — Dashboard e fechamentos

**Estado:** Executar depois que criação, pagamentos simulados e status estiverem funcionando.

## Objetivo
Calcular indicadores diários, mensais, semestrais e anuais separando status de pedido e situação/valores de pagamento.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Consultar a especificação original e os campos existentes para definir a data de referência dos agrupamentos. Se a regra não estiver documentada, apresentar alternativas antes de implementar.
2. Definir os indicadores exatamente conforme o escopo aprovado. Não incluir PDF, metas, estoque ou indicadores não previstos sem autorização.
3. Separar quantidade/valor por status do pedido de situação/valor de pagamento. Não chamar pagamento simulado de dinheiro recebido.
4. Definir o tratamento de pedidos cancelados, pedidos ainda pendentes e pagamentos simulados para evitar somas enganosas.
5. Implementar consultas agregadas com Prisma ou SQL somente se necessário e justificado. Não criar tabela de dashboard.
6. Validar limites de período, virada de mês/ano e fuso horário utilizado pela aplicação.
7. Testar período sem pedidos, vários status, cancelamentos, pedidos com pagamento simulado, limites de datas e totais.
8. Executar testes, build e documentar fórmulas, data de referência e limitações dos números.

## Arquivos envolvidos
- `Rotas/consultas de dashboard, testes e documentação`

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
- [ ] Indicadores respeitam período e status; pagamento simulado não é apresentado como recebimento real; nenhum módulo ou tabela extra foi criado.

## O que esta sprint ensina
Agregações, filtros temporais, métricas consistentes e interpretação de pagamento simulado.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
