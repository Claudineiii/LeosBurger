import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import {
  serializarFaixaFrete,
  substituirFaixasFrete,
  substituicaoFaixasSchema,
} from "../services/faixas-frete.js";

const faixaResponseSchema = z.object({
  id: z.string().uuid(),
  distanciaMinima: z.number(),
  distanciaMaxima: z.number(),
  valor: z.string(),
  ativa: z.boolean(),
});
const erroSchema = z.object({
  status: z.number(),
  error: z.string(),
  message: z.string(),
});

function enviarErro(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ status, error, message });
}

export async function faixasFreteAdminRoutes(app: FastifyInstance) {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/admin/faixas-frete",
    {
      preHandler: [app.autorizarAdmin],
      schema: {
        description: "Lista as faixas de frete, inclusive as desativadas.",
        tags: ["Administração", "Frete"],
        security: [{ sessionCookie: [] }],
        response: { 200: z.array(faixaResponseSchema), 401: erroSchema, 403: erroSchema },
      },
    },
    async () => {
      const faixas = await app.prisma.faixaFrete.findMany({
        orderBy: [{ distanciaMinima: "asc" }, { id: "asc" }],
      });
      return faixas.map(serializarFaixaFrete);
    },
  );

  routes.put(
    "/admin/faixas-frete",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description:
          "Substitui atomicamente todas as faixas ativas; uma lista vazia desativa a entrega.",
        tags: ["Administração", "Frete"],
        security: [{ sessionCookie: [] }],
        body: substituicaoFaixasSchema,
        response: {
          200: z.array(faixaResponseSchema),
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const faixas = await substituirFaixasFrete(app.prisma, request.body);
        return faixas.map(serializarFaixaFrete);
      } catch (erro) {
        if (erro instanceof Error && erro.message === "FAIXA_FRETE_INEXISTENTE") {
          return enviarErro(reply, 404, "NOT_FOUND", "Uma das faixas informadas não existe.");
        }
        if (
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === "P2025"
        ) {
          return enviarErro(reply, 404, "NOT_FOUND", "Uma das faixas informadas não existe.");
        }
        if (erro instanceof z.ZodError) {
          return enviarErro(reply, 400, "VALIDATION_ERROR", "As faixas de frete são inválidas.");
        }
        throw erro;
      }
    },
  );
}
