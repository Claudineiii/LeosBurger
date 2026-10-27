import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";

const querySchema = z.object({
  categoriaId: z
    .string()
    .uuid("categoriaId deve ser um UUID válido.")
    .optional()
    .describe("UUID da categoria para filtrar os itens."),
});

const itemResponseSchema = z.object({
  id: z.string(),
  categoriaId: z.string(),
  nome: z.string(),
  descricao: z.string().nullable(),
  preco: z.number(),
  imagemUrl: z.string().nullable(),
  ordem: z.number(),
});

const itensResponseSchema = z.array(itemResponseSchema);

const paramsSchema = z.object({
  id: z.string().uuid("id deve ser um UUID válido.").describe("UUID do item a ser consultado."),
});

const erroValidacaoResponseSchema = z.object({
  status: z.literal(400),
  error: z.literal("VALIDATION_ERROR"),
  message: z.string(),
  details: z
    .array(
      z.object({
        field: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

const erroNaoEncontradoResponseSchema = z.object({
  status: z.literal(404),
  error: z.literal("NOT_FOUND"),
  message: z.string(),
});

const erroInternoResponseSchema = z.object({
  status: z.literal(500),
  error: z.literal("INTERNAL_SERVER_ERROR"),
  message: z.string(),
});

export async function itensRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/itens",
    {
      schema: {
        description: "Lista os itens ativos do cardápio.",
        tags: ["Itens"],
        querystring: querySchema,
        response: {
          200: itensResponseSchema,
          400: erroValidacaoResponseSchema,
          500: erroInternoResponseSchema,
        },
      },
    },
    async (request) => {
      const itens = await app.prisma.item.findMany({
        where: {
          ativo: true,
          ...(request.query.categoriaId ? { categoriaId: request.query.categoriaId } : {}),
        },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }, { id: "asc" }],
        select: {
          id: true,
          categoriaId: true,
          nome: true,
          descricao: true,
          preco: true,
          imagemUrl: true,
          ordem: true,
        },
      });

      return itens.map((item) => ({
        ...item,
        preco: item.preco.toNumber(),
      }));
    },
  );
  app.withTypeProvider<ZodTypeProvider>().get(
    "/itens/:id",
    {
      schema: {
        description: "Busca um item ativo pelo ID.",
        tags: ["Itens"],
        params: paramsSchema,
        response: {
          200: itemResponseSchema,
          400: erroValidacaoResponseSchema,
          404: erroNaoEncontradoResponseSchema,
          500: erroInternoResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const item = await app.prisma.item.findFirst({
        where: {
          id: request.params.id,
          ativo: true,
        },
        select: {
          id: true,
          categoriaId: true,
          nome: true,
          descricao: true,
          preco: true,
          imagemUrl: true,
          ordem: true,
        },
      });

      if (!item) {
        return reply.status(404).send({
          status: 404,
          error: "NOT_FOUND",
          message: "Recurso não encontrado.",
        });
      }

      return {
        ...item,
        preco: item.preco.toNumber(),
      };
    },
  );
}
