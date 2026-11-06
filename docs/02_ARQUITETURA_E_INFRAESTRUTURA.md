📂 `docs/02_ARQUITETURA_E_INFRAESTRUTURA.md`

````markdown
# Arquitetura e infraestrutura do LEOSBurger

## 1. Visão do produto

O LEOSBurger permite que clientes consultem o cardápio e façam pedidos online. O backend possui catálogo público, autenticação, perfil/endereço e administração de catálogo/combos/cupons/faixas de frete. A Sprint 11 implementa validação geográfica de endereço e prévia de checkout somente de leitura; criação definitiva de pedidos, pagamentos e dashboard continuam planejados.

## 2. Arquitetura lógica atual e desejada

```text
Navegador
    │
    ▼
Frontend (HTML + TypeScript + Tailwind) — planejado
    │  HTTP / JSON
    ▼
API REST (Fastify + TypeScript)
    ├── rotas
    ├── validação de entrada (Zod)
    ├── serviços/regras de negócio (introduzir conforme necessário)
    ├── autenticação JWT por cookie e autorização reutilizável
    └── plugins compartilhados
          ├── Prisma
          ├── autenticação, cookies e CORS restrito
          ├── rate limiting — planejado (memória local/teste; Redis em produção)
          └── OpenAPI/Swagger + Scalar
                 │
                 ▼
             Prisma ORM
                 │
                 ▼
          PostgreSQL 16
          (Docker Compose)
```
````

O repositório inspecionado contém o backend em `src/` na raiz e não contém uma pasta de frontend. Não assumir `frontend/src/` nem criar `backend/src/`. A localização do frontend deverá ser confirmada antes de qualquer trabalho de interface.

O plugin `src/plugins/autenticacao.ts` registra JWT, cookies e CORS com credenciais limitado à origem exata configurada em `FRONTEND_ORIGIN`. A variável é obrigatória em produção e precisa conter uma origem HTTPS. Ele disponibiliza os hooks `app.autenticar`, `app.autorizarAdmin` e `app.verificarOrigem` para rotas futuras. Em cada requisição protegida, o JWT assinado HS256 fornece apenas o identificador do usuário; o servidor consulta no Prisma o usuário ativo e seu papel atual.

A sessão é stateless: o JWT fica em cookie `HttpOnly`, `SameSite=Strict`, `Path=/` e `Secure` em produção; a expiração é de 30 dias para clientes e 12 horas para ADMIN. Logout remove o cookie do navegador, sem revogar tokens previamente copiados. Não existe tabela de sessão, armazenamento em memória ou refresh token. Operações de escrita que usam cookies devem verificar a origem via `app.verificarOrigem`; origens CORS são permitidas somente quando correspondem a `FRONTEND_ORIGIN`. Não habilite wildcard com credenciais.

## 3. Diretrizes para as próximas sprints

### Checkout e cupons

- Manter `src/app.ts` como ponto de registro e criar rotas de checkout/pedidos em `src/routes/`, seguindo os arquivos existentes.
- O acesso direto ao Prisma nas rotas continua apropriado para operações simples. A prévia/criação compartilha validação e cálculos financeiros, portanto introduzir `src/services/` somente para essa regra reutilizada. Não criar `repositories/` nesta etapa.
- Adicionais ficam como configuração JSON por item, com ID/nome/preço/ativo e `quantidadeMaxima` configurável (padrão 1); backend valida preço/quantidade e snapshot preserva nome/preço/quantidade.
- Cupons persistidos e administrados por ADMIN usam elegibilidade relacional em itens/combos, compra mínima opcional desativada por padrão, teto percentual de 30%, um por pedido e limite de usos opcional. Desconto só em produtos elegíveis, nunca frete.
- Frete usa faixas persistidas/editáveis por ADMIN, cobertura sem lacunas/sobreposição em 0–6 km, distância em linha reta e snapshot imutável. Seed tem apenas dados de teste, não valores comerciais.
- Geoapify é o provedor inicial aprovado para a Sprint 11, isolado no backend; geocodifica endereços no cadastro/edição e validação prévia do endereço de visitante, com cache e quota compartilhados no PostgreSQL. O limite conservador definido na Sprint é 4 req/s e 3.000 consultas/dia, sujeito à confirmação do plano contratado antes de habilitar chamadas reais. Endereço pode ficar pendente sem coordenadas, mas somente aquele endereço não permite ENTREGA. Visitantes podem escolher ENTREGA ou RETIRADA sem conta; o endereço de entrega é validado antes da finalização e vinculado por referência temporária persistida no PostgreSQL. Criação final do pedido/pagamento não geocodifica. Correção manual do ponto só no cadastro/edição; não é etapa obrigatória do checkout.
- A referência temporária usa token opaco aleatório, persiste somente o hash, associa snapshot mínimo do endereço/validação e expira em 30 minutos. O backend recupera dados confiáveis da referência entre instâncias; não enviar nome, telefone, complemento ou referência ao geocodificador e não aceitar coordenadas livres do cliente.
- O backend é a autoridade de preços, adicionais, descontos, taxa e total. A prévia não grava pedido; a criação refaz as consultas e cálculos.

