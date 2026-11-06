import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import {
  cupomAdminBodySchema,
  salvarCupom,
  serializarCupom,
} from "../services/cupons.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const cupomResponseSchema = z.object({
  id: z.string().uuid(),
  codigo: z.string(),
  tipoDesconto: z.enum(["FIXO", "PERCENTUAL"]),
  valor: z.string(),
  ativo: z.boolean(),
  validadeInicio: z.string(),
  validadeFim: z.string(),
  compraMinima: z.string().nullable(),
  limiteUsos: z.number().int().nullable(),
  itemIds: z.array(z.string().uuid()),
  comboIds: z.array(z.string().uuid()),
});
const erroSchema = z.object({
  status: z.number(),
  error: z.string(),
  message: z.string(),
  details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});

function enviarErro(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ status, error, message });
}

function mapearErroCupom(erro: unknown, reply: FastifyReply) {
  if (erro instanceof Prisma.PrismaClientKnownRequestError) {
    if (erro.code === "P2002") {
      enviarErro(reply, 409, "CONFLICT", "Já existe um cupom com esse código.");
      return true;
    }
    if (erro.code === "P2025") {
      enviarErro(reply, 404, "NOT_FOUND", "Cupom não encontrado.");
      return true;
    }
  }
  if (erro instanceof Error && erro.message === "ELEGIBILIDADE_CUPOM_INVALIDA") {
    enviarErro(reply, 400, "VALIDATION_ERROR", "Um item ou combo elegível não existe.");
    return true;
  }
  return false;
}

export async function cuponsAdminRoutes(app: FastifyInstance) {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/admin/cupons",
    {
      preHandler: [app.autorizarAdmin],
      schema: {
        description: "Lista cupons e suas relações de elegibilidade.",
        tags: ["Administração", "Cupons"],
        security: [{ sessionCookie: [] }],
        response: { 200: z.array(cupomResponseSchema), 401: erroSchema, 403: erroSchema },
      },
    },
    async () => {
      const cupons = await app.prisma.cupom.findMany({
        include: {
          itensElegiveis: { select: { itemId: true } },
          combosElegiveis: { select: { comboId: true } },
        },
        orderBy: [{ codigo: "asc" }, { id: "asc" }],
      });
      return cupons.map(serializarCupom);
    },
  );

  routes.post(
    "/admin/cupons",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description: "Cria um cupom com suas regras e elegibilidades.",
        tags: ["Administração", "Cupons"],
        security: [{ sessionCookie: [] }],
        body: cupomAdminBodySchema,
        response: {
          201: cupomResponseSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const cupom = await salvarCupom(app.prisma, request.body);
        const completo = await app.prisma.cupom.findUniqueOrThrow({
          where: { id: cupom.id },
          include: {
            itensElegiveis: { select: { itemId: true } },
            combosElegiveis: { select: { comboId: true } },
          },
        });
        return reply.code(201).send(serializarCupom(completo));
      } catch (erro) {
        if (mapearErroCupom(erro, reply)) {
          return reply;
        }
        if (erro instanceof z.ZodError) {
          return enviarErro(reply, 400, "VALIDATION_ERROR", "Os dados do cupom são inválidos.");
        }
        throw erro;
      }
    },
  );

  routes.put(
    "/admin/cupons/:id",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description: "Substitui a configuração completa de um cupom.",
        tags: ["Administração", "Cupons"],
        security: [{ sessionCookie: [] }],
        params: paramsSchema,
        body: cupomAdminBodySchema,
        response: {
          200: cupomResponseSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const cupom = await salvarCupom(app.prisma, request.body, request.params.id);
        const completo = await app.prisma.cupom.findUniqueOrThrow({
          where: { id: cupom.id },
          include: {
            itensElegiveis: { select: { itemId: true } },
            combosElegiveis: { select: { comboId: true } },
          },
        });
        return serializarCupom(completo);
      } catch (erro) {
        if (mapearErroCupom(erro, reply)) {
          return reply;
        }
        if (erro instanceof z.ZodError) {
          return enviarErro(reply, 400, "VALIDATION_ERROR", "Os dados do cupom são inválidos.");
        }
        throw erro;
      }
    },
  );
}
