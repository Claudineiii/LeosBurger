📂 `docs/02_ARQUITETURA_E_INFRAESTRUTURA.md`

````markdown
# Arquitetura e infraestrutura do LEOSBurger

## 1. Visão do produto

O LEOSBurger permite que clientes consultem o cardápio e façam pedidos online. O MVP inclui uma área administrativa para gerenciar catálogo, combos e pedidos, além de um dashboard baseado nos dados de vendas. O pagamento é simulado.

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

O plugin `src/plugins/autenticacao.ts` registra JWT, cookies e CORS com credenciais limitado à origem exata configurada em `FRONTEND_ORIGIN`. A variável é obrigatória em produção e precisa conter uma origem HTTPS. Ele disponibiliza os hooks `app.autenticar`, `app.autorizarAdmin` e `app.verificarOrigem` para rotas futuras. Em cada requisição protegida, o JWT assinado HS256 fornece apenas o identificador do usuário; o servidor consulta no Prisma o usuário ativo e seu papel atual.

A sessão é stateless: o JWT fica em cookie `HttpOnly`, `SameSite=Strict`, `Path=/` e `Secure` em produção; a expiração é de 30 dias para clientes e 12 horas para ADMIN. Logout remove o cookie do navegador, sem revogar tokens previamente copiados. Não existe tabela de sessão, armazenamento em memória ou refresh token. Operações de escrita que usam cookies devem verificar a origem via `app.verificarOrigem`; origens CORS são permitidas somente quando correspondem a `FRONTEND_ORIGIN`. Não habilite wildcard com credenciais.
