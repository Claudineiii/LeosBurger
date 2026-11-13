# Plano de APIs — LEOSBurger

## 1. Objetivo

Este documento é um **plano de endpoints**, não afirma que as APIs listadas já foram implementadas. O agente deve conferir as rotas reais em `src/routes/` antes de concluir qualquer status.

Base atual conhecida: Fastify 5.x, TypeScript, Prisma 6.19.3, Zod, Swagger/OpenAPI e Scalar. Estão implementadas `GET /health`, rotas públicas de categorias/itens/combos e rotas de autenticação; confira o estado atual em `src/routes/`.

## 2. Princípios para todas as rotas

- Validar parâmetros, query strings e bodies com schemas.
- Documentar operações, entradas, respostas e erros no OpenAPI.
- Responder com códigos HTTP coerentes.
- Não expor detalhes internos nem hashes de senha.
- Não confiar em preços/totais enviados pelo cliente.
- Separar autenticação de autorização; estar autenticado não significa ser administrador.
- Testar sucesso, entrada inválida, ausência de registro, falta de autenticação/autorização e falhas relevantes.
- Usar transação para criar pedido e persistir suas linhas/histórico de forma consistente.
- Manter documentação e comportamento real sincronizados.

## 3. Etapa A — Fundação

| Método | Caminho proposto             | Acesso                       | Objetivo                                 | Estado                                                   |
| ------ | ---------------------------- | ---------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| GET    | `/health`                    | Público                      | Verificar disponibilidade básica da API. | Implementada e testada.                                  |
| GET    | `/reference`                 | Desenvolvimento/documentação | Interface Scalar para explorar OpenAPI.  | Visualizada funcionando; conferir configuração real.     |
| GET    | `/reference/openapi.json`     | Documentação                 | Servir a especificação OpenAPI gerada pelo Scalar. | Confirmada no runtime; `/reference` redireciona para `/reference/`. |

Não usar `/reference` como prova de que todas as rotas estão documentadas: cada endpoint precisa de descrição/schema.

## 3.1 Catálogo já implementado

| Método | Caminho        | Objetivo                                      | Estado |
| ------ | -------------- | --------------------------------------------- | ------ |
| GET    | `/categorias`  | Listar categorias ativas em ordem de exibição. | Implementada; ver `src/routes/categorias.ts` e `tests/api/categorias.test.ts`. |
| GET    | `/itens`       | Listar itens ativos; filtro opcional `categoriaId`. | Implementada; ver `src/routes/itens.ts` e `tests/api/itens.test.ts`. |
| GET    | `/itens/:id`   | Consultar os dados públicos de um item ativo. | Implementada; ver `src/routes/itens.ts` e `tests/api/itens.test.ts`. |
| GET    | `/combos`      | Listar combos ativos com composição disponível. | Implementada; ver `src/routes/combos.ts` e `tests/api/combos.test.ts`. |
| GET    | `/combos/:id`  | Consultar os dados públicos de um combo disponível. | Implementada; ver `src/routes/combos.ts` e `tests/api/combos.test.ts`. |

`GET /itens` retorna `id`, `categoriaId`, `nome`, `descricao`, `preco`, `imagemUrl`, `ordem` e `adicionais` como DTO público com somente adicionais ativos (`id`, `nome`, `preco` numérico e `quantidadeMaxima`). Não expõe estado administrativo nem configuração inativa. A resposta ordena por `ordem`, `nome` e `id`; `categoriaId` inválido é rejeitado com `400`.

`GET /itens/:id` retorna os mesmos campos públicos de um item ativo. O parâmetro `id` deve ser UUID; identificador malformado retorna `400`, enquanto item inexistente ou inativo retorna o mesmo `404` genérico. O preço Decimal é convertido para número e `adicionais` permanece fora da resposta.

