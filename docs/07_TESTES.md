# Ambiente de testes

Os testes de integração e migrations de teste usam exclusivamente o banco PostgreSQL local `leosburger_test`. Nunca use `DATABASE_URL` do ambiente de desenvolvimento para executá-los.

## Configuração local

1. Inicie o PostgreSQL local com `docker compose up -d postgres`.
2. Copie `.env.test.example` para `.env.test` e mantenha `TEST_DATABASE_URL` apontando para `127.0.0.1:5432/leosburger_test`. `.env.test` é ignorado pelo Git.
3. Aplique as migrations no banco isolado:

   ```sh
   npm run db:test:migrate
   ```

4. Execute a suíte:

   ```sh
   npm test -- --run
   ```

Para execução contínua, use `npm run test:watch`.

## Combos — administração e catálogo público

`tests/api/combos-admin.test.ts` cobre autorização ADMIN, proteção de origem nas escritas, CRUD, validação estrita, transações, remoção lógica e reativação de associações, ativação/desativação, snapshots históricos já existentes e contrato OpenAPI. `tests/api/combos.test.ts` cobre a elegibilidade pública e confirma que associações removidas não aparecem nem tornam o combo indisponível.

Execute os testes focados com:

```sh
npm test -- --run tests/api/combos-admin.test.ts tests/api/combos.test.ts
```

O checkout ainda não grava pedidos nem gera `composicaoHistorica`; portanto, os testes verificam somente a preservação de snapshots previamente gravados. A criação e a completude do snapshot devem receber testes de integração quando o checkout existir.

O carregador define `DATABASE_URL` a partir de `TEST_DATABASE_URL` e bloqueia qualquer endereço que não seja loopback ou cujo banco não seja exatamente `leosburger_test`. A configuração é aplicada também pelo `vitest.config.ts`, então invocações diretas do Vitest sem o carregador não podem recorrer ao `.env` de desenvolvimento.

## Perfil e endereços — Sprint 10

`tests/api/perfil.test.ts` cobre sessão obrigatória, consulta e atualização do próprio perfil, normalização e conflito de e-mail, rejeição de payloads/campos protegidos, criação/consulta/atualização/exclusão do endereço único, normalização e validação de CEP/estado, número textual `S/N`, unicidade, isolamento entre usuários, preservação do snapshot de pedido e contratos OpenAPI.

Execute o teste focado com:

```sh
npm test -- --run tests/api/perfil.test.ts
```

O teste cria usuários e pedidos temporários no banco isolado definido pelo wrapper e remove somente essas fixtures. Não requer migration adicional nem acessa o banco de desenvolvimento.

## Sprint 11 — endereços, cupons, frete e prévia

Cobertura implementada:

- `tests/unit/providers/geoapify.test.ts`: resposta GeoJSON, minimização de campos, resultados múltiplos/vazios, chave ausente, timeout, falha de rede/HTTP e resposta/coordenadas inválidas; usa `fetch` falso, sem chamadas reais.
- `tests/unit/services/validacao-endereco.test.ts`: confirma somente um candidato `full_match` com componentes coincidentes; resultados aproximados, incompletos, múltiplos ou ausentes permanecem pendentes.
- `tests/api/perfil.test.ts`: geocodificação em criação/edição autenticada, limpeza de coordenadas após mudança não confirmada e proteção do endereço próprio.
- `tests/api/checkout-endereco-visitante.test.ts`: ausência de autenticação, payload estrito, rejeição de coordenadas, resposta sem endereço/coordenadas e persistência hash-only para endereço pendente.
- `tests/unit/services/geocodificacao.test.ts`, `tests/banco/geocodificacao.test.ts` e `tests/banco/referencias-endereco.test.ts`: HMAC, falha fechada do banco, cache entre instâncias, cache miss concorrente, intervalo/quota diária, token hash-only, validade, consulta entre instâncias e limpeza.
- `tests/unit/services/adicionais.test.ts`, `tests/api/catalogo-admin.test.ts` e `tests/api/itens.test.ts`: esquema JSON, legado, padrão de quantidade, seleção ativa/pertencente, duplicidade e DTO público.
- `tests/unit/services/cupons.test.ts`, `tests/api/cupons-admin.test.ts` e `tests/api/checkout-preview.test.ts`: percentual/centavos/data local, autorização CRUD administrativo, elegibilidade, estados/datas/limite de uso, adicional adulterado, entrega pendente e ausência de efeitos comerciais.
- `tests/unit/services/faixas-frete.test.ts` e `tests/api/faixas-frete-admin.test.ts`: intervalos, cobertura 0–6 km, limite final, cálculo em linha reta, autorização e substituição transacional/concorrente. Os testes que alteram faixas globais usam lock advisory no banco isolado para serializar fixtures entre arquivos.
- `tests/unit/services/checkout-preview.test.ts` e `tests/api/checkout-preview.test.ts`: XOR item/combos, credenciais opcionais, CLIENTE/ADMIN, preços do banco, cupons, frete, estados não definitivos e ausência de pedido/uso de cupom.

