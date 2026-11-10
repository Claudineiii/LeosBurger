# Sprint 15 — Administração, cancelamentos e reembolsos

**Estado:** Planejada; depende de pedidos/tentativas das Sprints 12–14.

## Objetivo

Implementar as transições administrativas de status e o fluxo auditável de solicitação/decisão de cancelamento, com reembolso separado. Cliente solicita com motivo; ADMIN decide. Cliente não cancela nem altera estado operacional diretamente.

## Matriz operacional

Todas as transições administrativas de status operacional exigem ADMIN (cliente/visitante somente solicita cancelamento). A única transição automática é o cancelamento aprovado após expiração da segunda tentativa PIX. Estados exatos: `PENDENTE`, `CONFIRMADO`, `PREPARANDO`, `PRONTO`, `SAIU_PARA_ENTREGA`, `CONCLUIDO`, `CANCELADO`. O backend mantém estado operacional separado do financeiro. Cancelamento só pode ocorrer antes de `CONCLUIDO`; não há transição de `CONCLUIDO` para `CANCELADO`. Cada mudança é validada e registrada atomicamente:

| Estado atual | Próximo estado permitido |
|---|---|
| `PENDENTE` | `CONFIRMADO` por decisão ADMIN, independentemente do estado financeiro, ou `CANCELADO` após decisão ADMIN |
| `CONFIRMADO` | `PREPARANDO`, ou `CANCELADO` após decisão ADMIN |
| `PREPARANDO` | `PRONTO`, ou `CANCELADO` após decisão ADMIN |
| `PRONTO` | `SAIU_PARA_ENTREGA` para entrega; `CONCLUIDO` para retirada; ou cancelamento decidido |
| `SAIU_PARA_ENTREGA` | `CONCLUIDO` ou cancelamento decidido |
| `CONCLUIDO` | Terminal; não retorna a `CANCELADO`. Problemas posteriores seguem processo financeiro de reembolso |
| `CANCELADO` | Terminal; não reabrir por operação normal |

A expiração da segunda tentativa PIX pode cancelar automaticamente o pedido e deve ser registrada como causa automática, distinta de cancelamento solicitado pelo cliente e aprovado pelo ADMIN. Falha ou recusa explícita da segunda tentativa impede terceira cobrança, mas não é a regra de cancelamento automático por expiração.

O enum real atual já usa `PREPARANDO`; não criar renomeação para `EM_PREPARACAO`. Estado financeiro não deve ser inferido apenas do status operacional.

## Contratos de API propostos

- `GET /admin/pedidos`, `GET /admin/pedidos/:id`: somente ADMIN; filtros/paginação validados e respostas com `select`.
- `PATCH /admin/pedidos/:id/status`: mudança conforme matriz e modalidade; compare-and-set, transação e append ao histórico.
- `POST /pedidos/:id/solicitacoes-cancelamento`: cliente dono ou visitante com token válido envia motivo; registrar solicitante e timestamp do servidor. Não mudar status até decisão ADMIN. Pedido concluído não aceita cancelamento; problemas posteriores são tratados financeiramente.
- `PATCH /admin/pedidos/:id/solicitacoes-cancelamento/:solicitacaoId`: ADMIN aprova/nega e registra autor, timestamp e justificativa quando aplicável. ADMIN pode decidir inclusive em pronto/rota. Solicitação negada conserva status operacional.
- `PATCH /admin/pedidos/:id/tentativas-pagamento/:tentativaId`: confirmação presencial aprovada/recusada com ator e data; PIX não pode ser confirmado manualmente.
- `POST /admin/pedidos/:id/reembolsos`: ADMIN registra início manual de reembolso PIX, associado ao pedido e tentativa/transação original.
- `PATCH /admin/pedidos/:id/reembolsos/:reembolsoId`: registra confirmação manual, valor, responsável, data e identificador externo se houver.
- Devolução presencial registra ocorrência própria com valor, responsável e data; não é confirmação PIX.
- Reembolso PIX permanece pendente até confirmação manual registrada; não criar webhook/provedor real nesta Sprint. Alterar status do pedido não finaliza reembolso.