### Sprint 11 implementada

- `POST /checkout/endereco-visitante/validar` valida previamente o endereço sem autenticação e emite referência temporária hash-only, válida por 30 minutos.
- `POST /checkout/preview` aceita visitante ou CLIENTE, bloqueia ADMIN e recalcula linhas, adicionais, cupom, frete e total sem criar pedido, cobrança ou uso de cupom.
- `GET/POST/PUT /admin/cupons` administra cupons e elegibilidade; `GET/PUT /admin/faixas-frete` substitui atomicamente o conjunto configurado.
- As tabelas da Sprint 11 estão em migrations aditivas. Testes e migrations usam exclusivamente `leosburger_test`; origem e preços comerciais não estão configurados.
- Produção ainda depende de origem comercial, preços comerciais, validação do critério Geoapify/quota/termos e proposta aprovada de rate limit. O endpoint público de validação de endereço ainda não tem limite específico por cliente.

### Pagamentos

- O domínio de pedidos/pagamentos não conhece nomes, SDKs, formatos de resposta ou credenciais de fornecedor.
- Criar o contrato genérico independente de fornecedor antes de implementar o simulador na Sprint 13. O contrato cobre criação/consulta de cobrança e processamento de evento normalizado.
- O simulador implementa o contrato e só pode ser selecionado em desenvolvimento/testes. A inicialização em produção deve falhar se a configuração tentar habilitá-lo.
- Não criar webhook HTTP até existir um adaptador real e contrato validável. A futura notificação terá autenticação criptográfica, validação, idempotência e atualização transacional.
- Cartão e dinheiro são pagamentos presenciais. Nenhum dado de cartão é coletado ou armazenado; o pedido inicia pendente e uma operação ADMIN registra resultado, responsável e data.
- O schema atual tem somente `metodoPagamento`, sem estado financeiro completo/tentativas. Avaliar a tabela `tentativas_pagamento`, vinculada ao pedido, para retries sem duplicar compra, idempotência, confirmação presencial e conciliação de eventos tardios. Estado financeiro nunca deve ser confundido com status operacional.
- Duas tentativas PIX no total: cobrança inicial e uma adicional, cinco minutos cada desde a confirmação de criação pelo backend. Falha/recusa explícita encerra imediatamente a tentativa; segunda fica disponível após falha/recusa/expiração da primeira. Expiração da segunda cancela automaticamente; falha/recusa da segunda não permite terceira. Idempotência e controle concorrente impedem simultâneas, cobranças repetidas e exceder o limite; pedido pago/cancelado não aceita nova cobrança.
- Confirmação tardia após cancelamento fica vinculada à tentativa original, marca a tentativa `PAGO`, o estado financeiro do pedido `REEMBOLSO_PENDENTE` e mantém `Pedido.status=CANCELADO`; reembolso manual. Evento repetido da mesma cobrança é distinto de confirmações de cobranças de duas tentativas diferentes; ambos são auditados para análise ADMIN sem reembolso automático.
- Cada ocorrência de reembolso tem linha própria em `reembolsos`, permite múltiplos por pedido e se vincula à transação original. PIX manual por ADMIN; devolução presencial manual; reembolso parcial estruturalmente possível, mas desativado.

### Fronteiras entre backend e frontend