`GET /combos` e `GET /combos/:id` usam a mesma regra de disponibilidade: somente combos ativos com pelo menos um componente vigente e com todos os componentes vigentes ativos. Associações removidas logicamente (`removidoEm` preenchido) não participam da composição nem tornam o combo indisponível, mesmo que o item associado esteja inativo. Os endpoints retornam `id`, `nome`, `descricao`, `preco`, `imagemUrl`, `ordem` e `itens` (`id`, `nome`, `quantidade`); preços Decimal são convertidos para número. A composição é ordenada por nome do item e ID. Na rota de detalhe, UUID inválido retorna `400`; combo inexistente ou indisponível retorna `404` genérico sem revelar a existência do registro.

## 3.2 Autenticação implementada

| Método | Caminho          | Acesso | Objetivo | Estado |
| ------ | ---------------- | ------ | -------- | ------ |
| POST   | `/auth/cadastro` | Público | Cadastrar cliente com e-mail normalizado e senha em hash. | Implementada; resposta `201`, duplicidade genérica `409`. |
| POST   | `/auth/login`    | Público | Validar credenciais e emitir cookie JWT. | Implementada; credenciais inválidas ou usuário inativo recebem resposta genérica `401`. |
| POST   | `/auth/logout`   | Público | Apagar o cookie de autenticação do navegador. | Implementada; `204`, sem revogação de JWT copiado. |
| GET    | `/auth/me`       | Autenticado | Consultar dados públicos do usuário autenticado. | Implementada; `401` para cookie ausente, inválido, expirado ou usuário inativo. |
| PATCH  | `/auth/me`       | Autenticado | Atualizar nome, e-mail e/ou telefone próprios. | Implementada na Sprint 10; campos desconhecidos rejeitados, e-mail normalizado e conflito `409`. |
| GET    | `/auth/me/endereco` | Autenticado | Consultar o endereço próprio. | Implementada na Sprint 10; `404` quando não cadastrado. |
| POST   | `/auth/me/endereco` | Autenticado | Criar o endereço próprio. | Implementada na Sprint 10; `201`, `409` se já houver endereço. |
| PATCH  | `/auth/me/endereco` | Autenticado | Atualizar parcialmente o endereço próprio. | Implementada na Sprint 10; `404` quando não cadastrado. |
| DELETE | `/auth/me/endereco` | Autenticado | Excluir o endereço próprio. | Implementada na Sprint 10; `204`, snapshots de pedidos permanecem intactos. |

O cookie `leosburger_session` é `HttpOnly`, `SameSite=Strict`, `Path=/` e `Secure` em produção. JWT HS256 expira em 30 dias para `CLIENTE` e 12 horas para `ADMIN`. O token contém somente `sub`; o servidor consulta o usuário ativo e seu tipo atual no banco em cada acesso protegido. Os hooks `app.autenticar`, `app.autorizarAdmin` e `app.verificarOrigem` são reutilizáveis nas rotas futuras. CORS com credenciais tem allowlist exata `FRONTEND_ORIGIN`; operações de escrita recusam `Origin` divergente.

Logout encerra o uso da sessão pelo navegador ao remover o cookie com os mesmos atributos de criação. Não há revogação no servidor: um JWT copiado continua válido até `exp`, a menos que o usuário seja desativado. Não há tabela de sessões, refresh token nem migration de autenticação.

## 4. Etapa B — Catálogo público

Endpoints de combos implementados:

- listar combos disponíveis;
- consultar um combo disponível pelo identificador.

Regras:

- o cliente público vê apenas itens/combos disponíveis para venda;
- `GET /combos` retorna somente combos ativos com pelo menos um componente vigente, desde que todos os componentes vigentes estejam ativos;
- combos sem componentes vigentes ou com qualquer componente vigente inativo ficam ocultos; associações removidas logicamente não participam dessa regra, e nenhum componente é substituído automaticamente;
- a composição pública inclui `id`, `nome` e `quantidade` de cada item, sem campos internos da associação;
- o preço Decimal do combo é convertido para número, e a lista é ordenada por `ordem`, `nome` e `id`;
- não tratar combo como categoria;
- `Item.adicionais` é validado no cadastro/edição administrativa. Configurações legadas sem identidade/estado não são publicadas nem selecionáveis; `quantidadeMaxima` ausente em configuração estruturada assume 1. O checkout futuro ainda deverá criar snapshots de adicionais no pedido;
- validar paginação/filtros se forem implementados;
- não expor campos administrativos internos.