**Visitantes:** token válido permite solicitar cancelamento, mas apenas ADMIN decide. Token não autoriza alteração de produto, endereço, quantidade, adicional, preço ou snapshot.

## Cancelamento e reembolso

- Registrar motivo do cliente, solicitante e horário; decisão, ADMIN responsável, horário e justificativa quando aplicável; resultado financeiro.
- Cancelamento aprovado não implica reembolso concluído.
- PIX não pago: cancelar sem reembolso.
- PIX pago: criar registro individual de reembolso pendente; ADMIN inicia manualmente e confirma execução. Não marcar concluído somente por aprovar cancelamento.
- Cartão/dinheiro presencial pago: registrar cada devolução manual com valor, ADMIN responsável e data.
- Criar entidade/tabela `reembolsos` com registros individuais, vários por pedido, vinculados à tentativa/transação original quando aplicável; guardar valor, estado, motivo, ator, datas e identificador externo opcional. Estruturalmente representar parcial, mas não permitir parcial no MVP.
- Pedido concluído não admite cancelamento nem exceção que mude o status; problemas posteriores são ocorrências financeiras auditadas.
- Confirmação tardia de PIX em pedido cancelado: tentativa original fica `PAGO`, estado financeiro do pedido passa a `REEMBOLSO_PENDENTE` e status operacional continua `CANCELADO`; execução manual do reembolso. Nunca ignorar nem transferir a outra compra.
- Se duas tentativas forem pagas, preservar ambas, registrar ocorrência de pagamento duplicado e encaminhar à análise ADMIN; não criar reembolso automático.
- Reembolsos e decisões financeiras devem ser idempotentes, atômicos e auditados. Integração real de estorno PIX não existe nem está escolhida.

## Dados/arquivos planejados

- Existentes: `src/app.ts`, `src/plugins/autenticacao.ts`, `prisma/schema.prisma`, migrations, `tests/api/`.
- Planejados: `src/routes/pedidos-admin.ts`, possível `src/services/pedidos.ts` se transições forem compartilhadas/complexas; `tests/api/pedidos-admin.test.ts`.
- Persistir solicitação/decisão como eventos estruturados no histórico do pedido; migration da tabela `reembolsos` é obrigatória para preservar cada ocorrência e permitir múltiplos registros por pedido.

## Passos, testes e aceite

1. Implementar matriz operacional exatamente com `PREPARANDO`; todas as transições operacionais administrativas são controladas por ADMIN e independentes do estado financeiro, exceto cancelamento automático aprovado por expiração da segunda tentativa; rejeitar transições inválidas e sempre bloquear conclusão → cancelamento.
2. Implementar solicitação de cliente/visitante e decisão ADMIN; status só muda após aprovação e dentro dos limites válidos.
3. Criar migration incremental da tabela `reembolsos`, FK pedido/tentativa, integridade de valor/estado e índices de consulta; preservar todas as constraints atuais.
4. Implementar registro de reembolso PIX iniciado manualmente por ADMIN, confirmação manual e devolução presencial; parcial permanece proibido na API.
5. Integrar eventos de pagamento tardio e pagamento duplicado às ocorrências/auditoria sem reabrir status nem executar reembolso automático de duplicidade.
6. Testar matriz válida/inválida, retirada/entrega, concorrência/replay, ADMIN, token visitante, recusa/aprovação, cancelamento antes/depois de CONCLUIDO, reembolso múltiplo, late payment e pagamento duplicado.
7. Confirmar valores e snapshots da compra imutáveis e estado operacional separado do financeiro.

Aceite: `PREPARANDO` sem renomeação; cancelamento somente antes de `CONCLUIDO`; pedido concluído não muda status; solicitação visitante requer ADMIN para efetivar; registros individuais de reembolso preservam múltiplas ocorrências; PIX iniciado/confirmado manualmente; parcial desabilitado; atrasos/duplicidades auditados e sem reembolso automático indevido; testes/build/Prisma passam.
