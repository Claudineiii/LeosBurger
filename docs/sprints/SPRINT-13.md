# Sprint 13 — Tentativas de pagamento e simulador

**Estado:** Planejada; depende de pedidos transacionais da Sprint 12. Provedor PIX real não escolhido.

## Objetivo

Implementar tentativas financeiras individuais ligadas ao pedido, retries sem duplicação, contrato genérico de provedor e simulador para desenvolvimento/testes. Não integrar gateway ou cartão online.

## Modelagem/migration

Criar migration aditiva para `tentativas_pagamento`, FK para `pedidos`, com método, estado, número sequencial, instante de confirmação da criação, expiração e idempotency key. Identificador externo é opcional apenas quando houver provedor real; não inventar/configurar agora. A política PIX é fixa: duas tentativas por pedido no total (cobrança inicial e uma adicional); cada uma expira cinco minutos após a confirmação de criação pelo backend. Falha ou recusa explícita encerra imediatamente a tentativa, sem aguardar os cinco minutos restantes. A tentativa 2 fica disponível quando a primeira expira ou termina em falha/recusa. A expiração da tentativa 2 cancela automaticamente o pedido; falha/recusa da segunda não habilita terceira cobrança.

Tentativas presenciais iniciam pendentes; ADMIN autorizado confirma aprovado/recusado com ator e data. PIX aprovado somente por simulador isolado em dev/teste ou futuramente por notificação autenticada do provedor. Estado financeiro nunca sobrescreve `Pedido.status` operacional.

Falha/recusa/expiração da primeira tentativa libera a segunda; nunca criar terceira. Pedido pago ou cancelado não aceita outra cobrança. Chave repetida retorna a mesma tentativa/cobrança e não conta como tentativa nova. Garantir com transação/controle concorrente que não existam duas tentativas PIX simultâneas e que duas requisições concorrentes não ocupem ambas o mesmo número. Proteger explicitamente a cobrança inicial e a segunda tentativa com rate limit para CLIENTE e visitante.

O contador e os instantes são persistidos no backend. `expiraEm` parte do instante em que o backend confirma a criação da tentativa, e não do início da chamada ao provedor. Após a expiração da tentativa 2, cancelar `Pedido.status` para `CANCELADO` e registrar evento automático no histórico; estado financeiro permanece separado.

## Contrato de provedor

Definir primeiro o contrato genérico independente de fornecedor para criar cobrança, consultar estado, solicitar/confirmar resultado e processar evento normalizado. Regras de negócio dependem apenas dessa interface; adaptadores não expõem SDK/modelo proprietário. Em seguida implementar o simulador contra o contrato.

O simulador reproduz pendente, sucesso/aprovação, falha, recusa, expiração e confirmação tardia. Deve ser impossível habilitá-lo em produção; iniciar produção com essa configuração falha explicitamente. Não criar webhook HTTP vazio.

## Repetição e exceção tardia

- Retry gera nova `TentativaPagamento`, permanece no mesmo `Pedido` e conserva snapshot/número.
- Repetição idempotente da mesma solicitação não cria nova cobrança; eventos repetidos da mesma cobrança são deduplicados e auditados, preservando IDs de evento/transação.
- Pedido pago/cancelado não recebe tentativa nova; máximo duas tentativas PIX.
- Confirmação PIX tardia sempre identifica a tentativa original. Se pedido cancelado, a tentativa fica `PAGO`, o estado financeiro do pedido passa a `REEMBOLSO_PENDENTE` e o status operacional permanece `CANCELADO`; ADMIN conduz o reembolso manual. Não associar a outro pedido nem ignorar.
- Distinguir confirmação repetida da mesma cobrança (evento duplicado) de confirmação de duas cobranças distintas (duas operações vinculadas às respectivas tentativas). Preservar identificadores e registrar ocorrência para análise ADMIN em ambos os casos; não efetuar reembolso automaticamente.
- Uma transação financeira só atualiza a tentativa/pedido quando esperado; falha externa não é resposta de sucesso.
- O token de visitante autoriza solicitar a segunda tentativa PIX, sob rate limit, idempotência e as mesmas regras de expiração/quantidade; token não altera dados do pedido.

## Arquivos e API planejados

- Existentes: `src/app.ts`, `src/plugins/prisma.ts`, `src/plugins/autenticacao.ts`, `prisma/schema.prisma`, migrations e `tests/api/`.
- Planejados sob demanda: `src/services/pagamentos/contrato.ts`, `src/services/pagamentos/simulador.ts`, extensão de `src/routes/pedidos.ts`, `tests/api/pagamentos.test.ts`; migration para tabela.
- Proposta: `POST /pedidos/:id/tentativas-pagamento` para solicitar a segunda tentativa, `GET /pedidos/:id/tentativas-pagamento` (proprietário/ADMIN), confirmação presencial por endpoint ADMIN. CLIENTE dono ou visitante com token válido podem solicitar a segunda tentativa. OpenAPI não deve expor operação de confirmação PIX manual.

## Passos, testes e aceite

1. Construir contrato genérico de pagamento antes do simulador; mapear estados internos neutros a fornecedor.
2. Definir status/constraints, número de tentativas 1/2, início do prazo, expiração e cancelamento automático conforme migration/schema.
3. Implementar simulador contra o contrato único.
4. Implementar criação idempotente da cobrança inicial e da segunda tentativa; limitar ambas explicitamente, bloquear concorrência por pedido e testar retry idempotente sem nova cobrança.
5. Implementar confirmação presencial auditada; sem dado de cartão.
6. Testar estados, falha/recusa imediata, atraso, concorrência, idempotência, exatamente duas tentativas, dois prazos de cinco minutos, cancelamento automático após expiração da segunda, pedido pago/cancelado, evento repetido da mesma cobrança, duas cobranças distintas confirmadas, evento tardio e simulador proibido em produção.
7. Validar pagamento tardio em pedido cancelado (tentativa original PAGO, pedido REEMBOLSO_PENDENTE financeiramente e CANCELADO operacionalmente), vínculo original e ausência de reembolso automático tanto para evento duplicado quanto para duas cobranças distintas.
8. Atualizar OpenAPI, migration, testes de integridade e documentação.

Aceite: cobrança inicial e no máximo uma tentativa adicional (duas no total), cada uma com prazo de cinco minutos iniciado na confirmação do backend; falha/recusa encerra imediatamente; segunda disponível após falha/recusa/expiração da primeira; expiração da segunda cancela automaticamente e falha/recusa da segunda não permite terceira; rate limit protege ambas as cobranças para autenticados e visitantes; sem cobranças simultâneas ou criação por replay idempotente; simulador fora de produção; confirmações tardias e eventos duplicados preservados e distintos para auditoria, sem associação incorreta ou reembolso automático indevido. Integração real continua pendente.
