import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { limparReferenciasECacheExpirados } from "../services/referencias-endereco.js";

const intervaloLimpezaMs = 10 * 60 * 1_000;

async function limpezaReferenciasEnderecoPlugin(app: FastifyInstance) {
  const limpar = async () => {
    const removidos = await limparReferenciasECacheExpirados(app.prisma);
    if (removidos.referencias > 0 || removidos.cache > 0) {
      app.log.info(
        removidos,
        "Referências temporárias e cache Geoapify expirados removidos.",
      );
    }
  };

  const timer = setInterval(() => {
    void limpar().catch((erro: unknown) => {
      app.log.error(
        { err: erro },
        "Falha ao remover referências temporárias e cache Geoapify expirados.",
      );
    });
  }, intervaloLimpezaMs);
  timer.unref();

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
}

export default fp(limpezaReferenciasEnderecoPlugin);
