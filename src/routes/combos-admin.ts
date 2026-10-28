import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";

const uuidParamsSchema = z.object({
  id: z.string().uuid("id deve ser um UUID válido."),
});

const ordemSchema = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const nomeSchema = z.string().trim().min(1).max(100);
const descricaoSchema = z.string().trim().max(500).nullable();
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

const itensComposicaoSchema = z
  .array(
    z
      .object({
        itemId: z.string().uuid(),
        quantidade: z.number().int().min(1).max(2_147_483_647),
      })
      .strict(),
  )
  .min(1)
  .superRefine((itens, contexto) => {
    const ids = new Set<string>();
    itens.forEach((item, index) => {
      if (ids.has(item.itemId)) {
        contexto.addIssue({
          code: "custom",
          path: [index, "itemId"],
          message: "O mesmo item não pode aparecer mais de uma vez.",
        });
      }
      ids.add(item.itemId);
    });
  });

const itensComposicaoEdicaoSchema = itensComposicaoSchema;

const idsRemocaoSchema = z
  .array(z.string().uuid())
  .min(1)
  .superRefine((ids, contexto) => {
    if (new Set(ids).size !== ids.length) {
      contexto.addIssue({
        code: "custom",
        message: "O mesmo item não pode ser removido mais de uma vez.",
      });
    }
  });

const criarComboBodySchema = z
  .object({
    nome: nomeSchema,
    descricao: descricaoSchema.optional(),
    preco: precoSchema,
    imagemUrl: imagemUrlSchema.optional(),
    ordem: ordemSchema.optional(),
    itens: itensComposicaoSchema,
  })
  .strict();

const editarComboBodySchema = z
  .object({
    nome: nomeSchema.optional(),
    descricao: descricaoSchema.optional(),
    preco: precoSchema.optional(),
    imagemUrl: imagemUrlSchema.optional(),
    ordem: ordemSchema.optional(),
    ativo: z.boolean().optional(),
    itens: itensComposicaoEdicaoSchema.optional(),
    removerItemIds: idsRemocaoSchema.optional(),
  })
  .strict()
  .superRefine((body, contexto) => {
    const removidos = new Set(body.removerItemIds ?? []);
    for (const [index, item] of (body.itens ?? []).entries()) {
      if (removidos.has(item.itemId)) {
        contexto.addIssue({
          code: "custom",
          path: ["itens", index, "itemId"],
          message: "Um item não pode ser adicionado e removido na mesma requisição.",
        });
      }
    }
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

type CamposCombo = Pick<
  z.infer<typeof editarComboBodySchema>,
  "nome" | "descricao" | "preco" | "imagemUrl" | "ordem" | "ativo"
>;

const itemComposicaoAdminSchema = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  quantidade: z.number(),
  ativo: z.boolean(),
});

const itemComposicaoRemovidoAdminSchema = itemComposicaoAdminSchema.extend({
  removidoEm: z.string().datetime(),
});

const comboAdminSchema = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  descricao: z.string().nullable(),
  preco: z.number(),
  imagemUrl: z.string().nullable(),
  ativo: z.boolean(),
  ordem: z.number(),
  possuiItensInativos: z.boolean(),
  itens: z.array(itemComposicaoAdminSchema),
  itensRemovidos: z.array(itemComposicaoRemovidoAdminSchema),
});

const queryAdminSchema = z
  .object({
    incluirRemovidos: z
      .enum(["true", "false"])
      .default("false")
      .transform((valor) => valor === "true"),
  })
  .strict();

