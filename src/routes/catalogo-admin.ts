import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";

const uuidParamsSchema = z.object({
  id: z.string().uuid("id deve ser um UUID válido."),
});

const ordemSchema = z.number().int().min(-2_147_483_648).max(2_147_483_647);

const nomeSchema = z.string().trim().min(1).max(100);
const descricaoCategoriaSchema = z.string().trim().max(255).nullable();
const descricaoItemSchema = z.string().trim().max(500).nullable();
const imagemUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((valor) => {
    try {
      const url = new URL(valor);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "imagemUrl deve ser uma URL HTTP ou HTTPS válida.")
  .nullable();
const precoSchema = z
  .number()
  .finite()
  .min(0)
  .max(99_999_999.99)
  .refine((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-8, {
    message: "preco deve ter no máximo duas casas decimais.",
  });

const criarCategoriaBodySchema = z
  .object({
    nome: nomeSchema,
    descricao: descricaoCategoriaSchema.optional(),
    ordem: ordemSchema.optional(),
  })
  .strict();

const editarCategoriaBodySchema = z
  .object({
    nome: nomeSchema.optional(),
    descricao: descricaoCategoriaSchema.optional(),
    ordem: ordemSchema.optional(),
    ativo: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

const criarItemBodySchema = z
  .object({
    categoriaId: z.string().uuid(),
    nome: nomeSchema,
    descricao: descricaoItemSchema.optional(),
    preco: precoSchema,
    imagemUrl: imagemUrlSchema.optional(),
    ordem: ordemSchema.optional(),
    adicionais: z.json().nullable().optional(),
  })
  .strict();

const editarItemBodySchema = z
  .object({
    categoriaId: z.string().uuid().optional(),
    nome: nomeSchema.optional(),
    descricao: descricaoItemSchema.optional(),
    preco: precoSchema.optional(),
    imagemUrl: imagemUrlSchema.optional(),
    ordem: ordemSchema.optional(),
    ativo: z.boolean().optional(),
    adicionais: z.json().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

const categoriaAdminSchema = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  descricao: z.string().nullable(),
  ativo: z.boolean(),
  ordem: z.number(),
});

const itemAdminSchema = z.object({
  id: z.string().uuid(),
  categoriaId: z.string().uuid(),
  nome: z.string(),
  descricao: z.string().nullable(),
  preco: z.number(),
  imagemUrl: z.string().nullable(),
  ativo: z.boolean(),
  ordem: z.number(),
  adicionais: z.unknown().nullable(),
});

const erroValidacaoSchema = z.object({
  status: z.literal(400),
  error: z.literal("VALIDATION_ERROR"),
  message: z.string(),
  details: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional(),
});

const erroAutenticacaoSchema = z.object({
  status: z.literal(401),
  error: z.literal("UNAUTHORIZED"),
  message: z.string(),
});

const erroAutorizacaoSchema = z.object({
  status: z.literal(403),
  error: z.literal("FORBIDDEN"),
  message: z.string(),
});

const erroNaoEncontradoSchema = z.object({
  status: z.literal(404),
  error: z.literal("NOT_FOUND"),
  message: z.string(),
});

const erroConflitoSchema = z.object({
  status: z.literal(409),
  error: z.literal("CONFLICT"),
  message: z.string(),
});

const erroInternoSchema = z.object({
  status: z.literal(500),
  error: z.literal("INTERNAL_SERVER_ERROR"),
  message: z.string(),
});

const respostasProtegidas = {
  401: erroAutenticacaoSchema,
  403: erroAutorizacaoSchema,
  500: erroInternoSchema,
};

function mapearErroPrisma(
  erro: unknown,
  reply: FastifyReply,
  recurso: "categoria" | "item",
) {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (erro.code === "P2002") {
    reply.code(409).send({
      status: 409,
      error: "CONFLICT",
      message: `Já existe ${recurso} com esses dados.`,
    });
    return true;
  }

  if (erro.code === "P2025") {
    reply.code(404).send({
      status: 404,
      error: "NOT_FOUND",
      message: "Recurso não encontrado.",
    });
    return true;
  }

  return false;
}

function responderCategoriaInexistente(reply: FastifyReply) {
  return reply.code(400).send({
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Os dados da requisição são inválidos.",
    details: [
      {
        field: "/categoriaId",
        message: "A categoria informada não existe.",
      },
    ],
  });
}

function serializarItem(item: {
  id: string;
  categoriaId: string;
  nome: string;
  descricao: string | null;
  preco: Prisma.Decimal;
  imagemUrl: string | null;
  ativo: boolean;
  ordem: number;
  adicionais: Prisma.JsonValue | null;
}) {
  return { ...item, preco: item.preco.toNumber() };
}

export async function catalogoAdminRoutes(app: FastifyInstance) {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/admin/categorias",
    {
      preHandler: [app.autorizarAdmin],
      schema: {
        description: "Lista todas as categorias para administração, inclusive inativas.",
        tags: ["Administração", "Categorias"],
        security: [{ sessionCookie: [] }],
        response: {
          200: z.array(categoriaAdminSchema),
          ...respostasProtegidas,
        },
      },
    },
    async () =>
      app.prisma.categoria.findMany({
        orderBy: [{ ordem: "asc" }, { nome: "asc" }, { id: "asc" }],
        select: {
          id: true,
          nome: true,
          descricao: true,
          ativo: true,
          ordem: true,
        },
      }),
  );

  routes.get(
    "/admin/categorias/:id",
    {
      preHandler: [app.autorizarAdmin],
      schema: {
        description: "Consulta uma categoria para administração.",
        tags: ["Administração", "Categorias"],
        security: [{ sessionCookie: [] }],
        params: uuidParamsSchema,
        response: {
          200: categoriaAdminSchema,
          400: erroValidacaoSchema,
          404: erroNaoEncontradoSchema,
          ...respostasProtegidas,
        },
      },
    },
    async (request, reply) => {
      const categoria = await app.prisma.categoria.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          nome: true,
          descricao: true,
          ativo: true,
          ordem: true,
        },
      });

      if (!categoria) {
        return reply.code(404).send({
          status: 404,
          error: "NOT_FOUND",
          message: "Recurso não encontrado.",
        });
      }

      return categoria;
    },
  );

  routes.post(
    "/admin/categorias",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description: "Cria uma categoria ativa para o cardápio.",
        tags: ["Administração", "Categorias"],
        security: [{ sessionCookie: [] }],
        body: criarCategoriaBodySchema,
        response: {
          201: categoriaAdminSchema,
          400: erroValidacaoSchema,
          409: erroConflitoSchema,
          ...respostasProtegidas,
        },
      },
    },
    async (request, reply) => {
      try {
        const categoria = await app.prisma.categoria.create({
          data: {
            nome: request.body.nome,
            descricao: request.body.descricao ?? null,
            ordem: request.body.ordem ?? 0,
          },
          select: {
            id: true,
            nome: true,
            descricao: true,
            ativo: true,
            ordem: true,
          },
        });

        return reply.code(201).send(categoria);
      } catch (erro) {
        if (mapearErroPrisma(erro, reply, "categoria")) {
          return reply;
        }
        throw erro;
      }
    },
  );

  routes.patch(
    "/admin/categorias/:id",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description:
          "Atualiza campos permitidos de uma categoria; ativo controla sua ativação.",
        tags: ["Administração", "Categorias"],
        security: [{ sessionCookie: [] }],
        params: uuidParamsSchema,
        body: editarCategoriaBodySchema,
        response: {
          200: categoriaAdminSchema,
          400: erroValidacaoSchema,
          404: erroNaoEncontradoSchema,
          409: erroConflitoSchema,
          ...respostasProtegidas,
        },
      },
    },
    async (request, reply) => {
      try {
        const categoria = await app.prisma.categoria.update({
          where: { id: request.params.id },
          data: {
            ...(request.body.nome !== undefined ? { nome: request.body.nome } : {}),
            ...(request.body.descricao !== undefined
              ? { descricao: request.body.descricao }
              : {}),
            ...(request.body.ordem !== undefined ? { ordem: request.body.ordem } : {}),
            ...(request.body.ativo !== undefined ? { ativo: request.body.ativo } : {}),
          },
          select: {
            id: true,
            nome: true,
            descricao: true,
            ativo: true,
            ordem: true,
          },
        });
        return categoria;
      } catch (erro) {
        if (mapearErroPrisma(erro, reply, "categoria")) {
          return reply;
        }
        throw erro;
      }
    },
  );

  routes.get(
    "/admin/itens",
    {
      preHandler: [app.autorizarAdmin],
      schema: {
        description: "Lista todos os itens para administração, inclusive inativos.",
        tags: ["Administração", "Itens"],
        security: [{ sessionCookie: [] }],
        response: {
          200: z.array(itemAdminSchema),
          ...respostasProtegidas,
        },
      },
    },
    async () => {
      const itens = await app.prisma.item.findMany({
        orderBy: [{ ordem: "asc" }, { nome: "asc" }, { id: "asc" }],
        select: {
          id: true,
          categoriaId: true,
          nome: true,
          descricao: true,
          preco: true,
          imagemUrl: true,
          ativo: true,
          ordem: true,
          adicionais: true,
        },
      });
      return itens.map(serializarItem);
    },
  );

  routes.get(
    "/admin/itens/:id",
    {
      preHandler: [app.autorizarAdmin],
      schema: {
        description: "Consulta um item para administração.",
        tags: ["Administração", "Itens"],
        security: [{ sessionCookie: [] }],
        params: uuidParamsSchema,
        response: {
          200: itemAdminSchema,
          400: erroValidacaoSchema,
          404: erroNaoEncontradoSchema,
          ...respostasProtegidas,
        },
      },
    },
    async (request, reply) => {
      const item = await app.prisma.item.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          categoriaId: true,
          nome: true,
          descricao: true,
          preco: true,
          imagemUrl: true,
          ativo: true,
          ordem: true,
          adicionais: true,
        },
      });

      if (!item) {
        return reply.code(404).send({
          status: 404,
          error: "NOT_FOUND",
          message: "Recurso não encontrado.",
        });
      }

      return serializarItem(item);
    },
  );

  routes.post(
    "/admin/itens",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description: "Cria um item ativo do cardápio.",
        tags: ["Administração", "Itens"],
        security: [{ sessionCookie: [] }],
        body: criarItemBodySchema,
        response: {
          201: itemAdminSchema,
          400: erroValidacaoSchema,
          409: erroConflitoSchema,
          ...respostasProtegidas,
        },
      },
    },
    async (request, reply) => {
      const categoria = await app.prisma.categoria.findUnique({
        where: { id: request.body.categoriaId },
        select: { id: true },
      });
      if (!categoria) {
        return responderCategoriaInexistente(reply);
      }

      try {
        const item = await app.prisma.item.create({
          data: {
            categoriaId: request.body.categoriaId,
            nome: request.body.nome,
            descricao: request.body.descricao ?? null,
            preco: new Prisma.Decimal(request.body.preco.toFixed(2)),
            imagemUrl: request.body.imagemUrl ?? null,
            ordem: request.body.ordem ?? 0,
            ...(request.body.adicionais !== undefined
              ? {
                  adicionais:
                    request.body.adicionais === null
                      ? Prisma.JsonNull
                      : request.body.adicionais,
                }
              : {}),
          },
          select: {
            id: true,
            categoriaId: true,
            nome: true,
            descricao: true,
            preco: true,
            imagemUrl: true,
            ativo: true,
            ordem: true,
            adicionais: true,
          },
        });

        return reply.code(201).send(serializarItem(item));
      } catch (erro) {
        if (mapearErroPrisma(erro, reply, "item")) {
          return reply;
        }
        if (
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === "P2003"
        ) {
          return responderCategoriaInexistente(reply);
        }
        throw erro;
      }
    },
  );

  routes.patch(
    "/admin/itens/:id",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description:
          "Atualiza campos permitidos de um item; ativo controla sua ativação.",
        tags: ["Administração", "Itens"],
        security: [{ sessionCookie: [] }],
        params: uuidParamsSchema,
        body: editarItemBodySchema,
        response: {
          200: itemAdminSchema,
          400: erroValidacaoSchema,
          404: erroNaoEncontradoSchema,
          409: erroConflitoSchema,
          ...respostasProtegidas,
        },
      },
    },
    async (request, reply) => {
      if (request.body.categoriaId !== undefined) {
        const categoria = await app.prisma.categoria.findUnique({
          where: { id: request.body.categoriaId },
          select: { id: true },
        });
        if (!categoria) {
          return responderCategoriaInexistente(reply);
        }
      }

      const data: Prisma.ItemUncheckedUpdateInput = {};
      if (request.body.categoriaId !== undefined) {
        data.categoriaId = request.body.categoriaId;
      }
      if (request.body.nome !== undefined) {
        data.nome = request.body.nome;
      }
      if (request.body.descricao !== undefined) {
        data.descricao = request.body.descricao;
      }
      if (request.body.preco !== undefined) {
        data.preco = new Prisma.Decimal(request.body.preco.toFixed(2));
      }
      if (request.body.imagemUrl !== undefined) {
        data.imagemUrl = request.body.imagemUrl;
      }
      if (request.body.ordem !== undefined) {
        data.ordem = request.body.ordem;
      }
      if (request.body.ativo !== undefined) {
        data.ativo = request.body.ativo;
      }
      if (request.body.adicionais !== undefined) {
        data.adicionais =
          request.body.adicionais === null
            ? Prisma.JsonNull
            : request.body.adicionais;
      }

      try {
        const item = await app.prisma.item.update({
          where: { id: request.params.id },
          data,
          select: {
            id: true,
            categoriaId: true,
            nome: true,
            descricao: true,
            preco: true,
            imagemUrl: true,
            ativo: true,
            ordem: true,
            adicionais: true,
          },
        });
        return serializarItem(item);
      } catch (erro) {
        if (mapearErroPrisma(erro, reply, "item")) {
          return reply;
        }
        if (
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === "P2003"
        ) {
          return responderCategoriaInexistente(reply);
        }
        throw erro;
      }
    },
  );
}
