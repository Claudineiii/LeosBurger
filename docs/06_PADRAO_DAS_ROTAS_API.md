# Padrão das rotas da API

## 1. Objetivo e escopo

Este guia registra o que está comprovado na API atual e estabelece um procedimento para implementar e verificar futuras rotas com Fastify, TypeScript, Zod, Prisma, OpenAPI/Scalar e Vitest.

O guia registra as rotas públicas de catálogo e a base de autenticação já implementadas; não implementa administração, perfil ou pedidos. O código real continua sendo a referência: confira os arquivos antes de reutilizar qualquer exemplo.

## 2. Pré-requisitos

- Node.js e dependências instaladas pelo projeto.
- TypeScript em ESM/NodeNext; os imports locais usam extensão `.js`.
- Para executar a API, configure `JWT_SECRET` (mínimo 32 bytes) e `FRONTEND_ORIGIN` (origem exata, sem caminho); o exemplo local é `http://localhost:5173`. Gere o segredo localmente com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` e não o inclua no Git.
- Para executar os testes, configure `.env.test` a partir de `.env.test.example`, com `TEST_DATABASE_URL` apontando para o banco local `leosburger_test`. Não use a URL do banco de desenvolvimento.
- PostgreSQL de teste ativo e migrations aplicadas com `npm run db:test:migrate`.
- Não execute o seed como preparação automática de testes: ele exige credenciais de administrador e altera dados. A suíte atual não cria fixtures de categorias.

## 3. Mapa dos arquivos envolvidos

| Arquivo                                       | Responsabilidade observada                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/app.ts`                                  | Cria a instância Fastify e registra plugins e grupos de rotas.                            |
| `src/server.ts`                               | Cria a aplicação, inicia o listener e registra/fecha a aplicação ao falhar o início.      |
| `src/plugins/prisma.ts`                       | Cria e conecta o Prisma Client, decora `app.prisma` e desconecta no fechamento.           |
| `src/plugins/autenticacao.ts`                  | Registra JWT, cookies e CORS restrito; fornece autenticação, autorização ADMIN e validação de origem. |
| `src/plugins/documentacao.ts`                 | Configura os compiladores Zod, Swagger/OpenAPI e a interface Scalar em `/reference`.      |
| `src/types/fastify.d.ts`                      | Declara `prisma` na tipagem de `FastifyInstance`.                                         |
| `src/routes/health.ts`                        | Define `GET /health`.                                                                     |
| `src/routes/categorias.ts`                    | Define `GET /categorias`, seu contrato de resposta e consulta Prisma.                     |
| `src/routes/auth.ts`                           | Define cadastro, login, logout e consulta dos dados públicos do usuário autenticado.      |
| `tests/api/`                                  | Testes HTTP/API que criam a aplicação e requisitam rotas.                                 |
| `tests/banco/`                                | Testes de integridade do banco.                                                           |
| `scripts/test-database.ts`                    | Valida e injeta a URL exclusiva do banco de teste antes de Vitest ou migrations de teste. |
| `vitest.config.ts`                            | Carrega o ambiente seguro de teste também quando Vitest é invocado diretamente.           |
| `prisma/schema.prisma` e `prisma/migrations/` | Modelo e histórico do banco; não são parte da implementação de uma rota comum.            |

Não há atualmente diretórios de services, repositories ou schemas compartilhados para a API. A rota de categorias consulta Prisma diretamente; não crie camadas vazias por antecipação.

## 4. Fluxo de uma requisição

1. `src/server.ts` chama `criarAplicacao()` de `src/app.ts`.
2. `app.ts` cria o Fastify, registra Prisma, documentação, tratamento de erros e autenticação, e então registra os grupos de rotas.
3. O plugin Prisma conecta o cliente na inicialização Fastify e o disponibiliza como `app.prisma`. Ao fechar a aplicação, o hook `onClose` desconecta.
4. O grupo de rotas registra handlers HTTP. Na rota de categorias, o handler consulta apenas categorias ativas, ordena por `ordem` e seleciona explicitamente os campos públicos.
5. Se a rota declara schemas Zod, os compiladores registrados pelo plugin fazem a validação/serialização compatível com Fastify e a transformação para OpenAPI.
6. Fastify serializa a resposta e o plugin Swagger gera a especificação; Scalar a apresenta em `/reference`. As rotas autenticadas documentam o esquema de segurança de cookie.

