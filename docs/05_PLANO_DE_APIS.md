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

`GET /itens` retorna `id`, `categoriaId`, `nome`, `descricao`, `preco`, `imagemUrl` e `ordem`. O campo JSON `adicionais` não é exposto porque o modelo não define um contrato compreensível para a API pública. A resposta ordena por `ordem`, `nome` e `id`; `categoriaId` inválido é rejeitado com `400`.

`GET /itens/:id` retorna os mesmos campos públicos de um item ativo. O parâmetro `id` deve ser UUID; identificador malformado retorna `400`, enquanto item inexistente ou inativo retorna o mesmo `404` genérico. O preço Decimal é convertido para número e `adicionais` permanece fora da resposta.

`GET /combos` e `GET /combos/:id` usam a mesma regra de disponibilidade: somente combos ativos com pelo menos um componente e com todos os itens componentes ativos. Os endpoints retornam `id`, `nome`, `descricao`, `preco`, `imagemUrl`, `ordem` e `itens` (`id`, `nome`, `quantidade`); preços Decimal são convertidos para número. A composição é ordenada por nome do item e ID. Na rota de detalhe, UUID inválido retorna `400`; combo inexistente ou indisponível retorna `404` genérico sem revelar a existência do registro.

## 3.2 Autenticação implementada

| Método | Caminho          | Acesso | Objetivo | Estado |
| ------ | ---------------- | ------ | -------- | ------ |
| POST   | `/auth/cadastro` | Público | Cadastrar cliente com e-mail normalizado e senha em hash. | Implementada; resposta `201`, duplicidade genérica `409`. |
| POST   | `/auth/login`    | Público | Validar credenciais e emitir cookie JWT. | Implementada; credenciais inválidas ou usuário inativo recebem resposta genérica `401`. |
| POST   | `/auth/logout`   | Público | Apagar o cookie de autenticação do navegador. | Implementada; `204`, sem revogação de JWT copiado. |
| GET    | `/auth/me`       | Autenticado | Consultar dados públicos do usuário autenticado. | Implementada; `401` para cookie ausente, inválido, expirado ou usuário inativo. |

O cookie `leosburger_session` é `HttpOnly`, `SameSite=Strict`, `Path=/` e `Secure` em produção. JWT HS256 expira em 30 dias para `CLIENTE` e 12 horas para `ADMIN`. O token contém somente `sub`; o servidor consulta o usuário ativo e seu tipo atual no banco em cada acesso protegido. Os hooks `app.autenticar`, `app.autorizarAdmin` e `app.verificarOrigem` são reutilizáveis nas rotas futuras. CORS com credenciais tem allowlist exata `FRONTEND_ORIGIN`; operações de escrita recusam `Origin` divergente.

Logout encerra o uso da sessão pelo navegador ao remover o cookie com os mesmos atributos de criação. Não há revogação no servidor: um JWT copiado continua válido até `exp`, a menos que o usuário seja desativado. Não há tabela de sessões, refresh token nem migration de autenticação.

## 4. Etapa B — Catálogo público

Endpoints de combos implementados:

- listar combos disponíveis;
- consultar um combo disponível pelo identificador.

Regras:

- o cliente público vê apenas itens/combos disponíveis para venda;
- `GET /combos` retorna somente combos ativos com pelo menos um componente, desde que todos os itens componentes estejam ativos;
- combos sem composição ou com qualquer componente inativo ficam ocultos; nenhum componente é substituído automaticamente;
- a composição pública inclui `id`, `nome` e `quantidade` de cada item, sem campos internos da associação;
- o preço Decimal do combo é convertido para número, e a lista é ordenada por `ordem`, `nome` e `id`;
- não tratar combo como categoria;
- adicionais permitidos devem respeitar a configuração do item;
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

Não há endpoint DELETE: desativação é feita com `PATCH` e `ativo: false`; ativação usa `ativo: true`. Não há CRUD administrativo de combos nesta sprint (Sprint 9). A forma de domínio de `adicionais` ainda não foi aprovada; o backend valida que o valor seja JSON válido, mas não presume campos/preços internos. O checkout futuro deverá validar seleções e recalcular valores.

### Combos planejados para a Sprint 9

- criar/editar/ativar/desativar combos;
- manter composição por meio de `itens_combo`.

Operações administrativas futuras continuarão exigindo autorização ADMIN e deverão preferir desativação quando exclusão comprometer integridade ou histórico.

## 6. Etapa D — Autenticação e perfil

Operações já implementadas:

- `POST /auth/cadastro`;
- `POST /auth/login`;
- `POST /auth/logout`;
- `GET /auth/me`.

Operações ainda planejadas:

- consulta/edição de perfil;
- listar/criar/editar endereço do cliente.

Configuração requerida: `JWT_SECRET` com pelo menos 32 bytes; `FRONTEND_ORIGIN` deve ser a origem exata do frontend e HTTPS em produção. Não exponha hash de senha, cookie ou segredo em logs/respostas.

## 7. Etapa E — Checkout e pedidos

Operações candidatas:

- calcular/validar prévia do checkout;
- criar pedido;
- consultar pedido por identificador;
- listar pedidos do cliente autenticado;
- simular resultado do pagamento;
- atualizar status por usuário autorizado/admin;
- consultar histórico de status.

Regras críticas:

- visitante só finaliza com PIX;
- métodos de pagamento previstos: PIX, crédito, débito e dinheiro, com simulação;
- backend recalcula todos os valores.
