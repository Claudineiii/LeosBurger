import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { type Prisma } from "@prisma/client";
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

const paramsSchema = z.object({
  id: z.string().uuid("id deve ser um UUID válido.").describe("UUID do combo a ser consultado."),
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

const comboDisponivelWhere = {
  ativo: true,
  itensCombo: {
    some: { removidoEm: null },
    every: {
      OR: [{ removidoEm: { not: null } }, { item: { ativo: true } }],
    },
  },
} satisfies Prisma.ComboWhereInput;

const comboPublicoSelect = {
  id: true,
  nome: true,
  descricao: true,
  preco: true,
  imagemUrl: true,
  ordem: true,
  itensCombo: {
    where: { removidoEm: null },
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
} satisfies Prisma.ComboSelect;

type ComboPublico = Prisma.ComboGetPayload<{ select: typeof comboPublicoSelect }>;

function serializarCombo(combo: ComboPublico) {
  return {
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
  };
}

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
        where: comboDisponivelWhere,
        orderBy: [{ ordem: "asc" }, { nome: "asc" }, { id: "asc" }],
        select: comboPublicoSelect,
      });

      return combos.map(serializarCombo);
    },
  );
  app.withTypeProvider<ZodTypeProvider>().get(
    "/combos/:id",
    {
      schema: {
        description: "Busca um combo ativo com todos os componentes disponíveis.",
        tags: ["Combos"],
        params: paramsSchema,
        response: {
          200: comboResponseSchema,
          400: erroValidacaoResponseSchema,
          404: erroNaoEncontradoResponseSchema,
          500: erroInternoResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const combo = await app.prisma.combo.findFirst({
        where: {
          ...comboDisponivelWhere,
          id: request.params.id,
        },
        select: comboPublicoSelect,
      });

      if (!combo) {
        return reply.status(404).send({
          status: 404,
          error: "NOT_FOUND",
          message: "Recurso não encontrado.",
        });
      }

      return serializarCombo(combo);
    },
  );
}