O plugin Prisma é registrado na aplicação toda. Portanto, até testes de rotas que não consultam o banco iniciam a aplicação com a conexão Prisma; os testes de API devem usar o ambiente protegido descrito acima.

## 5. Estrutura, registro e responsabilidades

- Coloque cada grupo de endpoints em `src/routes/<dominio>.ts`; o exemplo observado é `categorias.ts`, exportando `categoriasRoutes`.
- Registre o grupo em `src/app.ts` com `app.register(nomeRoutes)`. Mantenha `app.ts` como ponto de composição e `server.ts` como ponto de inicialização, não de declaração de endpoints.
- Declare no arquivo de rota o caminho, método, schema OpenAPI e handler que pertencem àquele grupo.
- Para rotas privadas, use os hooks fornecidos pelo plugin de autenticação; não replique validação de JWT ou papel nos handlers.
- Use serviço quando houver regra de negócio que mereça separação/reuso; use repository apenas se o acesso a dados justificar a camada. A implementação atual não comprova a necessidade de nenhuma dessas camadas.
- Escolha e registre os caminhos antes de implementar novas rotas; a rota existente usa `/categorias` (plural em português).

Exemplo reduzido do padrão existente de contrato:

```ts
const respostaSchema = z.array(
  z.object({
    id: z.string(),
    nome: z.string(),
    descricao: z.string().nullable(),
    ordem: z.number(),
  }),
);

app.withTypeProvider<ZodTypeProvider>().get(
  "/categorias",
  {
    schema: {
      description: "Lista as categorias ativas do cardápio.",
      tags: ["Categorias"],
      response: { 200: respostaSchema },
    },
  },
  handler,
);
```

O exemplo ilustra o contrato observado; não é um endpoint novo nem substitui a implementação real.

## 6. Validação com Zod

O plugin `src/plugins/documentacao.ts` configura `validatorCompiler` e `serializerCompiler` de `@fastify/type-provider-zod`. A rota de categorias obtém tipagem Zod por meio de `app.withTypeProvider<ZodTypeProvider>()`. Não instale nem crie outro plugin de validação para repetir essa integração.

Para cada entrada realmente aceita por uma nova rota:

- use `schema.params` para parâmetros de caminho, `schema.querystring` para query strings e `schema.body` para corpo;
- defina schemas Zod no contrato da rota e derive os tipos da própria definição, em vez de manter validação e tipo manual duplicados;
- declare também `schema.response` para os status de sucesso e erro que a rota documenta;
- rejeite entradas inválidas pelo mecanismo de validação; não converta a falha em sucesso nem ignore campos inválidos silenciosamente;
- escreva testes que enviem entradas inválidas e confirmem o status e o formato realmente observado.

`/itens` valida `categoriaId` em query e UUID em parâmetro; `/combos/:id` valida UUID; as rotas de autenticação validam body com schemas estritos. Os testes de API verificam os formatos de validação usados por essas rotas.

## 7. Prisma, respostas e códigos HTTP

### Prisma e campos públicos

- Acesse o cliente via `app.prisma`, cuja decoração está tipada em `src/types/fastify.d.ts`.
- Reutilize as operações Prisma no handler como em `categoriasRoutes`; não acesse diretamente o banco por outro mecanismo.
- Prefira `select` explícito dos campos necessários, como faz `/categorias`, em vez de retornar o registro inteiro.
- Para uma resposta pública, defina um schema Zod compatível em `schema.response` e mantenha o `select` alinhado a esse contrato. O schema da resposta e o `select` formam uma proteção em duas partes contra exposição acidental de campos internos.
- Para uma entidade inexistente, responda `404` quando isso fizer parte do contrato da operação. Não transforme toda falha do Prisma em `404`.
- Em `GET /itens/:id`, a consulta combina o identificador com `ativo: true`; assim, itens inexistentes e inativos recebem o mesmo `404` genérico e não revelam a existência de registros desativados.
- Trate erros conhecidos de banco apenas quando a rota puder mapeá-los corretamente (por exemplo, conflito de unicidade para `409`); erros não previstos devem continuar sendo falhas, não respostas de sucesso.
- Nunca inclua hashes, credenciais, detalhes internos ou mensagens de banco desnecessárias na resposta pública.

### Critérios de status

