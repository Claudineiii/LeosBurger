import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";

const comboResponseSchema = z.object({
  id: z.string(),
  nome: z.string(),
  descricao: z.string().nullable(),
  preco: z.number(),
  imagemUrl: z.string().nullable(),
  ordem: z.number(),
  itens: z.array(
    z.object({
      id: z.string(),
      nome: z.string(),
      quantidade: z.number(),
    }),
  ),
});

const combosResponseSchema = z.array(comboResponseSchema);

const erroInternoResponseSchema = z.object({
  status: z.literal(500),
  error: z.literal("INTERNAL_SERVER_ERROR"),
  message: z.string(),
});

export async function combosRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/combos",
    {
      schema: {
        description: "Lista os combos ativos com todos os componentes disponíveis.",
        tags: ["Combos"],
        response: {
          200: combosResponseSchema,
          500: erroInternoResponseSchema,
        },
      },
    },
    async () => {
      const combos = await app.prisma.combo.findMany({
        where: {
          ativo: true,
          itensCombo: {
            some: {},
            every: {
              item: {
                ativo: true,
              },
            },
          },
        },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }, { id: "asc" }],
        select: {
          id: true,
          nome: true,
          descricao: true,
          preco: true,
          imagemUrl: true,
          ordem: true,
          itensCombo: {
            orderBy: [{ item: { nome: "asc" } }, { itemId: "asc" }],
            select: {
              quantidade: true,
              item: {
                select: {
                  id: true,
                  nome: true,
                },
              },
            },
          },
        },
      });

      return combos.map((combo) => ({
        id: combo.id,
        nome: combo.nome,
        descricao: combo.descricao,
        preco: combo.preco.toNumber(),
        imagemUrl: combo.imagemUrl,
        ordem: combo.ordem,
        itens: combo.itensCombo.map(({ item, quantidade }) => ({
          id: item.id,
          nome: item.nome,
          quantidade,
        })),
      }));
    },
  );
}
