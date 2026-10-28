# Estado atual do LEOSBurger

## Resumo executivo

O LEOSBurger é um cardápio digital com pedidos online. A infraestrutura básica de banco e backend foi preparada. A API possui rotas de saúde, catálogo público de categorias, itens e combos, cadastro/login/logout, identificação do usuário autenticado, autorização reutilizável e documentação OpenAPI exibida pelo Scalar. Administração do catálogo, perfil, endereços e pedidos continuam planejados para as próximas sprints.

## Tecnologias e versões conhecidas

| Área         | Tecnologia                   | Estado conhecido                                                                                                      |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Runtime      | Node.js                      | Ambiente local Windows; versão reportada em documento anterior: 22.18.0. Confirmar com `node -v`.                     |
| Linguagem    | TypeScript                   | Em uso no backend.                                                                                                    |
| Módulos      | ESM / NodeNext               | `type: module`, configuração NodeNext e `verbatimModuleSyntax: true`.                                                 |
| API HTTP     | Fastify 5.x                  | Fundação criada.                                                                                                      |
| Validação    | Zod                          | Compiladores integrados ao Fastify; schemas de query e resposta usados por `/itens` e contratos de resposta de `/categorias` e `/combos`. |
| ORM          | Prisma 6.19.3                | Versão travada por decisão do projeto.                                                                                |
| Banco        | PostgreSQL 16                | Executado em Docker.                                                                                                  |
| Container    | Docker Compose               | Serviço `postgres`, container conhecido `leosburger_postgres`.                                                        |
| Testes       | Vitest 5.0.2                 | Testes de banco e API existentes.                                                                                     |
| Documentação | Swagger/OpenAPI + Scalar     | Plugins configurados; `/categorias`, `/itens` e `/combos` documentam schemas e respostas.                            |
| Autenticação | JWT em cookie HttpOnly        | Implementada na Sprint 7; cookies `SameSite=Strict`, `Secure` em produção, 30 dias para cliente e 12 horas para ADMIN. |
| Frontend     | HTML + TypeScript + Tailwind | Planejado; não usar React.                                                                                            |
| UI opcional  | daisyUI / Flowbite           | Foram considerados para acelerar componentes; confirmar instalação antes de usar.                                     |
| Git          | Git/GitHub                   | A implementação da Sprint 7 partiu do commit `03f2603`; consulte o histórico Git para o estado atual.              |

## Estrutura atual conhecida

```text
C:/LeosBurger/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── plugins/
│   │   ├── prisma.ts
│   │   ├── documentacao.ts
│   │   └── autenticacao.ts
│   ├── routes/
│   │   ├── health.ts
│   │   ├── categorias.ts
│   │   ├── itens.ts
│   │   ├── combos.ts
│   │   └── auth.ts
│   └── types/
│       └── fastify.d.ts
├── tests/
│   ├── api/
│   │   ├── categorias.test.ts
│   │   ├── itens.test.ts
│   │   ├── combos.test.ts
│   │   ├── auth.test.ts
│   │   ├── health.test.ts
│   │   └── prisma.test.ts
│   └── banco/
│       └── integridade.test.ts
├── package.json
├── package-lock.json
└── vitest.config.ts
```

`GET /combos` retorna somente combos ativos com composição não vazia e todos os componentes ativos. A resposta inclui os campos públicos do combo e cada item componente com `id`, `nome` e `quantidade`; preços Decimal são serializados como número.

`GET /combos/:id` retorna os mesmos campos públicos e a mesma composição ordenada, somente para combos disponíveis. O parâmetro `id` é validado como UUID; um identificador inválido retorna `400`, enquanto combos inexistentes, inativos, sem componentes ou com algum componente inativo retornam o mesmo `404` genérico.

## Autenticação e autorização — Sprint 7

A autenticação usa JWT HS256 enviado em cookie; não há token de acesso no corpo da resposta nem armazenamento de sessão no servidor. A implementação está em `src/routes/auth.ts` e `src/plugins/autenticacao.ts`, registrados pela aplicação. O JWT contém o identificador do usuário (`sub`), e cada requisição protegida consulta o banco para confirmar que a conta continua ativa e obter o papel atual. Assim, autorização não depende de um papel enviado pelo cliente nem de uma cópia antiga do papel guardada no token.

| Endpoint | Comportamento |
| --- | --- |
| `POST /auth/cadastro` | Valida nome, e-mail, telefone e senha; remove espaços do nome/e-mail/telefone e normaliza e-mail para minúsculas. Cria sempre `CLIENTE`, armazena a senha com bcrypt e retorna `201` com dados públicos. Propriedades extras, inclusive `tipo`, são rejeitadas. E-mail duplicado retorna `409` genérico. |
| `POST /auth/login` | Normaliza e valida e-mail e senha; autentica somente usuário ativo. Credenciais incorretas, usuário inexistente ou inativo retornam o mesmo `401`. Sucesso retorna dados públicos e define o cookie JWT. |
| `POST /auth/logout` | Retorna `204` e remove o cookie do navegador usando os atributos de criação. Não revoga o JWT no servidor: uma cópia obtida antes do logout continua utilizável até expirar, desde que o usuário siga ativo. |
| `GET /auth/me` | Exige cookie JWT válido e retorna somente `id`, `nome`, `email`, `telefone` e `tipo` do usuário ativo. |

O cookie chama-se `leosburger_session` e usa `HttpOnly`, `SameSite=Strict`, `Path=/` e não define `Domain`. O prazo é de 30 dias para `CLIENTE` e 12 horas para `ADMIN`; o JWT e o cookie têm o mesmo prazo. `Secure` é habilitado em produção. Não há tabela de sessões, refresh token ou mecanismo de revogação. Desativar a conta impede novas requisições autenticadas porque o usuário é revalidado no banco a cada chamada.

O plugin disponibiliza hooks reutilizáveis: `app.autenticar` exige um JWT válido e usuário ativo; `app.autorizarAdmin` também exige o papel atual `ADMIN`; `app.verificarOrigem` verifica a origem nas operações de escrita. Acesso sem autenticação retorna `401`; usuário autenticado sem permissão administrativa retorna `403`. As rotas públicas do catálogo permanecem públicas.

CORS com credenciais permite somente a origem exata de `FRONTEND_ORIGIN`; origens divergentes em operações de escrita são recusadas. Requisições sem cabeçalho `Origin` são aceitas por esse hook, o que permite clientes não navegador. Em produção, `FRONTEND_ORIGIN` é obrigatório e deve ser uma origem HTTPS válida. `JWT_SECRET` também é obrigatório, com pelo menos 32 bytes. Configure esses valores no ambiente de execução, sem incluí-los no repositório.

Os schemas Zod validam e documentam entradas e respostas. Cadastro e login rejeitam campos extras; as respostas selecionam explicitamente os campos públicos e não incluem `senhaHash`. As falhas de validação retornam `400`; erros de credenciais usam resposta genérica `401`; duplicidade no cadastro usa `409`; bloqueio por origem/papel usa `403`. Os endpoints e a segurança por cookie também estão descritos no OpenAPI/Scalar.

Os testes de integração de autenticação exercitam o banco de testes isolado e cobrem cadastro, normalização, hash, respostas sem hash, rejeição de `ADMIN` no cadastro público, duplicidade, login, conta inativa, cookie, tokens ausente/inválido/expirado, logout, acesso privado e autorização ADMIN. Também verificam recusa de origem divergente, preservação das rotas públicas do catálogo e contrato OpenAPI. O registro completo dos critérios e da validação está em [SPRINT-07.md](./sprints/SPRINT-07.md).
