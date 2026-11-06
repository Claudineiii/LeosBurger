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
import { enderecosRoutes } from "./routes/enderecos.js";
import { catalogoAdminRoutes } from "./routes/catalogo-admin.js";
import { combosAdminRoutes } from "./routes/combos-admin.js";
import limpezaReferenciasEnderecoPlugin from "./plugins/limpeza-referencias-endereco.js";
import { checkoutEnderecoVisitanteRoutes } from "./routes/checkout-endereco-visitante.js";
import { cuponsAdminRoutes } from "./routes/cupons-admin.js";
import { faixasFreteAdminRoutes } from "./routes/faixas-frete-admin.js";
import { checkoutPreviewRoutes } from "./routes/checkout-preview.js";

export function criarAplicacao() {
  const app = Fastify({
    logger: true,
  });

  app.register(prismaPlugin);
  app.register(limpezaReferenciasEnderecoPlugin);
  app.register(documentacaoPlugin);
  app.register(errosPlugin);
  app.register(autenticacaoPlugin);
  app.register(healthRoutes);
  app.register(categoriasRoutes);
  app.register(itensRoutes);
  app.register(combosRoutes);
  app.register(authRoutes);
  app.register(enderecosRoutes);
  app.register(checkoutEnderecoVisitanteRoutes);
  app.register(checkoutPreviewRoutes);
  app.register(catalogoAdminRoutes);
  app.register(combosAdminRoutes);
  app.register(cuponsAdminRoutes);
  app.register(faixasFreteAdminRoutes);

  return app;
}
