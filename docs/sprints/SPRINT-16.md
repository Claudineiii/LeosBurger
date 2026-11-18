# Sprint 16 — Dashboard e fechamentos

**Estado:** Implementada localmente e validada; suíte e build aprovados. O script npm de testes permanece limitado pelo erro ambiental de `tsx`/`os.userInfo`.

## Objetivo e contrato

Contrato `GET /admin/dashboard?periodo=dia|mes|semestre|ano&referencia=...`, ADMIN-only. As fronteiras de calendário são `America/Sao_Paulo`; timestamps persistidos em UTC por convenção da aplicação (as colunas atuais são `TIMESTAMP(3)` sem fuso). Agregações ficam no PostgreSQL.

`semestre` é semestre civil: janeiro a junho ou julho a dezembro. Construir limites no calendário `America/Sao_Paulo` e converter para instantes UTC antes da consulta.

Referências aceitas: `dia=YYYY-MM-DD`, `mes=YYYY-MM`, `semestre=YYYY-S1|YYYY-S2` e `ano=YYYY`. O início é inclusivo e o fim exclusivo. Referências inválidas (incluindo dias inexistentes) recebem `400`.

## Métricas separadas

- **Pedidos/bruto:** valores e contagens por data de criação, status operacional, modalidade e método escolhido; cancelamentos identificados em separado.
- **Recebimentos:** somar cada tentativa efetivamente aprovada/confirmada uma vez pela chave primária da cobrança, usando data de confirmação. Cobranças distintas pagas no mesmo pedido contam individualmente; evento repetido não cria outra tentativa.
- **Reembolsos:** valor aparece como devolvido só após confirmação efetiva; pendente permanece separado. Classificar pela tentativa original vinculada quando possível.
- **Líquido/resultado efetivo:** somente pagamentos reais confirmados menos reembolsos reais confirmados. Simulações e origens não classificadas ficam fora da fórmula. Não subtrair cancelamento sem devolução nem reembolso pendente.
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

## Implementação local

`GET /admin/dashboard` exige ADMIN e agrega no PostgreSQL em consultas independentes de pedidos, tentativas e reembolsos. As quatro agregações de pedidos não se juntam a relações financeiras. A consulta de reembolsos usa LEFT JOIN por FK para a única tentativa original (sem multiplicar uma ocorrência); a consulta de pagamentos agrega linhas de tentativa/cobrança. O bruto usa `Pedido.criadoEm` e `Pedido.total`; cancelados são também discriminados sem subtração automática. Recebimentos confirmados usam status `PAGO` e `encerradoEm` (data em que o backend registrou a confirmação), cada linha de cobrança uma vez; dois IDs de tentativa pagos no mesmo pedido contam duas vezes, enquanto replay do evento mantém uma só linha.

Simulação é reconhecida pelo identificador `sim-` gerado pelo `SimuladorPagamentos` em evento `PAGO`, em qualquer método. Recebimentos simulados são exibidos separados dos recebimentos reais. Um recebimento é classificado como real quando o método é presencial e a auditoria contém `CONFIRMACAO_PRESENCIAL_ADMIN`; PIX sem identificador de simulação fica `naoClassificado`, pois não há gateway real nem campo que prove origem de provedor no contrato atual. Nunca entra no líquido efetivo. Reembolsos usam a FK para classificar sua origem: tentativa simulada → simulado; tentativa presencial paga com auditoria de ADMIN → real; FK ausente ou PIX de origem não comprovada → não classificado. O líquido é `recebimentos reais confirmados - reembolsos reais confirmados`.

Pagamentos pendentes são tentativas com `criadoEm` no período e status atual `PENDENTE`; pedido pendente não é usado como substituto. Para PIX, também exige `confirmadaEm IS NOT NULL` e `expiraEm > CURRENT_TIMESTAMP`, excluindo criação de cobrança incompleta e vencimento ainda não processado pelo serviço da Sprint 13. Falha e expiração persistidas são excluídas pelo próprio status. Reembolso confirmado usa `confirmadoEm`/`valorConfirmado`; pendente usa `iniciadoEm`/`valor`. Pendências não entram no líquido.

A API expõe totais por status, modalidade e método selecionado, cancelamentos, pagamentos reais/simulados/não classificados e reembolsos confirmados/pendentes também separados por origem e método. Transações PIX não simuladas ficam não classificadas até existir informação confiável de provedor. Não há cache, tabela ou migration de dashboard.

`tests/api/dashboard.test.ts` cobre conversão UTC independente do timezone da máquina, troca de semestre, virada de ano, ano bissexto, data inválida e fronteira histórica de horário de verão; autorização; duas cobranças no mesmo pedido e replay do evento; pagamento presencial confirmado por ADMIN; simulados, PIX não classificável, reembolso simulado/real/não classificável e pendente; e pagamentos pendentes físicos, PIX incompleto, PIX vencido sem expiração processada e falha explícita.

Validação final desta revisão: Vitest direto serial (`--maxWorkers=1`; `vitest.config.ts` exige `leosburger_test`), 32 arquivos/224 testes aprovados; build TypeScript, `npx prisma validate`, status das 9 migrations no `leosburger_test` e `git diff --check` aprovados. `npm test -- --run` falha antes da suíte com `uv_os_get_passwd returned ENOMEM` de `tsx`/`node:os.userInfo()`.

Desempenho observado no banco isolado: request da fixture ~64–76 ms; a rota executa 7 consultas agregadas/leitura mais uma consulta de identidade ADMIN (contagem pelo fluxo de código), sem N+1. `EXPLAIN (ANALYZE, BUFFERS)` das consultas financeiras completas deu 0,216 ms para tentativas (21 buffer hits) e 0,181 ms para reembolsos (7 buffer hits), sem leituras físicas; não havia reembolsos correspondentes no período analisado. Pool observado em consulta separada: uma conexão do Prisma CLI, não uma medição do pool da API. O banco de teste é pequeno e o resultado não representa carga de produção nem justifica índice novo.