Execute os testes focados com:

```sh
npm test -- --run tests/api/perfil.test.ts tests/api/checkout-endereco-visitante.test.ts tests/api/cupons-admin.test.ts tests/api/faixas-frete-admin.test.ts tests/api/checkout-preview.test.ts
```

Na validação local de 04/11/2026, `npm test -- --run` concluiu com 26 arquivos e 163 testes aprovados. Build, validação do Prisma, migrations de teste e `git diff --check` também passaram; nenhuma chamada real ao Geoapify foi feita.

## CI

O GitHub Actions fornece `TEST_DATABASE_URL` apontando para seu serviço PostgreSQL temporário, executa `npm run db:test:migrate` e roda a suíte com `npm test -- --run`. Não depende de arquivos `.env` locais.

## Criação de pedidos e pagamentos — plano das Sprints 12–15

Os fluxos abaixo continuam planejados; os testes devem usar exclusivamente `leosburger_test`, fixtures isoladas e limpeza direcionada.

Pendências de cobertura Sprint 11: sucesso da rota visitante com resposta realista de provider é coberto no serviço/provider, não validado contra serviço externo; endpoint público de validação ainda não tem rate limit específico; atribuições não podem ser verificadas em UI enquanto não houver frontend. Nenhum endereço comercial real nem coordenada de origem foi validado.

### Sprint 12 — `tests/api/pedidos.test.ts`

- Pedido de visitante/cliente e métodos permitidos; requisição financeira adulterada não altera cálculo.
- Pedido, linhas, adicionais/composição/endereço/distância/faixa/frete/cupom/desconto/total e token hash persistidos atomicamente.
- Rollback em falha intermediária; XOR item/combo e CHECKs.
- `Idempotency-Key`: retry de rede reutiliza pedido; payload incompatível `409`; concorrência não cria duplicatas. Referência temporária de endereço é autenticada, tem validade e não aceita coordenadas adulteradas.
- Resposta inicial perdida: recuperar via número do pedido + telefone; token novo invalida o anterior; OTP ausente no MVP é risco aceito.
- Snapshot completo inclui quantidade de adicional e faixa/limites de frete; faixas inativas não mudam pedidos antigos.
- Token tracking aleatório: banco contém somente hash; válido durante pedido ativo e por 30 dias após conclusão ou cancelamento; revogação/rotação e ausência de token em logs/URL.
- Alterar catálogo, endereço, faixa ou cupom depois da compra não altera snapshots.
- Migration incremental e integridade de novas tabelas/campos; sem reset.

### Sprint 13 — `tests/api/pagamentos.test.ts`

- Contrato de criar/consultar/processar evento e simulador: pendente, sucesso, falha, recusa, expiração e confirmação tardia.
- Cobrança inicial e no máximo uma tentativa adicional (duas no total), cada qual com cinco minutos desde confirmação de criação pelo backend; falha/recusa explícita encerra imediatamente; tentativa 2 após falha/recusa/expiração da primeira; expiração da segunda cancela automaticamente; falha/recusa da segunda não habilita terceira.
- Idempotência e concorrência: nenhuma criação simultânea/terceira tentativa; repetição idempotente não conta como nova tentativa; retries ficam no mesmo pedido e snapshot; pedido pago/cancelado bloqueia.
- Rate limit explícito na cobrança inicial e na segunda tentativa para visitante e CLIENTE; indisponibilidade Redis bloqueia operações sensíveis de criação/alteração.
- Confirmação presencial somente ADMIN, ator/data/result; sem confirmação manual de PIX.
- Tardia associada à tentativa original. Pedido cancelado mantém status operacional `CANCELADO`, tentativa fica `PAGO`, estado financeiro do pedido passa a `REEMBOLSO_PENDENTE` e reembolso aguarda execução manual.
- Confirmação repetida da mesma cobrança/evento: idempotência e preservação dos identificadores, sem nova tentativa ou reembolso automático. Duas cobranças distintas confirmadas: preservar cada tentativa/transação e encaminhar ocorrência à análise ADMIN, sem reembolso automático. Testar esses casos separadamente.
- Simulador proibido em produção; nenhuma resposta simula recebimento real.
- Token de visitante autoriza solicitar a segunda tentativa, sob rate limit e regras de expiração/quantidade.