- Backend: define contratos OpenAPI/DTO, valida identidade, propriedade, itens, pagamentos e cupom; consulta preços oficiais, calcula valores e persiste snapshots/status.
- Frontend: apresenta o cardápio/carrinho e envia identificadores, quantidades, seleções de adicionais, modalidade, endereço necessário, método permitido e código de cupom. Pode exibir valores retornados pelo backend, mas não determina preço, desconto, taxa, total, aprovação de pagamento ou autorização.
- Não incluir segredos, chaves de provedor ou regras de cupom editáveis no bundle do navegador.
- Antes da Sprint de frontend, localizar/decidir a pasta real; não presumir `frontend/src/`.

### Banco, transações e confiabilidade

- O schema atual possui 17 modelos/tabelas após a Sprint 11; essa contagem não é limite obrigatório. Tentativas de pagamento e reembolsos seguem aprovados para expansão futura. Não criar entidade persistente adicional sem justificativa técnica e autorização.
- Não criar tabela de carrinho, estoque ou sessão. Cache Redis não será adicionado; Redis é inicialmente para rate limiting compartilhado em produção.
- A criação do pedido e linhas/snapshots é atômica. Tentativas são persistidas separadamente e idempotentes; retries não clonam pedido.
- Mudanças de pagamento/cancelamento/reembolso usam transações e compare-and-set para impedir dupla confirmação e inconsistência. Evento financeiro tardio mantém a referência à tentativa original.
- Persistir somente hash do token de visitante; ele permanece válido enquanto o pedido estiver ativo e expira 30 dias após conclusão ou cancelamento. É revogável e recuperável por número do pedido + telefone, com emissão de token novo que invalida o anterior. Autoriza consultar pedido/pagamento, solicitar cancelamento (ADMIN decide) e solicitar a segunda tentativa PIX; nunca editar dados/snapshots. Sem OTP no MVP; risco conhecido e aceito.
- Revalidar disponibilidade e preços no momento da gravação; não manter transação de banco aberta durante chamada de geocodificação/provedor.
- Manter `src/plugins/erros.ts`, Zod, schemas de resposta explícitos, OpenAPI e `app.inject()` conforme padrões existentes.
- Índices/consultas serão planejados após confirmar filtros e medir desempenho; dashboard deve usar agregações no PostgreSQL.

### Segurança operacional

- Escritas autenticadas por cookie usam `app.verificarOrigem`; CORS mantém allowlist exata.
- Rate limit por operação: login, criação de pedido, primeira cobrança PIX, segunda tentativa PIX, pagamento, cupom, recuperação de token, cancelamento e recuperação de senha se houver. Aplicar a visitante e autenticado. Desenvolvimento usa memória, testes isolados e produção Redis compartilhado; responder `429` quando aplicável. Não inventar limites numéricos; propor e justificar antes de produção. Se Redis falhar, bloquear operações sensíveis de alteração. GET de pedido/status por token continua disponível com fallback protegido em memória por processo, identificado por derivação do token e IP; fallback não distribuído, complementar com proteção de borda se disponível. Redis não é requisito local nem cache.
- O backend não aceita confirmação de PIX ou status administrativo enviado pelo cliente. Uma confirmação PIX real futura depende de notificação do provedor autenticada e idempotente.
- Token de visitante não fica em URL/logs; armazenar somente hash e expiração, permitir revogação/rotação. Recuperação número+telefone e operações autorizadas são limitadas. Resposta omite endereço completo e dados pessoais desnecessários; token não altera dados do pedido.
- Não registrar tokens, segredos, payloads financeiros sensíveis nem dados pessoais completos sem necessidade. Redigir headers de autorização e dados de token nos logs.

### Observabilidade e desempenho

- Medir latência HTTP, tempo SQL, volume de consultas, conexões e consumo de recursos antes de otimizar.
- Usar `select` para campos necessários, evitar N+1, planejar índices por filtros/relacionamentos/status/datas e aplicar `EXPLAIN ANALYZE` em consultas relevantes.
- Dashboard agrega no banco; não carregar todo o histórico para somar na aplicação.
- Períodos seguem `America/Sao_Paulo`; semestre civil Jan–Jun/Jul–Dez. Timestamps persistidos em UTC por convenção da aplicação.
- Não adicionar Redis Cache; avaliar cache somente depois de gargalo medido e decisão específica.
