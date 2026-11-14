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
import { pedidosRoutes } from "./routes/pedidos.js";
import { SimuladorPagamentos } from "./services/pagamentos/simulador.js";
import { verificarConfiguracaoLimitesPagamento } from "./services/pagamentos/limites.js";

export function criarAplicacao() {
  verificarConfiguracaoLimitesPagamento();
  const provedorConfigurado = process.env.PAGAMENTOS_PROVEDOR ??
    (process.env.NODE_ENV === "production" ? "" : "simulador");
  if (process.env.NODE_ENV === "production" && provedorConfigurado === "simulador") {
    throw new Error("SIMULADOR_PAGAMENTOS_PROIBIDO_EM_PRODUCAO");
  }
  if (provedorConfigurado && provedorConfigurado !== "simulador") {
    throw new Error("PROVEDOR_PAGAMENTO_NAO_IMPLEMENTADO");
  }
  const app = Fastify({
    logger: true,
  });

  const simulador = provedorConfigurado === "simulador"
    ? new SimuladorPagamentos()
    : null;
  app.decorate("simuladorPagamentos", simulador);
  app.decorate("provedorPagamentos", simulador);

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
  app.register(pedidosRoutes);
  app.register(catalogoAdminRoutes);
  app.register(combosAdminRoutes);
  app.register(cuponsAdminRoutes);
  app.register(faixasFreteAdminRoutes);

  return app;
}