### Sprint 14 — `tests/api/pedidos.test.ts` e `tracking.test.ts`

- Cliente autenticado lista/detalha apenas próprios pedidos; terceiro/inexistente sem enumeração.
- Tracking exige token válido por hash, não expirado e não revogado; retorna pedido/pagamento com minimização de dados, sem endereço completo.
- Token em header, nunca path/query; logs redigem token; abuso recebe `429`.
- Token não autoriza edição de endereço, produtos, quantidades, adicionais, preços ou snapshots; permite consulta, solicitar cancelamento (ADMIN decide) e retry PIX (limite 2).
- Token válido enquanto pedido ativo; expira 30 dias após conclusão ou cancelamento. Cobrir revogação e recuperação por número+telefone; token novo invalida o anterior.
- Limitar recuperação, solicitação de cancelamento e retry. Consulta por token continua disponível se Redis falhar, com limitação degradada em memória por processo, usando derivação do token e IP; verificar que segue protegida e documentar que não é distribuída.
- Snapshots e estados financeiro/operacional distintos permanecem estáveis.

### Sprint 15 — `tests/api/pedidos-admin.test.ts`

- Transições operacionais ADMIN válidas/inválidas e uso exato de `PREPARANDO`; cliente/visitante não altera status.
- Cliente autenticado ou visitante com token solicita cancelamento com motivo; ADMIN decide; status só muda na aprovação. Pedido `CONCLUIDO` nunca passa a `CANCELADO`.
- PIX não pago cancela sem reembolso; PIX pago cria registro pendente individual, iniciado/confirmado manualmente por ADMIN; presencial pago registra devolução manual/valor/ator/data.
- Vários registros de reembolso por pedido e vínculo à tentativa original; estrutura permite parcial, API não.
- Evento tardio em pedido cancelado: tentativa `PAGO`, pedido `REEMBOLSO_PENDENTE` financeiramente e `CANCELADO` operacionalmente. Duplicidade sem reembolso automático. Cancelamento não equivale a reembolso concluído.

## Dashboard e auditoria — Sprints 16–17

### Sprint 16 — `tests/api/dashboard.test.ts`

- Períodos dia/mês/semestre civil (jan–jun/jul–dez)/ano no fuso `America/Sao_Paulo`, timestamps UTC; limites locais, 30/06–01/07, viradas de ano e ano bissexto.
- Agregações no PostgreSQL: pedidos brutos, pagamentos efetivamente recebidos e reembolsos confirmados em dimensões separadas.
- Reembolso pendente não reduz valor recebido como se concluído; não pago não aparece como recebido; cancelado e pago/reembolsado exigem métricas separadas.
- Métodos PIX, cartão presencial, dinheiro; tentativas múltiplas não duplicam valor de pedido/pagamento.
- Dados simulados marcados claramente como simulação, não recebimento real.
- Sem dados, descontos, taxa histórica, cancelamento e reembolso; consultas não multiplicam total por joins de linhas.

### Sprint 17 — integração, segurança e desempenho

- Autorização, isolamento, cookies/CORS/CSRF; força de token e ausência de plaintext/hash em respostas/logs.
- Rate limit `429` para login, criação de pedido, primeira cobrança PIX, segunda tentativa PIX, pagamento, cupom, recuperação do token, cancelamento e recuperação de senha se existir; cobrir visitantes e autenticados; não inventar números.
- Memória no dev/testes; Redis compartilhado em produção. Fail-closed nas operações protegidas de alteração se Redis cair; GET por token permanece disponível com fallback local por processo e continua protegido. Propor limites justificados para aprovação antes de produção.
- Repetição, concorrência, transações/rollback, idempotência, evento tardio, retries, status/reembolso e reconciliação.
- Avaliar OTP como reforço futuro, sem implementar no MVP; registrar risco aceito da recuperação por número+telefone.
- Tentativas adversariais em preço, subtotal, desconto, elegibilidade, frete, status e autorização.
- Desempenho medido: latência HTTP, SQL, query count, conexões e uso; verificar N+1, aggregates no DB e `EXPLAIN ANALYZE` em queries críticas. Não exigir otimização sem gargalo evidenciado.
- Testes não imprimem tokens, secrets, endereço completo ou payload de provedor.

## Sprint 18 — checklist pré-produção

Sem provedor real escolhido ou integração afirmada. Revisar secrets, simulador desabilitado em produção, Redis compartilhado/fail-closed e GET por token disponível, health/monitoramento, backup/restauração, logs redigidos, limites aprovados, rollout/rollback e critérios de autenticação/idempotência/reconciliação futura. Não alterar CI sem problema concreto.