const erroValidacaoSchema = z.object({
  status: z.literal(400),
  error: z.literal("VALIDATION_ERROR"),
  message: z.string(),
  details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
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

const comboAdminSelect = {
  id: true,
  nome: true,
  descricao: true,
  preco: true,
  imagemUrl: true,
  ativo: true,
  ordem: true,
  itensCombo: {
    orderBy: [{ item: { nome: "asc" } }, { itemId: "asc" }],
    select: {
      quantidade: true,
      removidoEm: true,
      item: {
        select: {
          id: true,
          nome: true,
          ativo: true,
        },
      },
    },
  },
} satisfies Prisma.ComboSelect;

type ComboAdmin = Prisma.ComboGetPayload<{ select: typeof comboAdminSelect }>;

function serializarCombo(combo: ComboAdmin) {
  const itensAtivos = combo.itensCombo
    .filter(({ removidoEm }) => removidoEm === null)
    .map(({ item, quantidade }) => ({
      id: item.id,
      nome: item.nome,
      quantidade,
      ativo: item.ativo,
    }));
  const itensRemovidos = combo.itensCombo
    .filter((associacao): associacao is typeof associacao & { removidoEm: Date } => associacao.removidoEm !== null)
    .map(({ item, quantidade, removidoEm }) => ({
      id: item.id,
      nome: item.nome,
      quantidade,
      ativo: item.ativo,
      removidoEm: removidoEm.toISOString(),
    }));

  return {
    id: combo.id,
    nome: combo.nome,
    descricao: combo.descricao,
    preco: combo.preco.toNumber(),
    imagemUrl: combo.imagemUrl,
    ativo: combo.ativo,
    ordem: combo.ordem,
    possuiItensInativos: itensAtivos.some((item) => !item.ativo),
    itens: itensAtivos,
    itensRemovidos,
  };
}

function responderItensInexistentes(reply: FastifyReply, field = "/itens") {
  return reply.code(400).send({
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Os dados da requisição são inválidos.",
    details: [
      {
        field,
        message: "Um ou mais itens informados não existem.",
      },
    ],
  });
}

function mapearErroPrisma(erro: unknown, reply: FastifyReply) {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (erro.code === "P2002") {
    reply.code(409).send({
      status: 409,
      error: "CONFLICT",
      message: "Já existe combo com esses dados.",
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

  if (erro.code === "P2003") {
    responderItensInexistentes(reply);
    return true;
  }

  return false;
}

function dataDoCombo(body: CamposCombo): Prisma.ComboUpdateInput {
  return {
    ...(body.nome !== undefined ? { nome: body.nome } : {}),
    ...(body.descricao !== undefined ? { descricao: body.descricao } : {}),
    ...(body.preco !== undefined ? { preco: new Prisma.Decimal(body.preco.toFixed(2)) } : {}),
    ...(body.imagemUrl !== undefined ? { imagemUrl: body.imagemUrl } : {}),
    ...(body.ordem !== undefined ? { ordem: body.ordem } : {}),
    ...(body.ativo !== undefined ? { ativo: body.ativo } : {}),
  };
}

function selecionarComposicaoAdmin(incluirRemovidos: boolean) {
  return {
    ...comboAdminSelect,
    itensCombo: {
      ...comboAdminSelect.itensCombo,
      where: incluirRemovidos ? {} : { removidoEm: null },
    },
  } satisfies Prisma.ComboSelect;
}

export async function combosAdminRoutes(app: FastifyInstance) {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/admin/combos",
    {
      preHandler: [app.autorizarAdmin],
      schema: {
        description: "Lista combos para administração, inclusive inativos e componentes inativos.",
        tags: ["Administração", "Combos"],
        security: [{ sessionCookie: [] }],
        querystring: queryAdminSchema,
        response: {
          200: z.array(comboAdminSchema),
          ...respostasProtegidas,
        },
      },
    },
    async (request) => {
      const combos = await app.prisma.combo.findMany({
        orderBy: [{ ordem: "asc" }, { nome: "asc" }, { id: "asc" }],
        select: selecionarComposicaoAdmin(request.query.incluirRemovidos),
      });
      return combos.map(serializarCombo);
    },
  );

  routes.get(
    "/admin/combos/:id",
    {
      preHandler: [app.autorizarAdmin],
      schema: {
        description: "Consulta combo para administração, inclusive inativo, com composição e situação dos itens.",
        tags: ["Administração", "Combos"],
        security: [{ sessionCookie: [] }],
        params: uuidParamsSchema,
        querystring: queryAdminSchema,
        response: {
          200: comboAdminSchema,
          400: erroValidacaoSchema,
          404: erroNaoEncontradoSchema,
          ...respostasProtegidas,
        },
      },
    },
    async (request, reply) => {
      const combo = await app.prisma.combo.findUnique({
        where: { id: request.params.id },
        select: selecionarComposicaoAdmin(request.query.incluirRemovidos),
      });

      if (!combo) {
        return reply.code(404).send({
          status: 404,
          error: "NOT_FOUND",
          message: "Recurso não encontrado.",
        });
      }

      return serializarCombo(combo);
    },
  );

  routes.post(
    "/admin/combos",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description: "Cria combo com preço manual e composição inicial; inicia ativo.",
        tags: ["Administração", "Combos"],
        security: [{ sessionCookie: [] }],
        body: criarComboBodySchema,
        response: {
          201: comboAdminSchema,
          400: erroValidacaoSchema,
          409: erroConflitoSchema,
          ...respostasProtegidas,
        },
      },
    },
    async (request, reply) => {
      try {
        const resultado = await app.prisma.$transaction(async (tx) => {
          const idsInformados = request.body.itens.map((item) => item.itemId);
          const itensExistentes = await tx.item.findMany({
            where: { id: { in: idsInformados } },
            select: { id: true },
          });
          if (itensExistentes.length !== idsInformados.length) {
            return null;
          }

          return tx.combo.create({
            data: {
              nome: request.body.nome,
              descricao: request.body.descricao ?? null,
              preco: new Prisma.Decimal(request.body.preco.toFixed(2)),
              imagemUrl: request.body.imagemUrl ?? null,
              ordem: request.body.ordem ?? 0,
              itensCombo: {
                create: request.body.itens.map(({ itemId, quantidade }) => ({
                  quantidade,
                  item: { connect: { id: itemId } },
                })),
              },
            },
            select: comboAdminSelect,
          });
        });

        if (!resultado) {
          return responderItensInexistentes(reply);
        }

        return reply.code(201).send(serializarCombo(resultado));
      } catch (erro) {
        if (mapearErroPrisma(erro, reply)) {
          return reply;
        }
        throw erro;
      }
    },
  );

  routes.patch(
    "/admin/combos/:id",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description:
          "Atualiza dados, estado e composição do combo. removerItemIds remove associações logicamente; itens as adiciona/atualiza e pode reativar associações.",
        tags: ["Administração", "Combos"],
        security: [{ sessionCookie: [] }],
        params: uuidParamsSchema,
        body: editarComboBodySchema,
        response: {
          200: comboAdminSchema,
          400: erroValidacaoSchema,
          404: erroNaoEncontradoSchema,
          409: erroConflitoSchema,
          ...respostasProtegidas,
        },
      },
    },
    async (request, reply) => {
      try {
        const resultado = await app.prisma.$transaction(async (tx) => {
          const comboExiste = await tx.combo.findUnique({
            where: { id: request.params.id },
            select: { id: true },
          });
          if (!comboExiste) {
            return { tipo: "combo_inexistente" as const };
          }

          const idsItens = request.body.itens?.map((item) => item.itemId) ?? [];
          const idsRemocao = request.body.removerItemIds ?? [];
          const idsVerificar = [...new Set([...idsItens, ...idsRemocao])];
          if (idsVerificar.length > 0) {
            const itensExistentes = await tx.item.findMany({
              where: { id: { in: idsVerificar } },
              select: { id: true },
            });
            const idsExistentes = new Set(itensExistentes.map(({ id }) => id));
            if (idsItens.some((id) => !idsExistentes.has(id))) {
              return {
                tipo: "itens_inexistentes" as const,
                field: "/itens",
              };
            }
            if (idsRemocao.some((id) => !idsExistentes.has(id))) {
              return {
                tipo: "itens_inexistentes" as const,
                field: "/removerItemIds",
              };
            }
          }

          if (idsRemocao.length > 0) {
            const associacoesAtivas = await tx.itemCombo.findMany({
              where: {
                comboId: request.params.id,
                itemId: { in: idsRemocao },
                removidoEm: null,
              },
              select: { itemId: true },
            });
            if (associacoesAtivas.length !== idsRemocao.length) {
              return { tipo: "associacoes_inexistentes" as const };
            }
          }

          const data = dataDoCombo(request.body);
          if (request.body.itens !== undefined) {
            for (const { itemId, quantidade } of request.body.itens) {
              await tx.itemCombo.upsert({
                where: {
                  comboId_itemId: {
                    comboId: request.params.id,
                    itemId,
                  },
                },
                create: {
                  comboId: request.params.id,
                  itemId,
                  quantidade,
                },
                update: { quantidade, removidoEm: null },
              });
            }
          }

          if (idsRemocao.length > 0) {
            await tx.itemCombo.updateMany({
              where: {
                comboId: request.params.id,
                itemId: { in: idsRemocao },
                removidoEm: null,
              },
              data: { removidoEm: new Date() },
            });
          }

          if (Object.keys(data).length > 0) {
            await tx.combo.update({
              where: { id: request.params.id },
              data,
            });
          }

          const combo = await tx.combo.findUniqueOrThrow({
            where: { id: request.params.id },
            select: comboAdminSelect,
          });
          return { tipo: "sucesso" as const, combo };
        });

        if (resultado.tipo === "combo_inexistente") {
          return reply.code(404).send({
            status: 404,
            error: "NOT_FOUND",
            message: "Recurso não encontrado.",
          });
        }
        if (resultado.tipo === "itens_inexistentes") {
          return responderItensInexistentes(reply, resultado.field);
        }
        if (resultado.tipo === "associacoes_inexistentes") {
          return reply.code(400).send({
            status: 400,
            error: "VALIDATION_ERROR",
            message: "Os dados da requisição são inválidos.",
            details: [
              {
                field: "/removerItemIds",
                message: "Um ou mais itens não fazem parte da composição ativa.",
              },
            ],
          });
        }

        return serializarCombo(resultado.combo);
      } catch (erro) {
        if (mapearErroPrisma(erro, reply)) {
          return reply;
        }
        throw erro;
      }
    },
  );
}