Para as próximas rotas, definir os caminhos exatos antes de implementá-las e manter convenções consistentes. A rota existente `/categorias` usa nome plural em português.

## 5. Etapa C — Administração do catálogo

### Categorias e itens implementados na Sprint 8

Todos os endpoints abaixo exigem autenticação JWT por cookie e autorização `ADMIN` com o papel atual consultado no banco. Operações `POST` e `PATCH` também executam `app.verificarOrigem`; requisições sem `Origin` são aceitas conforme a regra vigente para clientes não navegador.

| Método | Caminho | Acesso | Comportamento e respostas relevantes |
| --- | --- | --- | --- |
| GET | `/admin/categorias` | ADMIN | Lista todas as categorias, inclusive inativas; `200`. |
| GET | `/admin/categorias/:id` | ADMIN | Consulta categoria por UUID; `400` para ID inválido e `404` para inexistente. |
| POST | `/admin/categorias` | ADMIN | Cria categoria ativa; `201`, `400` por entrada inválida e `409` por nome duplicado. |
| PATCH | `/admin/categorias/:id` | ADMIN | Atualiza parcialmente `nome`, `descricao`, `ordem` e/ou `ativo`; `400`, `404` ou `409` conforme o caso. |
| GET | `/admin/itens` | ADMIN | Lista todos os itens, inclusive inativos; `200`. |
| GET | `/admin/itens/:id` | ADMIN | Consulta item por UUID; `400` para ID inválido e `404` para inexistente. |
| POST | `/admin/itens` | ADMIN | Cria item ativo; `201`, `400` para entrada/categoria inválida e `409` para nome duplicado na categoria. |
| PATCH | `/admin/itens/:id` | ADMIN | Atualiza parcialmente os campos permitidos e/ou `ativo`; `400`, `404` ou `409` conforme o caso. |

Os corpos são estritos e rejeitam campos não permitidos. Categoria aceita nome, descrição e ordem na criação; `ativo` é alterado por PATCH. Item aceita categoria, nome, descrição, preço, imagem, ordem e JSON de adicionais na criação; PATCH também permite `ativo`. Campos omitidos mantêm o valor atual, enquanto `descricao`, `imagemUrl` e `adicionais` podem ser explicitamente limpos com `null`. O preço é um número finito, não negativo, representável em centavos e dentro da precisão `Decimal(10,2)` do banco. A ordem é inteiro no intervalo de `Int` do PostgreSQL. Imagens aceitam URL HTTP/HTTPS.

Os conflitos de unicidade são mapeados a `409` sem expor erros Prisma. Categoria inexistente informada pelo item retorna `400`; recurso administrativo inexistente no GET/PATCH retorna `404`. As respostas de administração incluem `ativo`; somente a resposta administrativa de item inclui `adicionais`. As respostas públicas seguem inalteradas: categorias e itens inativos continuam ocultos, e adicionais não são retornados ao público.

Não há endpoint DELETE para categorias e itens: sua desativação é feita com `PATCH` e `ativo: false`; ativação usa `ativo: true`. A administração de combos está descrita na seção da Sprint 9 abaixo. O contrato de domínio dos adicionais foi aprovado para trabalho futuro: ID, nome, preço e estado ativo. A implementação atual valida apenas JSON válido e ainda não verifica esses campos; a Sprint 11 deve compatibilizar os registros existentes antes de aplicar o schema estrito.

### Administração de combos — Sprint 9

Todas as rotas abaixo exigem cookie JWT válido e papel `ADMIN` consultado no banco. `POST` e `PATCH` também verificam a origem com `app.verificarOrigem`.

