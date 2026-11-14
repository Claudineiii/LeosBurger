# LEOSBurger

Plataforma de pedidos online para lanchonete, com cardápio digital integrado.

## Status

Projeto em desenvolvimento. O backend inclui catálogo, autenticação, administração, endereços, checkout, criação transacional de pedidos e tentativas de pagamento com simulador restrito a desenvolvimento/testes. Gateway PIX real e dashboard ainda não estão implementados. O estado das Sprints 11–18 está em [`docs/`](./docs/).

## Stack

- Backend: Node.js, TypeScript, Fastify, PostgreSQL, Prisma, Docker, Zod e Vitest.
- Frontend planejado: HTML, TypeScript e Tailwind CSS. A pasta e as dependências do frontend ainda não foram localizadas; Vite, daisyUI e Flowbite não devem ser presumidos como instalados.

## Testes

Consulte [docs/07_TESTES.md](./docs/07_TESTES.md) para configurar o banco local isolado e executar migrations e testes.

Consulte [docs/03_REGRAS_DE_NEGOCIO.md](./docs/03_REGRAS_DE_NEGOCIO.md) e [docs/sprints/README.md](./docs/sprints/README.md) antes de planejar checkout, pagamentos ou cupons. O pagamento PIX real não foi integrado nem escolhido; cartão online está fora do MVP.
