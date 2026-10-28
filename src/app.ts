import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { categoriasRoutes } from "./routes/categorias.js";
import { itensRoutes } from "./routes/itens.js";
import { combosRoutes } from "./routes/combos.js";
import prismaPlugin from "./plugins/prisma.js";
import documentacaoPlugin from "./plugins/documentacao.js";
import errosPlugin from "./plugins/erros.js";
import autenticacaoPlugin from "./plugins/autenticacao.js";
import { authRoutes } from "./routes/auth.js";

export function criarAplicacao() {
  const app = Fastify({
    logger: true,
  });

  app.register(prismaPlugin);
  app.register(documentacaoPlugin);
  app.register(errosPlugin);
  app.register(autenticacaoPlugin);
  app.register(healthRoutes);
  app.register(categoriasRoutes);
  app.register(itensRoutes);
  app.register(combosRoutes);
  app.register(authRoutes);

  return app;
}