| Código | Quando é apropriado                                                                      |
| ------ | ---------------------------------------------------------------------------------------- |
| `200`  | Operação concluída com resposta, como a listagem atual de categorias.                    |
| `201`  | Criação de recurso concluída e identificável na resposta ou em cabeçalho apropriado.     |
| `204`  | Operação concluída sem corpo; não envie JSON junto com este status.                      |
| `400`  | Entrada inválida ou requisição malformada, conforme contrato da rota.                    |
| `401`  | Credenciais/autenticação ausentes ou inválidas em rota protegida.                        |
| `403`  | Identidade autenticada sem autorização para a operação.                                  |
| `404`  | Recurso solicitado não existe ou não deve ser revelado ao chamador.                      |
| `409`  | Conflito de unicidade ou de estado que impeça a operação.                                |
| `500`  | Falha inesperada do servidor; não use para erros esperados que tenham status específico. |

Esses códigos são critérios, não uma lista obrigatória para cada endpoint. A autenticação usa `201` no cadastro, `204` no logout, `401` para ausência/falha de autenticação, `403` para origem/papel não autorizado e `409` para duplicidade.

### Autenticação, autorização e CSRF

- `POST /auth/cadastro`, `POST /auth/login`, `POST /auth/logout` e `GET /auth/me` estão implementadas em `src/routes/auth.ts`.
- `app.autenticar` valida exclusivamente o JWT do cookie `leosburger_session`, verifica a assinatura HS256 e a expiração, e consulta no Prisma o usuário ativo. O token contém somente `sub`; o papel e os dados públicos vêm do registro atual no banco.
- Proteja uma rota privada com `onRequest: [app.autenticar]`. Use `preHandler: [app.autorizarAdmin]` em rotas administrativas; esse hook autentica, consulta o papel atual e permite somente `ADMIN` ativo. Não confie em papel do body/query/header.
- Em rotas que alteram estado usando cookie, inclua `app.verificarOrigem` no `preHandler` antes da autorização. O hook rejeita `Origin` diferente de `FRONTEND_ORIGIN`; requisições sem `Origin` permanecem aceitas para clientes não navegador.
- CORS com credenciais aceita somente a origem exata de `FRONTEND_ORIGIN`; não use wildcard. Cookies são `HttpOnly`, `SameSite=Strict`, `Path=/` e `Secure` em produção.
- O JWT dura 30 dias para cliente e 12 horas para ADMIN. `/auth/logout` responde `204` e remove o cookie do navegador com os mesmos atributos de criação. Não há revogação no servidor: um JWT copiado segue válido até `exp`, salvo se a conta for desativada.
- Configure `JWT_SECRET` com pelo menos 32 bytes. Configure `FRONTEND_ORIGIN` como uma origem HTTP/HTTPS sem caminho; em produção, ela deve usar HTTPS.
- Cadastro público sempre cria `CLIENTE`, normaliza o e-mail, usa bcrypt e nunca devolve `senhaHash`. O login usa a mesma resposta genérica para e-mail inexistente e senha incorreta.

### Tratamento centralizado de erros

`src/plugins/erros.ts` registra `setErrorHandler` e `setNotFoundHandler` por meio de `fastify-plugin`, e `src/app.ts` o registra com os plugins de infraestrutura antes das rotas. Todas as respostas de erro usam o formato:

```json
{
  "status": 400,
  "error": "VALIDATION_ERROR",
  "message": "Os dados da requisição são inválidos.",
  "details": [{ "field": "/nome", "message": "..." }]
}
```

`details` é opcional e, para validação Zod, contém uma entrada por problema com `field` (caminho da entrada) e `message`. A resposta não repassa metadados internos do validador.

O handler usa `hasZodFastifySchemaValidationErrors` para erros de entrada e devolve `400` com código `VALIDATION_ERROR`. Para outros erros, somente instâncias de classes HTTP reconhecidas de Fastify podem manter o status 4xx, validado no intervalo de 400 a 499; o código e a mensagem enviados ao cliente vêm de valores fixos, nunca do conteúdo arbitrário do erro. Erros desconhecidos, mesmo que tenham propriedades `statusCode` ou `message`, viram 500 genérico. Uma rota inexistente recebe 404 pelo `setNotFoundHandler`.

Falhas inesperadas e erros identificados por `isResponseSerializationError` resultam em `500 INTERNAL_SERVER_ERROR`. O erro completo é enviado a `request.log.error`; stack trace e mensagem interna não são enviados ao cliente. `GET /categorias` documenta esse schema de resposta 500 no próprio contrato OpenAPI.

