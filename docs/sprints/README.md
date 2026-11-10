# LEOSBurger — Plano de Sprints do Backend

## Como usar

Os planos descrevem objetivos; use o estado documentado e verifique código/schema/testes para confirmar implementação. A Sprint 11 foi implementada localmente, com pendências externas de produção. Antes de cada sprint, conferir `git status`, código, migrations e testes reais. O backend fica em `src/` na raiz; não há `backend/src/` nem pasta de frontend encontrada. Confirmar o destino real da interface antes de começar trabalho frontend.

## Ordem

- Sprints 1–10: consultar `MAPA.md` e os respectivos arquivos para o estado conhecido.
- Sprint 11: adicionais em JSON, checkout prévio, Geoapify no fluxo de endereço, frete configurável e cupons administrados — implementada localmente; produção depende de validações externas/configuração comercial.
- Sprint 12: pedido transacional, snapshots/idempotência e token de acompanhamento de visitante.
- Sprint 13: tentativas de pagamento, contrato independente de provedor e simulador.
- Sprint 14: histórico de cliente e acompanhamento de visitante por token.
- Sprint 15: gestão operacional, pedido de cancelamento, decisão ADMIN e reembolso.
- Sprint 16: dashboard local `America/Sao_Paulo`, recebimentos e reembolsos confirmados.
- Sprint 17: segurança integrada, rate limiting com Redis em produção e desempenho medido.
- Sprint 18: checklist de produção e critérios futuros para provedor PIX real; não implica integração/deploy.

## Regras fixas

- Stack: Node.js 22, TypeScript ESM/NodeNext, Fastify 5, Prisma 6.19.3, PostgreSQL 16, Zod, Vitest, Swagger/OpenAPI e Scalar.
- Não usar React. Não criar caminhos frontend presumidos.
- O schema atual define 17 tabelas/modelos após as migrations da Sprint 11; a contagem não é limite obrigatório. `cupons`, elegibilidade, utilizações, `faixas_frete`, referências/cache/controle geográfico estão implementados. `tentativas_pagamento` e `reembolsos` seguem aprovados para sprints futuras.
- Não criar tabelas de carrinho, estoque ou sessão; sem estoque/atendimento telefônico/PDF.
- Visitante: somente PIX online. Cliente autenticado: PIX, cartão presencial crédito/débito, dinheiro presencial. Sem cartão online.
- Pagamento presencial começa pendente. Confirmação ADMIN autorizada inclui responsável e horário. Estado financeiro não é status operacional.
- PIX: cobrança inicial e no máximo uma tentativa adicional (duas no total), cinco minutos cada contados da confirmação de criação pelo backend. Falha/recusa explícita encerra imediatamente a tentativa; tentativa 2 fica disponível após falha, recusa ou expiração da primeira. Expiração da segunda cancela automaticamente; falha/recusa da segunda não permite terceira cobrança. Idempotência e controle concorrente impedem cobrança simultânea ou ultrapassagem do limite.
- Simulador reproduz pendente, sucesso, falha, recusa, expiração e confirmação tardia. É apenas desenvolvimento/testes; não movimenta dinheiro.
- Provedor PIX ainda não escolhido. Sem webhook vazio, configuração fictícia ou identificador externo antecipado.
- Uma linha de pedido aponta para item OU combo. Preservar dados históricos de cliente/endereço, adicional, preço, composição, faixa/frete, cupom/desconto e total.
- Adicionais ficam no JSON existente do item: ID, nome, preço, ativo e `quantidadeMaxima` (padrão 1); servidor valida/preça; snapshot copia ID/nome/preço unitário/quantidade. Não há estoque.
- Cupons persistidos e administrados por ADMIN, elegibilidade relacional por item/combo, compra mínima e limite de usos opcionais (desativados por padrão), datas inclusivas em `America/Sao_Paulo`, um cupom por pedido, máximo percentual 30% e frete excluído do desconto.
- Geoapify é o geocoder inicial, isolado no backend; cache HMAC e quota compartilhada no PostgreSQL limitam chamadas a 4 req/s e 3.000 reservas/dia internamente. Confirmar quota real, termos e atribuição antes de produção. Endereço sem coordenadas fica pendente e não permite entrega. Visitante sem conta valida endereço previamente e usa referência temporária hash-only; retirada não depende de endereço. Preview e criação final do pedido não geocodificam. Correção manual só no cadastro/edição autenticados.
- Frete por linha reta, limite 6 km; faixas persistidas/administradas, sem lacunas/sobreposição. Seed de frete só teste. Desativar faixa afeta novos pedidos, não snapshots antigos.
- Pedido mantém hash/expiração/revogação do token aleatório de visitante. É válido enquanto o pedido estiver ativo e expira 30 dias após conclusão ou cancelamento; recuperação por número do pedido + telefone invalida o token anterior. Sem OTP no MVP; risco residual aceito. Token consulta pedido/pagamento e permite solicitar cancelamento (ADMIN decide) ou a segunda tentativa PIX; não edita pedido/histórico.
- Cliente ou visitante com token solicita cancelamento com motivo; ADMIN decide. Cancelamento e reembolso são independentes. Reembolso PIX é manual no MVP, cada ocorrência é registro individual, várias por pedido; parcial preparado no modelo, mas desativado.
- Estado operacional aprovado inclui `PREPARANDO` (não `EM_PREPARACAO`); `CONCLUIDO` não regride para `CANCELADO`. Estado financeiro é separado.
- Dashboard `America/Sao_Paulo`; semestres civis janeiro–junho e julho–dezembro; timestamps UTC; separar bruto, recebidos e reembolsos confirmados; agregações no PostgreSQL.
- Rate limit: memória no desenvolvimento, limites controlados e isolados nos testes, Redis compartilhado em produção; proteger explicitamente a cobrança inicial e a segunda tentativa para visitante e autenticado. Falha do Redis bloqueia operações sensíveis de alteração; GET de acompanhamento continua disponível com fallback protegido em memória por processo, identificado por derivação do token e IP, reconhecendo que não é distribuído. Não inventar limites numéricos: justificar proposta e obter aprovação antes da produção. Redis não é cache.
- Medir desempenho antes de otimizar; `select`, evitar N+1, medir HTTP/SQL/conexões, `EXPLAIN ANALYZE` em queries relevantes e índices conforme filtros reais.

