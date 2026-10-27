# Estado atual do LEOSBurger

## Resumo executivo

O LEOSBurger é um cardápio digital com pedidos online. A infraestrutura básica de banco e backend foi preparada. A API já inicia com Fastify, possui rotas de saúde, listagem pública de categorias, itens e combos, consulta pública de detalhe de itens e combos, integração com Prisma e documentação OpenAPI exibida pelo Scalar. As demais APIs de negócio ainda serão desenvolvidas gradualmente pelo usuário.

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
| Frontend     | HTML + TypeScript + Tailwind | Planejado; não usar React.                                                                                            |
| UI opcional  | daisyUI / Flowbite           | Foram considerados para acelerar componentes; confirmar instalação antes de usar.                                     |
| Git          | Git/GitHub                   | Branch `main`; commit local `8d3e2da` confirmado no histórico recente. Push remoto não confirmado nesta documentação. |

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
│   │   └── documentacao.ts
│   ├── routes/
│   │   ├── health.ts
│   │   ├── categorias.ts
│   │   ├── itens.ts
│   │   └── combos.ts
│   └── types/
│       └── fastify.d.ts
├── tests/
│   ├── api/
│   │   ├── categorias.test.ts
│   │   ├── itens.test.ts
│   │   ├── combos.test.ts
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