O projeto não instala nem registra `@fastify/sensible`, nem possui uma classe própria de erro HTTP de domínio. Portanto, mensagens personalizadas como “Categoria não encontrada.” não são consideradas confiáveis nem publicadas nesta etapa; criar um mecanismo para erros de domínio depende de uma decisão técnica futura. Os testes `tests/api/erros.test.ts` registram rotas auxiliares somente na instância de teste e cobrem validação Zod, 404, status arbitrário rejeitado, falha inesperada e incompatibilidade de serialização sem publicar detalhes internos. Um teste cobre em conjunto os dois cenários 500 (erro inesperado e serialização).

## 8. OpenAPI e Scalar

- O plugin atual registra Swagger em modo dinâmico com título `LEOSBurger API`, versão `1.0.0` e `jsonSchemaTransform`; o prefixo Scalar é `/reference`.
- A rota de categorias define descrição, tag e schema de resposta no objeto `schema`. Defina ali também parâmetros, corpo, exemplos e respostas de erro realmente suportados pela rota. Não publique exemplos de uma regra que o handler não executa.
- O Scalar serve a UI em `/reference/` e a especificação JSON em `/reference/openapi.json`; a requisição exata a `/reference` responde com redirecionamento para a barra final. A especificação não está em `/documentation/json` nesta configuração.
- Para conferir: inicie a API com `npm run dev`, abra `/reference/`, localize o método/caminho, compare descrição, entradas e schemas com o handler e consulte `/reference/openapi.json` para a especificação gerada.
- Compare a resposta documentada com a real por teste `app.inject` e, se necessário, com uma requisição local. Se um schema de resposta for declarado, valide os campos/status que o handler efetivamente retorna.
- `/health` atualmente não declara um schema de rota explícito; por isso, sua descrição/contrato de resposta não tem o mesmo nível de detalhe de `/categorias`. Não presuma que aparecer na UI equivale a possuir contrato completo.

## 9. Testes de API com Vitest

- Salve testes em `tests/api/<dominio>.test.ts`; use `describe` pelo método/caminho e `it` para comportamentos distintos.
- Crie a aplicação com `criarAplicacao()` de `src/app.ts`. Faça requisições HTTP com `app.inject({ method, url, payload })`; não é necessário abrir uma porta para esses testes.
- Feche sempre a aplicação em `finally` com `await app.close()`, para executar os hooks de fechamento do Prisma.
- Teste separadamente sucesso, entradas inválidas, ausência de recurso e outros erros que a rota declare. Confira status, formato JSON, campos públicos e, quando aplicável, ausência de dados internos. `tests/api/erros.test.ts` demonstra os contratos centrais de validação, 404 e 500.
- `tests/api/prisma.test.ts` chama `await app.ready()` antes de consultar diretamente `app.prisma`. `app.inject` prepara a aplicação para a requisição.
- O teste atual de categorias não cria fixtures e aceita uma lista vazia. Não presuma conteúdo do seed; se uma rota depender de dados específicos, prepare-os explicitamente no banco de teste e limpe somente os registros pertencentes ao teste.

### Proteção do banco

`scripts/test-database.ts` aceita `TEST_DATABASE_URL` do ambiente ou de `.env.test`, verifica que o host é loopback e que o caminho é exatamente `/leosburger_test`, e então define `DATABASE_URL` para o processo filho. `vitest.config.ts` executa essa validação também na inicialização do Vitest. Sem URL segura configurada, os comandos de teste devem falhar antes de acessar o banco.

Use os comandos do wrapper do projeto; não execute Vitest ou migrations de teste contornando `scripts/test-database.ts`. As migrations de teste usam `prisma migrate deploy`, não recriam nem resetam o banco.

## 10. Comandos disponíveis

Os scripts reais de `package.json` são:

```sh
npm run dev
npm run build
npm start
npm test -- --run
npm test -- --run tests/api/categorias.test.ts
npm test -- --run tests/api
npm run test:watch
npm run db:test:migrate
```

Não existe script separado chamado `test:api`; os seletores de arquivo/diretório são argumentos encaminhados ao Vitest pelo script `npm test`. `npm run db:test:migrate` aplica migrations somente ao banco protegido pelo mesmo validador de URL.

## 11. Procedimento para verificar uma rota existente

