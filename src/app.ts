import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import prismaPlugin from "./plugins/prisma.js";
import documentacaoPlugin from "./plugins/documentacao.js";

export function criarAplicacao() {
  const app = Fastify({
    logger: true,
  });

  app.register(prismaPlugin);
  app.register(documentacaoPlugin);
  app.register(healthRoutes);

  return app;
}