| Método | Caminho | Comportamento |
| --- | --- | --- |
| GET | `/admin/combos` | Lista combos ativos e inativos, com composição vigente; `?incluirRemovidos=true` também retorna associações removidas em `itensRemovidos`. |
| GET | `/admin/combos/:id` | Consulta combo por UUID, inclusive inativo; aceita `?incluirRemovidos=true`; `400` para ID inválido e `404` para inexistente. |
| POST | `/admin/combos` | Cria combo ativo com composição inicial; `201`, `400` para dados/referências inválidos e `409` para nome duplicado. |
| PATCH | `/admin/combos/:id` | Atualiza parcialmente dados e `ativo`; `itens` acrescenta/atualiza/reativa componentes e `removerItemIds` remove associações logicamente; `400`, `404` ou `409`. |

Os corpos são estritos. A criação exige `nome`, preço não negativo representável em centavos e uma lista não vazia de `itens` com `itemId` UUID e quantidade inteira positiva. Campos opcionais são `descricao`, `imagemUrl` HTTP/HTTPS e `ordem`. O PATCH aceita esses campos, `ativo` booleano, `itens` incremental e `removerItemIds` como lista não vazia de IDs. Um mesmo item não pode aparecer em ambas as listas. Itens omitidos permanecem na composição. `itens` cria associação quando necessário, atualiza quantidade ou reativa a associação removida existente; `removerItemIds` só aceita itens atualmente associados. Cada operação de composição e a atualização do combo são atômicas. A resposta da remoção retorna a associação em `itensRemovidos`; para consultas GET, essa lista é incluída somente com `incluirRemovidos=true`.

O preço é persistido conforme informado pelo proprietário; composição não altera o preço. Respostas administrativas expõem somente campos selecionados e informam `ativo` em cada componente e `possuiItensInativos` no combo. Componentes inativos exigem revisão manual, sem substituição automática. Ativar um combo com componentes inativos é permitido, mas o catálogo público continua indisponibilizando-o. Transações Prisma tornam a criação e cada PATCH atômicos; referências inexistentes retornam `400`, conflitos de unicidade `409` genérico, e recursos inexistentes `404` genérico. O catálogo público filtra associações removidas e combos que não tenham componentes vigentes ou cujos componentes vigentes estejam inativos.

**Limitação histórica:** não há fluxo de checkout implementado que gere `ItemPedido.composicaoHistorica`. Testes comprovam que operações administrativas não alteram snapshots já gravados, mas a criação/completude do snapshot deverá ser testada quando o checkout for desenvolvido.

## 6. Etapa D — Autenticação e perfil

Operações já implementadas:

- `POST /auth/cadastro`;
- `POST /auth/login`;
- `POST /auth/logout`;
- `GET /auth/me`.

As operações de perfil e endereço foram implementadas na Sprint 10. O perfil é identificado exclusivamente pela sessão; são atualizáveis `nome`, `email` e `telefone`. O modelo permite um único endereço por usuário, consultado/criado/editado/excluído em `/auth/me/endereco`; o CEP é normalizado para oito dígitos, o estado para maiúsculas e o número permanece texto. Na implementação parcial da Sprint 11, cadastro/alteração de localização tenta geocodificar no backend e a resposta autenticada expõe coordenadas e situação da geocodificação. Atualizações do endereço atual não alteram snapshots históricos de pedidos. Não há endereço principal.

### Geocodificação de endereço — Sprint 11 (implementação parcial)

