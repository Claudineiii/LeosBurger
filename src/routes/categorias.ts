import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";

const categoriasResponseSchema = z.array(
  z.object({
    id: z.string(),
    nome: z.string(),
    descricao: z.string().nullable(),
    ordem: z.number(),
  }),
);

const erroInternoResponseSchema = z.object({
  status: z.literal(500),
  error: z.literal("INTERNAL_SERVER_ERROR"),
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

export async function categoriasRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/categorias",
    {
      schema: {
        description: "Lista as categorias ativas do cardápio.",
        tags: ["Categorias"],
        response: {
          200: categoriasResponseSchema,
          500: erroInternoResponseSchema,
        },
      },
    },
    async () =>
      app.prisma.categoria.findMany({
        where: { ativo: true },
        orderBy: { ordem: "asc" },
        select: {
          id: true,
          nome: true,
          descricao: true,
          ordem: true,
        },
      }),
  );
}