1. Confira `git status` antes de editar; preserve alterações locais.
2. Abra o arquivo da rota e confirme método, caminho, schema e comportamento do handler.
3. Confira o registro em `src/app.ts` e os plugins usados em `src/plugins/`.
4. Compare a consulta Prisma e o `select` com o contrato público; confira o schema Zod de resposta.
5. Compare a operação em `/reference/` e `/reference/openapi.json` com a implementação; trate ausência de schema como contrato incompleto, não como documentação suficiente.
6. Leia o teste correspondente em `tests/api/` e verifique casos de sucesso e erro.
7. Execute primeiro o teste selecionado com o wrapper seguro; depois a suíte/build necessários para a tarefa.
8. Revise `git diff --check`, `git diff` e `git status`; confirme que schema/migrations/CI não mudaram sem motivo e autorização.

## 12. Checklist reutilizável para nova rota

- [ ] Conferi instruções, plano de API, regras de negócio, estado do Git e implementação atual.
- [ ] Defini método, caminho, acesso e status HTTP com base em comportamento aprovado.
- [ ] Criei ou atualizei o arquivo do domínio em `src/routes/` e exportei seu plugin de rotas.
- [ ] Registrei o grupo em `src/app.ts`; não concentrei endpoints em `server.ts`.
- [ ] Usei o compilador Zod já configurado e schemas para cada entrada usada (params, query e/ou body).
- [ ] Documentei resposta de sucesso e erros reais com schemas coerentes com o handler.
- [ ] Acessei o banco via `app.prisma`; selecionei apenas os campos necessários e não confiei em totais/preços do cliente.
- [ ] Mantive autenticação/autorização e regras de negócio aprovadas; não criei camadas sem justificativa.
- [ ] Em rota privada usei `app.autenticar` ou `app.autorizarAdmin`; em operações de escrita com cookie incluí `app.verificarOrigem`.
- [ ] Cobri sucesso e erros relevantes com `app.inject`; a aplicação é fechada em `finally`.
- [ ] Preparei dados apenas no banco de teste isolado, sem depender do banco de desenvolvimento nem executar seed destrutivo.
- [ ] Conferi rota e contrato em `/reference/` e `/reference/openapi.json`.
- [ ] Rodei o teste selecionado, `npm test -- --run`, `npm run build` e `git diff --check` conforme o escopo; registrei falhas reais.
- [ ] Revisei `git status` e o diff; não alterei banco, CI, dependências, nem arquivos alheios ao escopo.

## 13. Problemas encontrados e decisões

- O índice anterior de `docs/README.md` apontava para documentos que não existem; foi alinhado aos arquivos presentes e a este guia.
- O resumo de estado não listava `categorias.ts`/seu teste e dizia que a integração Zod ainda precisava ser confirmada; os arquivos reais comprovam ambos.
- O plano de APIs registrava apenas `GET /health`, apesar de `GET /categorias` já existir; a documentação foi atualizada sem adicionar endpoint.
- A especificação OpenAPI servida pelo Scalar está em `/reference/openapi.json` e `/reference` redireciona para `/reference/`; o endereço `/documentation/json` não existe nesta configuração.
- `/categorias` é o exemplo de schema de resposta, `select` Prisma e documentação por descrição/tag. As rotas de itens, combos e autenticação também validam parâmetros/body quando aplicável; `tests/api/erros.test.ts` demonstra a validação centralizada em uma rota isolada da aplicação de teste.
- O handler central padroniza validações, erros HTTP Fastify reconhecidos, rotas inexistentes e falhas inesperadas; detalhes das falhas inesperadas ficam apenas no log do servidor. Não há mecanismo instalado para mensagens específicas de erros HTTP do domínio.
- `GET /health` não declara schema/descrição explícitos de resposta no código; o contrato OpenAPI dessa rota está menos completo que o de categorias.

## 14. Pendências que dependem de decisão humana

- Mensagens específicas para erros HTTP intencionais do domínio dependem da escolha de um mecanismo confiável para criá-los; `@fastify/sensible` não está instalado e não foi adicionada dependência nesta tarefa.
- Revisar o formato e os códigos públicos antes de considerá-los estáveis para consumidores externos.
- Completar a documentação OpenAPI de `/health` se o contrato detalhado dessa rota for desejado.
- Definir caminhos e convenções para cada novo domínio antes da implementação; `/categorias` é evidência de plural em português, não uma decisão automática para todos os casos.