- `POST` e `PATCH /auth/me/endereco` tentam geocodificar o endereço próprio no backend com Geoapify. Se a localização for alterada e a validação não confirmar coordenadas, coordenadas antigas são removidas; alterações somente de complemento/referência não fazem nova consulta.
- `POST /checkout/endereco-visitante/validar` recebe endereço sem coordenadas, não exige conta e retorna somente referência, situação e expiração. A resposta não expõe endereço ou coordenadas; resultados inconclusivos/provedor indisponível geram referência pendente.
- Referência temporária: token aleatório opaco, hash SHA-256 persistido em PostgreSQL, associado a snapshot mínimo de endereço e validação, com validade de 30 minutos. O preview recebe a referência e recupera dados confiáveis do backend. Nenhuma rota aceita coordenadas livres como autoridade.
- `POST /checkout/preview` está implementado como operação somente de leitura. Falha do geocoder deixa aquele endereço pendente e inelegível para uma cotação de entrega, sem restringir outros visitantes ou a retirada. A criação definitiva de pedidos continua planejada e não deverá geocodificar.
- A resposta autenticada do endereço próprio pode expor coordenadas ao proprietário para conferência/correção; nunca expor coordenadas de endereços de clientes em catálogo ou recursos públicos.
- O adaptador Geoapify fica isolado no backend, com timeout, cache e controle de quota global PostgreSQL; o limite conservador implementado é 4 req/s e 3.000 consultas/dia, sujeito à confirmação do limite diário da conta antes de chamadas reais. Nenhuma chamada real foi feita. Não fazer autocomplete ou consultas em lote; incluir atribuições Geoapify e OpenStreetMap exigidas pelo plano. Enviar somente dados de localização necessários, sem nome, telefone, complemento ou referência.

Configuração requerida: `JWT_SECRET` com pelo menos 32 bytes; `FRONTEND_ORIGIN` deve ser a origem exata do frontend e HTTPS em produção. Não exponha hash de senha, cookie ou segredo em logs/respostas.

## 7. Sprint 11 — checkout prévio e configuração comercial (implementado localmente)

As rotas abaixo estão implementadas no backend. Os testes automatizados usam somente o banco isolado `leosburger_test`; nenhum pedido ou pagamento definitivo é criado nesta Sprint.

### `POST /checkout/preview`

`POST /checkout/preview` é público com autenticação opcional: aceita visitante e CLIENTE e nega ADMIN. Credencial ausente é visitante; cookie presente inválido/expirado retorna erro de autenticação. Aceita linhas com `itemId` **ou** `comboId`, quantidade, seleções de adicionais por ID, modalidade, método, referência temporária de endereço de visitante e código opcional. Visitante pode escolher ENTREGA ou RETIRADA, não precisa de conta e só usa PIX; CLIENTE pode usar os métodos previstos. Não aceita usuário, preço, taxa, percentual, desconto, total, distância ou coordenadas como autoridade.

Para ENTREGA, CLIENTE usa o próprio endereço; visitante fornece referência temporária válida. O backend calcula distância em linha reta e usa somente origem e faixas configuradas. Não chama o geocoder. Endereço pendente, origem ausente, distância fora da área ou faixa inválida produzem situação não definitiva e `frete`/`total` nulos, nunca substituídos por zero. RETIRADA independe de geocodificação e faixas, com frete zero. O DTO retorna linhas/adicionais precificados, subtotal, cupom, frete, distância e total quando conhecidos. A prévia não reserva preço/disponibilidade nem produz efeito comercial.

Cupom: request envia apenas `codigoCupom`; backend lê elegibilidade por relação item/combo, estado, validade e compra mínima opcional. O limite de usos também é opcional. Datas civis inclusivas em `America/Sao_Paulo`; percentual máximo 30%. Desconto fixo é limitado ao subtotal elegível; frete nunca recebe desconto. Itens elegíveis e não elegíveis podem coexistir; cupom válido sem linhas elegíveis aplica desconto zero. A resposta apresenta o desconto total, sem rateio por linha.

### APIs administrativas de cupons

- `GET /admin/cupons`: lista configuração, estado, validade, limite de usos e elegibilidade.
- `POST /admin/cupons`: cria cupom completo e relações opcionais de itens/combos elegíveis.
- `PUT /admin/cupons/:id`: substitui atomicamente a configuração completa e suas relações.

