# Sprint 13 — Pagamento simulado e transições de status

**Estado:** Executar após criação de pedidos.

## Objetivo
Simular o resultado do pagamento e implementar as transições aprovadas sem integrar gateway real.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Conferir enums reais e os contratos de pedido existentes. Não renomear estados.
2. Utilizar os status: `PENDENTE`, `CONFIRMADO`, `PREPARANDO`, `PRONTO`, `SAIU_PARA_ENTREGA`, `CONCLUIDO`, `CANCELADO`.
3. Aplicar o fluxo de entrega: PENDENTE → CONFIRMADO → PREPARANDO → PRONTO → SAIU_PARA_ENTREGA → CONCLUIDO.
4. Aplicar o fluxo de retirada: PENDENTE → CONFIRMADO → PREPARANDO → PRONTO → CONCLUIDO.
5. Permitir transição para CANCELADO de qualquer estado anterior a CONCLUIDO.
6. Antes de codificar a autorização, consultar a regra de negócio original. Definir quais papéis podem executar cada transição; se o documento não resolver, apresentar alternativas ao usuário. Não inventar permissões.
7. Implementar apenas simulação de pagamento, sem gateway, dados reais de cartão ou alegações de recebimento financeiro real.
8. Registrar cada mudança de status no histórico JSON do pedido, garantindo que o formato continue sendo uma lista válida.
9. Testar transições válidas e inválidas para entrega e retirada, cancelamento, tentativa de concluir sem passar pelas etapas necessárias e acesso não autorizado.
10. Executar suíte completa e build; atualizar documentação de status e pagamento.

## Arquivos envolvidos
- `Rotas de simulação e atualização de status, regras de negócio, testes e docs`

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
- [ ] Fluxos seguem tipo de entrega; cancelamento respeita a regra aprovada; permissões estão explícitas; histórico registra mudanças; sem pagamento real.

## O que esta sprint ensina
Máquina de estados, autorização por papel, histórico JSON e diferença entre pagamento simulado e dinheiro recebido.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
