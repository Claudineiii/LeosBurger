# Sprint 11 — Validação e prévia do checkout

**Estado:** Executar depois do catálogo, autenticação e endereços.

## Objetivo
Validar o conteúdo do carrinho e calcular valores no backend antes de criar o pedido definitivo.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Consultar as regras de negócio, o schema de pedidos e itens de pedido, os adicionais, combos e enums de pagamento/entrega.
2. Definir o contrato de prévia do checkout: itens/combos e quantidades, adicionais escolhidos, tipo de entrega, endereço, pagamento e cupom quando aplicável. Não aceitar total calculado pelo frontend como fonte de verdade.
3. Validar cada identificador, quantidade e seleção de adicional. Rejeitar itens inativos e combos indisponíveis.
4. Consultar preços atuais no banco e calcular subtotal no servidor, tratando dinheiro com precisão compatível com o projeto e evitando erros de ponto flutuante.
5. Validar que visitante só pode escolher PIX. Usuário autenticado pode usar apenas os métodos de pagamento definidos no projeto.
6. Para retirada, taxa de entrega deve ser zero e não deve haver cálculo de distância.
7. Para entrega, validar endereço e coordenadas/geocodificação conforme a estratégia aprovada. Antes de integrar fornecedor, verificar se já existe solução no projeto; se não existir escolha documentada, apresentar alternativas antes de adicionar dependência ou serviço.
8. Aplicar as faixas definidas: até 2 km R$ 7,99; >2–5 km R$ 9,99; >5–8 km R$ 12,99; >8–10 km R$ 15,99; >10 km fora da área.
9. Consultar a regra original de cupons. Não inventar tipo/valor de desconto se ainda não estiver especificado; se faltar, apresentar alternativas para decisão antes de codificar.
10. Calcular desconto e total no servidor; validar `desconto <= subtotal`, total não negativo e compatibilidade com as restrições do banco.
11. Escrever testes de item inativo, combo indisponível, adicional inválido, visitante com pagamento diferente de PIX, retirada sem taxa, cada limite de distância, fora da área e cupom inválido.
12. Executar testes, build e atualizar a documentação.

## Arquivos envolvidos
- `Contrato/rota de prévia do checkout, validação e cálculo de negócio onde a arquitetura justificar, testes e docs`

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
- [ ] Backend recalcula tudo; regras de visitante, entrega e retirada são respeitadas; casos de fronteira das faixas testados; nenhuma compra é criada nesta etapa.

## O que esta sprint ensina
Validação de checkout, cálculo monetário, dados não confiáveis do frontend, regras de entrega e testes de limites.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
