import { criarAplicacao } from "./app.js";

const app = criarAplicacao();

try {
  await app.listen({
    port: Number(process.env.PORT ?? 3000),
    host: "127.0.0.1",
  });
} catch (erro) {
  app.log.error(erro);
  await app.close();
  process.exitCode = 1;
}
