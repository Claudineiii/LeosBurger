import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { categoriasRoutes } from "./routes/categorias.js";
import prismaPlugin from "./plugins/prisma.js";
import documentacaoPlugin from "./plugins/documentacao.js";
import errosPlugin from "./plugins/erros.js";

export function criarAplicacao() {
  const app = Fastify({
    logger: true,
  });

  app.register(prismaPlugin);
  app.register(documentacaoPlugin);
  app.register(errosPlugin);
  app.register(healthRoutes);
  app.register(categoriasRoutes);

  return app;
}
