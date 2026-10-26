# Ambiente de testes

Os testes de integração e migrations de teste usam exclusivamente o banco PostgreSQL local `leosburger_test`. Nunca use `DATABASE_URL` do ambiente de desenvolvimento para executá-los.

## Configuração local

1. Inicie o PostgreSQL local com `docker compose up -d postgres`.
2. Copie `.env.test.example` para `.env.test` e mantenha `TEST_DATABASE_URL` apontando para `127.0.0.1:5432/leosburger_test`. `.env.test` é ignorado pelo Git.
3. Aplique as migrations no banco isolado:

   ```sh
   npm run db:test:migrate
   ```

4. Execute a suíte:

   ```sh
   npm test -- --run
   ```

Para execução contínua, use `npm run test:watch`.

O carregador define `DATABASE_URL` a partir de `TEST_DATABASE_URL` e bloqueia qualquer endereço que não seja loopback ou cujo banco não seja exatamente `leosburger_test`. A configuração é aplicada também pelo `vitest.config.ts`, então invocações diretas do Vitest sem o carregador não podem recorrer ao `.env` de desenvolvimento.

## CI

O GitHub Actions fornece `TEST_DATABASE_URL` apontando para seu serviço PostgreSQL temporário, executa `npm run db:test:migrate` e roda a suíte com `npm test -- --run`. Não depende de arquivos `.env` locais.