Exigem `app.autorizarAdmin`, Zod estrito, resposta selecionada e verificação de origem em writes. Gerenciam código normalizado, percentual/fixo, valor, ativo/inativo, datas, compra mínima opcional e elegibilidade. A compra mínima é desativada por padrão. Não há endpoint público que liste regras/valores internos; checkout recebe somente o cálculo necessário. Uma edição deve validar limites/datas e substituir relações atomicamente.

### APIs administrativas de faixas

- `GET /admin/faixas-frete`: lista faixas ativas e inativas.
- `PUT /admin/faixas-frete`: substitui atomicamente o conjunto; lista vazia desativa todas. ADMIN informa cobertura contínua de 0–6 km, sem lacunas/sobreposições, em intervalos semiabertos e máximo final inclusivo.
- Valores de teste existem somente em fixtures; não há preços comerciais configurados. A prévia calcula a faixa vigente, mas o pedido futuro ainda terá de persistir snapshot da faixa, distância e valor.

## 8. Etapa F — Criação e tracking de pedido (Sprint 12)

### `POST /pedidos`

Implementada em `src/routes/pedidos.ts` e `src/services/pedidos.ts`. Exige `Idempotency-Key` UUIDv4; resposta `201` na criação e `200` no replay idêntico. Revalida catálogo, adicionais ativos, referência/endereço validado, cupom, modalidade, método e faixas dentro de transação serializável. Cada linha aponta para item ou combo. Para ENTREGA de visitante, exige a referência temporária do endereço, recuperando endereço e coordenadas protegidos; não exige conta. Persiste snapshots de adicionais, composição do combo, endereço, distância/faixa/frete, código e regras do cupom. A migration adiciona hash do payload/escopo e dados históricos da faixa sem alterar as CHECK existentes.

Escopo é o hash do identificador do CLIENTE ou do telefone normalizado do visitante; retenção acompanha a vida do pedido. A chave globalmente única e o hash do payload canônico protegem retries e concorrência. Mesma chave com payload/escopo incompatível retorna `409`. Não abrir transação durante geocodificação/provedor; a rota não geocodifica e não inicia cobrança. Integração com a primeira tentativa PIX continua na Sprint 13.

Para visitante, gera token aleatório criptograficamente seguro; persiste hash SHA-256, entrega plaintext somente na resposta inicial e nunca coloca em URL/logs. `POST /pedidos/acompanhamento/recuperar` recebe número e telefone, responde genericamente em caso de falha e rotaciona o hash. O token permanece válido enquanto o pedido estiver ativo; após conclusão/cancelamento, o campo de expiração é respeitado e deve ser preenchido pelo futuro fluxo de transição de status. OTP não é usado no MVP; não há rate limit de recuperação nesta sprint, sendo pendência de proteção antes de produção.

## 9. Etapa G — Tentativas de pagamento (Sprint 13)

### `POST /pedidos/:id/tentativas-pagamento`

Cria a segunda e última tentativa associada ao mesmo pedido, protegida por chave idempotente. A primeira cobrança é iniciada no checkout; máximo duas tentativas PIX no total, cada uma com cinco minutos desde a confirmação da criação da cobrança pelo backend. Falha/recusa explícita encerra imediatamente a tentativa; a segunda fica disponível após falha, recusa ou expiração da primeira. Expiração da segunda cancela automaticamente o pedido. Falha/recusa da segunda não permite uma terceira tentativa. Pedido pago/cancelado não aceita cobrança. A operação não duplica pedido nem snapshots. CLIENTE e visitante com token válido podem solicitar a segunda tentativa; aplicar rate limit próprio ou da criação de pagamentos e respeitar idempotência/concorrência.

Na Sprint 12, a criação do pedido não inicia cobrança. A Sprint 13 poderá estender o fluxo para criar a tentativa PIX inicial depois de persistir pedido/snapshots, com idempotência e compensação que não duplique o pedido. O endpoint separado representa a segunda tentativa. Não permitir tentativas simultâneas, mesmo sob concorrência; uma chave repetida retorna a operação original e não cria nova cobrança nem conta como nova tentativa. Pedidos pagos ou cancelados bloqueiam novas cobranças.

