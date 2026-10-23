# Sprint 12 — Criação transacional do pedido

**Estado:** Executar após Sprint 11.

## Objetivo
Criar pedido e linhas em uma operação consistente, preservando todos os valores históricos.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Inspecionar restrições CHECK e relações reais do Prisma antes de escrever a criação.
2. Definir o contrato de criação do pedido e quais dados devem ser enviados pelo cliente; nunca aceitar como confiáveis preços, subtotais, taxa, desconto ou total.
3. Revalidar no momento da criação os itens, combos, quantidades, adicionais, endereço, pagamento e cupom. Não depender apenas de uma prévia anterior.
4. Calcular todos os valores no backend e construir o registro histórico do pedido.
5. Gravar nome/preço histórico, adicionais escolhidos com seus nomes/preços, composição do combo, endereço histórico, distância, taxa, desconto, código do cupom e valores finais conforme aplicável.
6. Para cada linha de `itens_pedido`, preencher `itemId` OU `comboId`, nunca ambos. Respeitar quantidades e CHECKs.
7. Gravar status inicial e histórico JSON válido. Usar transação Prisma para gravar pedido e linhas relacionadas atomicamente.
8. Gerar/obter o número público do pedido respeitando a estratégia já definida no banco, sem criar duplicidades.
9. Testar pedido de visitante com PIX, pedido autenticado, entrega, retirada, item e combo, falha intermediária/rollback, valores manipulados no payload e preservação histórica.
10. Executar testes, build e verificar que o banco de testes permanece isolado.

## Arquivos envolvidos
- `Rota de criação do pedido, serviço apenas se necessário, testes de pedido e documentação`

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
- [ ] Pedido e linhas são criados atomicamente; valores recalculados; histórico preservado; XOR item/combo respeitado; falhas não deixam pedido parcial.

## O que esta sprint ensina
Transações Prisma, consistência, dados históricos e restrições do banco.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