## Padrão técnico de execução

1. Verificar rota/modelo/teste existente e o estado atual do Git.
2. Formalizar contratos Zod/OpenAPI antes da implementação.
3. Manter `src/app.ts` como ponto de registro e `src/server.ts` como inicialização.
4. Usar Prisma diretamente em operação simples; introduzir `src/services/` apenas quando regra reutilizada/complexa justificar. Não criar `repositories/` ou arquivos vazios preventivamente.
5. Selecionar campos com `select`, verificar propriedade/ADMIN no backend e não expor modelos Prisma integrais.
6. Operações com pedido, tentativa, histórico e reembolso usam transação/idempotência onde necessário.
7. Testes usam banco `leosburger_test`, fixtures próprias, `criarAplicacao()` e `app.inject()` conforme padrões existentes. Nunca usar o banco de desenvolvimento.
8. Rodar testes focados, suíte, build e `npx prisma validate` quando aplicável; revisar migration e `git diff`.
9. Não resetar bancos nem remover volumes como rotina.

## Responsabilidades frontend/backend

- Backend: contratos, validação, autoridade de preço/desconto/frete, autorização, tentativas financeiras, persistência, snapshots, transições e auditoria.
- Frontend: enviar identificadores, quantidades, seleções, endereço, modalidade, método e código; exibir cálculo/status retornados; não envia preço, desconto, frete, status ou confirmação de pagamento como autoridade.
- Token nunca aparece em URL/logs nem é persistido em texto puro. A consulta de pedido/status continua disponível se Redis falhar.

## Aprovações remanescentes antes de produção

- Propor e justificar os valores numéricos de rate limit por operação para aprovação; não fixá-los por suposição.
- Confirmar os valores comerciais das faixas e as coordenadas confiáveis do restaurante; dados de seed são só teste.
- Escolher provedor PIX real apenas em etapa futura. Não implementar gateway/webhook real nesta série de Sprints.
- Risco residual aceito: recuperação de token por número do pedido + telefone, sem OTP no MVP. A Sprint 17 pode avaliar reforço futuro, sem torná-lo pré-requisito de implementação atual.

Se uma pendência bloquear parte do trabalho, implementar somente o que não dependa dela e documentar o limite; não inventar regra ou fornecedor.