O contrato de provedor cobre criar cobrança, identificar a cobrança, idempotência, consultar estado e processar evento autenticado/normalizado. O simulador implementa o mesmo contrato e reproduz pagamento confirmado, falha, recusa, expiração, confirmação tardia e eventos duplicados. Apenas desenvolvimento/testes; produção com simulador falha. Não criar webhook real ou fictício. Futuro webhook real valida assinatura/autenticidade e idempotência antes de processar eventos.

Proprietário autenticado ou ADMIN conforme autorização consulta métodos privados; a consulta do visitante por token é limitada aos dados de tracking. Além da consulta, o token permite solicitar cancelamento (decisão ADMIN) e retry PIX, sem editar o pedido. ADMIN registra confirmação de cartão/dinheiro presencial com ator e data; PIX nunca recebe confirmação manual. Resposta separa status operacional de estado financeiro.

Confirmação PIX tardia referencia a tentativa original. Se o pedido já foi cancelado, registrar pagamento na tentativa original, definir estado financeiro do pedido como `REEMBOLSO_PENDENTE` e preservar `status=CANCELADO`; ADMIN conduz o reembolso manual. Repetição de confirmação da mesma cobrança é evento duplicado (idempotente, com identificadores preservados); confirmação de duas cobranças distintas é outra ocorrência financeira. Ambos os casos seguem para análise ADMIN sem reembolso automático e nunca são associados a outro pedido.

## 10. Etapa H — Histórico e acompanhamento (Sprint 14)

- `GET /pedidos` e `GET /pedidos/:id`: cookie obrigatório, filtro pela identidade da sessão; respostas de recurso inexistente e de terceiro não enumeráveis (`404` genérico).
- `GET /pedidos/acompanhamento`: token em cabeçalho de autorização, nunca path/query. Validar hash, expiração e revogação. Válido enquanto o pedido estiver ativo; depois de concluído ou cancelado, expira em 30 dias. A resposta inclui pedido e estado de pagamento com dados mínimos, sem endereço completo ou dados pessoais desnecessários. A consulta deve permanecer disponível quando Redis estiver indisponível, usando rate limit degradado em memória por processo, identificado por derivação do token e IP; esse fallback não é distribuído.
- `POST /pedidos/acompanhamento/recuperar`: implementado na Sprint 12; recebe número e telefone da compra, retorna erro genérico, e em sucesso emite token novo que invalida o anterior. Válido durante pedido ativo; expira no horário salvo pelo fluxo terminal. Sem OTP. Rate limit segue pendente.
- `POST /pedidos/:id/solicitacoes-cancelamento` e `POST /pedidos/:id/tentativas-pagamento`: visitante pode usar token válido; cancelamento aguarda decisão ADMIN, retry PIX obedece limite máximo de duas tentativas e prazos. As operações são limitadas e não alteram snapshots.
- `DELETE /admin/pedidos/:id/acompanhamento`: ADMIN revoga token, sem retornar hash/token.
- Token autoriza somente consultar pedido/pagamento, solicitar cancelamento (efetivado apenas após decisão ADMIN) e solicitar retry PIX. Nunca autoriza editar endereço, produtos, quantidades, adicionais, valores ou histórico.
- Cliente autenticado vê apenas pedidos próprios. Snapshots não são recompostos pelo catálogo atual.

## 11. Etapa I — Administração, cancelamento e reembolso (Sprint 15)

