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
    ├── autorização/autenticação (futuro)
    └── plugins compartilhados
          ├── Prisma
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
