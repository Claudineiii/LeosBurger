# Sprint 17 — Segurança, integração e desempenho medido

**Estado:** Planejada após fluxos principais.

## Objetivo

Validar ponta a ponta checkout, dados financeiros, identidade, tokens, cupons, frete, tentativas, cancelamento/reembolso e dashboard; testar abuso, concorrência, falhas parciais e desempenho antes de homologação.

## Segurança e abuso

1. Revalidar JWT/cookies, papel atual, CORS `FRONTEND_ORIGIN`, writes e CSRF conforme cookies; usuário não modifica tipo próprio.
2. Isolar pedidos/endereço por usuário. Token visitor hash-only, válido enquanto pedido ativo e por 30 dias após conclusão ou cancelamento, revogável/rotacionável e com permissões estritas; recuperação por número+telefone sem OTP é risco conhecido/aceito. Avaliar OTP como reforço futuro, sem implementá-lo nesta fase.
3. Rate limit com resposta `429` para login, criação de pedido, primeira cobrança PIX, segunda tentativa PIX, pagamento, validação de cupom, recuperação do token, solicitação de cancelamento e recuperação de senha se implementada. Cobrir visitantes e autenticados; retry idempotente não gera cobrança/tentativa nova.
4. Armazenamento: memória em desenvolvimento, limites controlados/isolados em teste, Redis compartilhado em produção. Redis não é requisito local nem cache.
5. Se Redis estiver indisponível em produção, fail closed para as operações sensíveis que alteram estado: não executar desprotegidas. Consulta GET de pedido/status por token válido permanece disponível com fallback protegido em memória por processo, usando derivação do token e IP; documentar que esse fallback não oferece coordenação distribuída e usar proteção de borda quando disponível.
6. Não inventar limites numéricos. Preparar proposta de limites por operação com justificativa de risco/capacidade para aprovação antes de produção; testar isolamento por operação e instância.
7. Preços, adicionais, descontos, faixas e totais são recalculados no backend. Tentar forjar 50%, preço, elegibilidade, frete, status, confirmação e identidade.
8. ADMIN-only em configuração e decisões administrativas; acesso do cliente/visitante restrito ao próprio pedido e às permissões do token. Log de auditoria sem tokens, segredos, endereço completo ou payload desnecessário.

## Integridade financeira/concorrência

- Idempotência, no máximo duas tentativas PIX no total (inicial + adicional) com 5 minutos cada, falha/recusa imediata, concorrência, pagamento/cancelamento/reembolso. Expiração da segunda cancela automaticamente; falha/recusa da segunda não habilita terceira tentativa.
- Rollback em falha de pedido/itens/snapshot, cancelamento, tentativa e evento.
- Evento de pagamento tardio ligado à tentativa original: tentativa fica `PAGO`, pedido passa financeiramente a `REEMBOLSO_PENDENTE` e continua operacionalmente `CANCELADO`; reembolso manual. Nunca ignorar/reatribuir.
- Distinguir confirmação duplicada da mesma cobrança de duas cobranças distintas confirmadas; preservar IDs de eventos/transações, auditar e encaminhar à análise ADMIN sem reembolso automático em ambos os casos.
- Cliente/visitante solicita cancelamento; ADMIN decide. PIX pago, PIX não pago, devolução presencial, reembolso manual e múltiplos registros por pedido cobertos separadamente.
- Restrições de cupom mínimo/elegibilidade, frete/snapshot, adicionais com quantidade máxima, status PREPARANDO e dashboard no timezone aprovado.
- Geocodificação Geoapify: confirmar quota/termos atuais, atribuição, cache, limite agregado interno, sem autocomplete/lote e minimização dos dados enviados; validar critérios com endereços reais.
- Verificar as 11 CHECK constraints atuais e as novas da migration, sem enfraquecer regra existente.

## Desempenho

1. Medir latência HTTP, SQL, query count, pool/conexões e uso de recursos em cenários representativos.
2. Revisar N+1, usar Prisma `select`, dashboard agregado no PostgreSQL e `EXPLAIN ANALYZE` em queries críticas.
3. Criar/ajustar índices somente se filtros medidos justificarem; documentar baseline e resultado.
4. Não adicionar Redis Cache nem abstrações/índices preventivos sem gargalo evidenciado.
5. Documentar proposta justificada de limites de rate limit por operação para aprovação antes de produção.

## Arquivos/execução

Testes nas localizações existentes `tests/api/` e `tests/banco/`; plugins em `src/plugins/`; rotas em `src/routes/`. Revisar migrations, `docs/03_REGRAS_DE_NEGOCIO.md`, `docs/04_MODELO_DE_DADOS_E_INTEGRIDADE.md`, `docs/05_PLANO_DE_APIS.md` e `docs/07_TESTES.md`. CI não muda sem falha concreta.

Executar testes focados e suíte completa no banco isolado, build, Prisma validate, `git diff --check` e cenários de carga limitados ao ambiente apropriado; nunca imprimir secrets. Testar indisponibilidade Redis nas operações protegidas de alteração e confirmar bloqueio apropriado; GET por token continua disponível e protegido pelo fallback em memória por processo, que não é distribuído.

## Critérios de aceite

Isolamento/autorização e limites passam; no máximo duas tentativas PIX; atraso/duplicidade preservados; reembolsos individuais e atômicos; ameaças adversariais bloqueadas; Redis compartilhado e fail-closed testados, consulta por token disponível; proposta de limites sem números inventados pronta para aprovação; política Geoapify validada; desempenho medido e mudanças justificadas; sem regressões de constraints. Registrar risco residual aceito de recuperação por número+telefone sem OTP.
