# Sprint 12 — Criação transacional de pedidos e tracking

**Estado:** Implementada e validada localmente.

## Objetivo

Criar pedido e linhas atomicamente com snapshots imutáveis, idempotência e token seguro de acompanhamento para visitante. A primeira tentativa PIX será ligada ao checkout na Sprint 13; retries não criam novo pedido.

## Pré-requisitos e migration

1. Reinspecionar schema, migrations, CHECK constraints e contratos implementados na Sprint 11.
2. Preservar subtotal, desconto, taxa, total, método, endereço, cliente, adicionais e composição históricos.
3. Projetar alteração aditiva em `pedidos` para hash do token de tracking, expiração e revogação. Token plaintext não é persistido.
4. Persistir idempotency key da criação (e hash do payload canônico ou equivalente) com unicidade e escopo claros.
5. Manter exatamente os estados operacionais atuais/aprovados, incluindo `PREPARANDO`; não introduzir `EM_PREPARACAO`.
6. Definir o token válido enquanto o pedido estiver ativo e sua expiração 30 dias após conclusão ou cancelamento; suportar revogação/rotação.
7. O pedido já persiste `distanciaKm` e `taxaEntrega`, mas não a faixa aplicada. Modelar snapshot da faixa para preservar sua identidade/limites comerciais após edição da configuração.
8. Recuperação do token usa número do pedido e telefone informado na compra; a emissão de token novo invalida o hash/token anterior. OTP SMS/WhatsApp não faz parte do MVP; registrar como risco residual conhecido e aceito, com rate limiting na Sprint 17.

## Contrato proposto

`POST /pedidos` recebe a intenção de checkout validada: linhas, adicionais/quantidades, modalidade, referência temporária protegida de endereço visitante ou endereço próprio com coordenadas válidas quando for entrega, método e código do cupom. Backend revalida todos os dados e recalcula no momento da gravação. Visitante pode escolher ENTREGA ou RETIRADA sem conta; a geocodificação ocorre previamente, nunca na criação final nem no pagamento. Resposta `201` contém pedido/snapshot público; para visitante entrega token aleatório na criação e instrui a guardá-lo. Se a resposta se perder, recuperar token via número+telefone; a rotação invalida o anterior. Repetição idempotente retorna o mesmo recurso. Na Sprint 13, o fluxo também inicia a cobrança PIX inicial e inclui seu estado público; falha do provedor não duplica o pedido.

Se o cliente alterar produtos, adicionais, endereço, cupom ou modalidade após criar o pedido, não editar/reutilizar o snapshot: encerrar pedido antigo pelas regras e abrir novo pedido. Método financeiro poderá ser tentado novamente conforme Sprint 13, sem duplicar o pedido.

## Arquivos

- Existentes: `src/app.ts`, `src/plugins/prisma.ts`, rotas de catálogo/endereços, `prisma/schema.prisma`, migrations, `tests/api/`, `tests/banco/integridade.test.ts`.
- Planejados: `src/routes/pedidos.ts`, `src/services/checkout.ts` somente se compartilhamento justificar, migration aditiva, `tests/api/pedidos.test.ts`.
- A tabela `tentativas_pagamento` é criada/planejada na Sprint 13; não duplicar colunas de tentativa em `Pedido`.

## Passos executáveis

