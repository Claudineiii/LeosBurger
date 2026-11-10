# Sprint 16 — Dashboard e fechamentos

**Estado:** Planejada; depende de pedidos, tentativas, cancelamentos e reembolsos consistentes.

## Objetivo e contrato

Proposta `GET /admin/dashboard?periodo=dia|mes|semestre|ano&referencia=...`, ADMIN-only. As fronteiras de calendário são `America/Sao_Paulo`; timestamps persistidos em UTC por convenção da aplicação (as colunas atuais são `TIMESTAMP(3)` sem fuso). Agregações ficam no PostgreSQL.

`semestre` é semestre civil: janeiro a junho ou julho a dezembro. Construir limites no calendário `America/Sao_Paulo` e converter para instantes UTC antes da consulta.

## Métricas separadas

- **Pedidos/bruto:** valores e contagens por data de criação, status operacional, modalidade e método escolhido; cancelamentos identificados em separado.
- **Recebimentos:** somar apenas tentativas efetivamente aprovadas/confirmadas, usando data de confirmação. Nunca somar cada tentativa quando um pedido tiver retries; contabilizar pagamento único.
- **Reembolsos:** valor só aparece como reembolsado na confirmação efetiva; reembolso pendente permanece em pendente. Separar PIX e devolução manual presencial conforme dados auditados.
- **Líquido/resultado:** somente fórmula explicitamente documentada derivada de valores recebidos menos reembolsos confirmados. Não subtrair cancelamento que não teve reembolso; não tratar reembolso pendente como concluído.
- Pagamento simulado não movimenta dinheiro. Exibir estado/origem de simulação claramente; nunca rotular como recebimento real.

Não é relatório contábil nem PDF. Não adicionar tabela de dashboard/cache sem medição e decisão.

## Arquivos

- Existentes: `src/app.ts`, `src/plugins/prisma.ts`, `prisma/schema.prisma`, migrations.
- Planejados: `src/routes/dashboard.ts`, `tests/api/dashboard.test.ts`; serviço só se lógica compartilhar regra complexa.
- Mudanças de índices dependem de análise de consultas e evidência de desempenho.

## Passos

1. Definir schemas de query/resposta e fórmulas com timezone no contrato.
2. Construir intervalos de período conforme calendário São Paulo, converter bounds para UTC e testar limites civis (inclusive/exclusivo), incluindo troca de semestre.
3. Agregar no PostgreSQL por timestamps corretos: pedido criado, pagamento aprovado, reembolso confirmado.
4. Separar status/modalidade/método e impedir inflação por joins de itens/tentativas.
5. Incluir bruto, recebido, pendente e reembolso confirmado em dimensões diferentes.
6. Usar `select`/agregações, evitar N+1 e buscar somente métricas necessárias.
7. Medir latência HTTP/SQL, quantidade de consultas, conexões e consumo antes de criar índices/otimizações; executar `EXPLAIN ANALYZE` em query crítica.
8. Documentar o simulador e limitações de dados.

## Testes e critérios de aceite

`tests/api/dashboard.test.ts`: ADMIN/CLIENTE, dia/mês/semestre civil/ano em `America/Sao_Paulo`, bounds UTC, 30 de junho/1 de julho, viradas de ano, ano bissexto, sem dados, cancelamento, tentativas múltiplas (máximo duas PIX), pagamento confirmado/pendente, registros múltiplos de reembolso e pendente/confirmado, presencial/manual vs PIX, taxa/desconto e query que não multiplica valores.

Aceite: bruto/recebido/reembolsado separados e reproduzíveis; calendário São Paulo; valores simulados rotulados; agregações no DB; sem PDF/cache; testes e build passam.