- `GET /admin/pedidos`, `GET /admin/pedidos/:id`: ADMIN, filtros validados, `select` e paginação conforme necessidade medida.
- `PATCH /admin/pedidos/:id/status`: somente ADMIN, transições operacionais permitidas e histórico na mesma transação. Usar exatamente `PENDENTE`, `CONFIRMADO`, `PREPARANDO`, `PRONTO`, `SAIU_PARA_ENTREGA`, `CONCLUIDO`, `CANCELADO`; entrega pode avançar `PRONTO → SAIU_PARA_ENTREGA → CONCLUIDO`; retirada `PRONTO → CONCLUIDO`. `CONCLUIDO` nunca transita para `CANCELADO`.
- `POST /pedidos/:id/solicitacoes-cancelamento`: cliente autenticado ou visitante com token válido registra motivo/horário; visitante não altera estado, decisão é exclusiva do ADMIN.
- `PATCH /admin/pedidos/:id/solicitacoes-cancelamento/:solicitacaoId`: ADMIN decide, registra responsável, data e justificativa quando aplicável. Pode decidir mesmo `PRONTO`/em rota; pedido `CONCLUIDO` não admite solicitação nem transição para `CANCELADO`, e problemas posteriores seguem o processo financeiro.
- Cancelamento não fecha reembolso. PIX não pago cancela sem reembolso; PIX pago cria registro individual de reembolso pendente, iniciado manualmente por ADMIN. Devolução presencial registra valor, responsável e data. Pedido pago/cancelado não aceita nova tentativa; evento PIX tardio segue exceção financeira.
- `POST /admin/pedidos/:id/reembolsos` registra início manual de reembolso PIX; `PATCH /admin/pedidos/:id/reembolsos/:reembolsoId` registra confirmação e responsável/data. Para devolução presencial, registrar cada ocorrência manual com valor, ADMIN responsável e data. Um pedido pode ter vários registros; reembolso parcial fica desabilitado no MVP.
- Pagamento tardio após pedido cancelado deixa a tentativa original `PAGO`, o estado financeiro do pedido `REEMBOLSO_PENDENTE` e mantém `status=CANCELADO`. Se duas tentativas forem pagas, registrar ocorrência duplicada e encaminhar à análise ADMIN, sem reembolso automático.
- Cada decisão/transição é auditada e concorrência gera `409`; endpoints não alteram snapshots financeiros.

## 12. Etapa J — Dashboard e segurança (Sprints 16–18)

`GET /admin/dashboard?periodo=dia|mes|semestre|ano&referencia=...` (ADMIN) agrupa no PostgreSQL por calendário `America/Sao_Paulo`, usando semestre civil (janeiro–junho ou julho–dezembro) e instantes persistidos em UTC. Separar valor bruto dos pedidos, valores recebidos e reembolsos confirmados; reembolso pendente não é subtraído como concluído. Não chamar dados simulados de dinheiro real.

Rate limiting: proteger login, criação de pedido, primeira cobrança PIX, criação da segunda tentativa PIX, pagamento, validação de cupom, recuperação de token, solicitação de cancelamento e recuperação de senha se houver. A proteção da primeira e da segunda cobrança aplica-se a clientes e visitantes; repetição idempotente não cria nova tentativa. Desenvolvimento: memória; testes: limites controlados e isolados; produção: Redis compartilhado; responder `429` quando aplicável. Não inventar números; propor e justificar limites por operação antes da produção. Se Redis estiver indisponível em produção, bloquear operações sensíveis que alteram estado. A consulta GET por token permanece disponível com rate limit degradado em memória por processo, por derivação do token e IP; não é proteção distribuída e deve ser complementada por proteção de borda se disponível. Redis não é obrigatório localmente e não será cache.

## 13. Códigos e semântica de erro planejados

- `200`: leitura, prévia, replay idempotente ou atualização com corpo.
- `201`: novo pedido, configuração ou tentativa criada.
- `204`: operação sem resposta, quando aplicável.
- `400`: schema/regra/cupom/método/modalidade/faixa inválida.
- `401`: sessão ou autorização de token exigida ausente/inválida.
- `403`: usuário sem papel/permissão administrativa.
- `404`: recurso inexistente/inacessível sem revelar propriedade.
- `409`: unicidade, idempotência incompatível, faixa inconsistente, transição ou concorrência inválida.
- `429`: limite de requisições excedido.
- `500`: falha inesperada com resposta genérica e sem stack trace.

Contratos OpenAPI devem corresponder às respostas testadas; não mapear falha de banco/provedor para sucesso.