1. Definir Zod estrito, XOR item/combo e `Idempotency-Key`; adicional recebe ID e quantidade; não aceitar valores financeiros/autorização do frontend.
2. Buscar preço, adicionais ativos e limites, combo, elegibilidade/mínimo do cupom, faixa de frete e identidade oficiais.
3. Exigir coordenadas válidas para ENTREGA; receber e validar a referência temporária protegida do visitante ou endereço próprio validado. Não chamar geocoder na criação final nem aceitar coordenadas/correção manual de ponto nessa etapa. Visitante sem referência válida para entrega ainda pode escolher retirada.
4. Preparar token criptograficamente aleatório; persistir apenas hash, validade enquanto pedido ativo, expiração 30 dias após conclusão ou cancelamento e estado de revogação; excluir plaintext de logs. Rotação por recuperação invalida imediatamente o anterior.
5. Em transação, persistir pedido, linhas/snapshots, histórico operacional inicial e idempotência; garantir rollback total.
6. Persistir distância, faixa aplicada/limites e valor do frete; código e desconto efetivamente aplicados; snapshots de adicionais incluem nome/preço/quantidade.
7. Garantir repetição de chave/payload equivalente retorna o mesmo pedido; chave incompatível `409`; concorrência não cria duplicatas. Resposta inicial perdida é resolvida pelo fluxo de recuperação do token.
8. Não manter transação aberta durante chamadas externas; revalidar dados financeiros no write.
9. Não criar refund/tentativas PIX aqui; Sprint 13 trata pagamento e Sprint 15 seus reembolsos.
10. Criar e validar migration incremental em banco isolado; preservar constraints existentes.

## Testes e aceite

`tests/api/pedidos.test.ts`: visitante com entrega/retirada sem conta e PIX exclusivo; referência de endereço válida/expirada/adulterada; método proibido; snapshot completo incluindo endereço, adicionais/quantidade/faixa; falha entre pedido/linha faz rollback; item/preço/status mudou entre prévia e criação; retry e chave incompatível; concorrência; token aleatório, hash-only, válido enquanto ativo e por 30 dias após conclusão ou cancelamento, revogação e rotação por número+telefone; token/segredos ausentes de logs; token anterior inválido após rotação; alteração da compra gera novo pedido; migrations e constraints.

Aceite: nenhuma linha parcial/duplicada; snapshots intactos, incluindo endereço, faixa de frete e quantidades de adicionais; token plaintext nunca persistido/logado; rotação segura invalidando o token antigo; validade enquanto ativo e limite de 30 dias após conclusão ou cancelamento; visitante consegue solicitar entrega/retirada sem conta, com endereço validado previamente; testes de integração/build/Prisma passam.

## Implementação da Sprint 12

- `POST /pedidos` foi registrado em `src/routes/pedidos.ts`; exige chave UUIDv4 e corpo Zod estrito. Retorna `201` na criação e `200` no replay idêntico; payload ou escopo diferente com a mesma chave retorna `409`.
- `src/services/pedidos.ts` executa revalidação e criação em transação serializável. Reutiliza a prévia/calculadora da Sprint 11 e persiste pedido, linhas, histórico inicial, dados históricos de cliente/endereço, adicionais, composição do combo, valores, faixa, regras do cupom e uso do cupom na mesma transação.
- A migration aditiva `20261105120000_pedidos_idempotencia_tracking` registra chave única, hashes do payload/escopo, hash do token, expiração/revogação, snapshot da faixa e regras do cupom. Não cria tabela e não altera/remova as 11 CHECK constraints anteriores.
- Visitante informa nome/telefone e só pode usar PIX; autenticado usa os dados da conta e os métodos permitidos; ADMIN recebe `403`. A criação não cobra PIX, não chama Geoapify e não cria tentativas.
- `POST /pedidos/acompanhamento/recuperar` compara número e telefone normalizado, responde com `404` genérico quando inválido e rotaciona o hash em transação com bloqueio da linha. O token plaintext só é retornado ao criar/rotacionar; replay idempotente não o reemite.
- A chave de idempotência é retida enquanto o pedido existir. Não há rate limiting no endpoint de recuperação nesta sprint. O vencimento é respeitado pela recuperação, mas a gravação automática do prazo de 30 dias após transição para `CONCLUIDO`/`CANCELADO` dependerá do fluxo administrativo futuro de status.

## Validação local

- `npm test`: 27 arquivos, 169 testes aprovados (163 legados e 6 novos).
- `npm run build`: aprovado.
- `npx prisma validate`: schema válido com Prisma 6.19.3.
- `npm run db:test:migrate`: migration aplicada somente em `leosburger_test`.
- `git diff --check`: aprovado; nenhum arquivo foi colocado em stage e não houve commit/push.
