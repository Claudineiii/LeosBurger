import { Prisma, StatusReferenciaEndereco } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import { validarEnderecoComGeoapify } from "../services/validacao-endereco-geoapify.js";

const enderecoSchema = z.object({
  cep: z
    .string()
    .trim()
    .regex(/^\d{5}-?\d{3}$/)
    .transform((cep) => cep.replace("-", "")),
  logradouro: z.string().trim().min(1).max(150),
  numero: z.string().trim().min(1).max(20),
  complemento: z.string().trim().max(100).nullable(),
  bairro: z.string().trim().min(1).max(100),
  cidade: z.string().trim().min(1).max(100),
  estado: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  referencia: z.string().trim().max(150).nullable(),
});

const latitudeSchema = z.number().finite().min(-90).max(90).nullable();
const longitudeSchema = z.number().finite().min(-180).max(180).nullable();

function validarParCoordenadas(
  body: {
    latitude?: number | null | undefined;
    longitude?: number | null | undefined;
  },
  contexto: z.RefinementCtx,
) {
  if ((body.latitude === undefined) !== (body.longitude === undefined)) {
    contexto.addIssue({
      code: "custom",
      path: [body.latitude === undefined ? "latitude" : "longitude"],
      message: "Latitude e longitude devem ser informadas juntas.",
    });
  }
}

const criarEnderecoBodySchema = enderecoSchema
  .omit({ complemento: true, referencia: true })
  .extend({
    complemento: enderecoSchema.shape.complemento.optional(),
    referencia: enderecoSchema.shape.referencia.optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
  })
  .strict()
  .superRefine(validarParCoordenadas);

const atualizarEnderecoBodySchema = enderecoSchema
  .partial()
  .extend({
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  })
  .superRefine(validarParCoordenadas);

const enderecoResponseSchema = z.object({
  id: z.string().uuid(),
  cep: z.string(),
  logradouro: z.string(),
  numero: z.string(),
  complemento: z.string().nullable(),
  bairro: z.string(),
  cidade: z.string(),
  estado: z.string(),
  referencia: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  statusGeocodificacao: z.enum(["CONFIRMADO", "PENDENTE"]),
});

const erroResponseSchema = z.object({
  status: z.number(),
  error: z.string(),
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

const enderecoSelect = {
  id: true,
  cep: true,
  logradouro: true,
  numero: true,
  complemento: true,
  bairro: true,
  cidade: true,
  estado: true,
  referencia: true,
  latitude: true,
  longitude: true,
  atualizadoEm: true,
} as const;

type EnderecoSelecionado = Prisma.EnderecoGetPayload<{
  select: typeof enderecoSelect;
}>;

function serializarEndereco(endereco: EnderecoSelecionado) {
  const latitude = endereco.latitude?.toNumber() ?? null;
  const longitude = endereco.longitude?.toNumber() ?? null;
  const { atualizadoEm: _atualizadoEm, ...dadosPublicos } = endereco;

  return {
    ...dadosPublicos,
    latitude,
    longitude,
    statusGeocodificacao:
      latitude !== null && longitude !== null
        ? StatusReferenciaEndereco.CONFIRMADO
        : StatusReferenciaEndereco.PENDENTE,
  };
}

export async function enderecosRoutes(app: FastifyInstance) {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/auth/me/endereco",
    {
      onRequest: [app.autenticar],
      schema: {
        description: "Consulta o endereço do usuário autenticado.",
        tags: ["Perfil", "Endereços"],
        security: [{ sessionCookie: [] }],
        response: {
          200: enderecoResponseSchema,
          401: erroResponseSchema,
          404: erroResponseSchema,
          500: erroResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const usuario = request.usuarioAutenticado;
      if (!usuario) {
        return reply.code(401).send({
          status: 401,
          error: "UNAUTHORIZED",
          message: "Autenticação necessária.",
        });
      }

      const endereco = await app.prisma.endereco.findUnique({
        where: { usuarioId: usuario.id },
        select: enderecoSelect,
      });

      if (!endereco) {
        return reply.code(404).send({
          status: 404,
          error: "NOT_FOUND",
          message: "Endereço não encontrado.",
        });
      }

      return serializarEndereco(endereco);
    },
  );

  routes.post(
    "/auth/me/endereco",
    {
      onRequest: [app.autenticar],
      preHandler: [app.verificarOrigem],
      schema: {
        description: "Cadastra o endereço do usuário autenticado.",
        tags: ["Perfil", "Endereços"],
        security: [{ sessionCookie: [] }],
        body: criarEnderecoBodySchema,
        response: {
          201: enderecoResponseSchema,
          400: erroResponseSchema,
          401: erroResponseSchema,
          403: erroResponseSchema,
          409: erroResponseSchema,
          500: erroResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const usuario = request.usuarioAutenticado;
      if (!usuario) {
        return reply.code(401).send({
          status: 401,
          error: "UNAUTHORIZED",
          message: "Autenticação necessária.",
        });
      }

      try {
        const coordenadasManuais =
          request.body.latitude !== undefined &&
          request.body.longitude !== undefined
            ? {
                latitude: request.body.latitude,
                longitude: request.body.longitude,
              }
            : null;
        const validacao = coordenadasManuais
          ? null
          : await validarEnderecoComGeoapify(app.prisma, {
              cep: request.body.cep,
              logradouro: request.body.logradouro,
              numero: request.body.numero,
              bairro: request.body.bairro,
              cidade: request.body.cidade,
              estado: request.body.estado,
            });
        const endereco = await app.prisma.endereco.create({
          data: {
            ...request.body,
            complemento: request.body.complemento ?? null,
            referencia: request.body.referencia ?? null,
            latitude:
              coordenadasManuais
                ? coordenadasManuais.latitude === null
                  ? null
                  : new Prisma.Decimal(coordenadasManuais.latitude.toFixed(6))
                : validacao?.latitude === null
                  ? null
                  : new Prisma.Decimal(validacao!.latitude.toFixed(6)),
            longitude:
              coordenadasManuais
                ? coordenadasManuais.longitude === null
                  ? null
                  : new Prisma.Decimal(coordenadasManuais.longitude.toFixed(6))
                : validacao?.longitude === null
                  ? null
                  : new Prisma.Decimal(validacao!.longitude.toFixed(6)),
            usuarioId: usuario.id,
          },
          select: enderecoSelect,
        });
        return reply.code(201).send(serializarEndereco(endereco));
      } catch (erro) {
        if (
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === "P2002"
        ) {
          return reply.code(409).send({
            status: 409,
            error: "CONFLICT",
            message: "Já existe um endereço cadastrado para este usuário.",
          });
        }

        throw erro;
      }
    },
  );

  routes.patch(
    "/auth/me/endereco",
    {
      onRequest: [app.autenticar],
      preHandler: [app.verificarOrigem],
      schema: {
        description: "Atualiza o endereço do usuário autenticado.",
        tags: ["Perfil", "Endereços"],
        security: [{ sessionCookie: [] }],
        body: atualizarEnderecoBodySchema,
        response: {
          200: enderecoResponseSchema,
          400: erroResponseSchema,
          401: erroResponseSchema,
          403: erroResponseSchema,
          404: erroResponseSchema,
          409: erroResponseSchema,
          500: erroResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const usuario = request.usuarioAutenticado;
      if (!usuario) {
        return reply.code(401).send({
          status: 401,
          error: "UNAUTHORIZED",
          message: "Autenticação necessária.",
        });
      }

      try {
        const atual = await app.prisma.endereco.findUnique({
          where: { usuarioId: usuario.id },
          select: enderecoSelect,
        });
        if (!atual) {
          return reply.code(404).send({
            status: 404,
            error: "NOT_FOUND",
            message: "Endereço não encontrado.",
          });
        }

        const novaLocalizacao = {
          cep: request.body.cep ?? atual.cep,
          logradouro: request.body.logradouro ?? atual.logradouro,
          numero: request.body.numero ?? atual.numero,
          bairro: request.body.bairro ?? atual.bairro,
          cidade: request.body.cidade ?? atual.cidade,
          estado: request.body.estado ?? atual.estado,
        };
        const localizacaoAlterada =
          novaLocalizacao.cep !== atual.cep ||
          novaLocalizacao.logradouro !== atual.logradouro ||
          novaLocalizacao.numero !== atual.numero ||
          novaLocalizacao.bairro !== atual.bairro ||
          novaLocalizacao.cidade !== atual.cidade ||
          novaLocalizacao.estado !== atual.estado;

        const coordenadasManuais =
          request.body.latitude !== undefined &&
          request.body.longitude !== undefined
            ? {
                latitude: request.body.latitude,
                longitude: request.body.longitude,
              }
            : null;
        const validacao =
          localizacaoAlterada && !coordenadasManuais
          ? await validarEnderecoComGeoapify(app.prisma, novaLocalizacao)
          : null;

        const data = {
          ...(request.body.cep !== undefined ? { cep: request.body.cep } : {}),
          ...(request.body.logradouro !== undefined
            ? { logradouro: request.body.logradouro }
            : {}),
          ...(request.body.numero !== undefined
            ? { numero: request.body.numero }
            : {}),
          ...(request.body.complemento !== undefined
            ? { complemento: request.body.complemento }
            : {}),
          ...(request.body.bairro !== undefined
            ? { bairro: request.body.bairro }
            : {}),
          ...(request.body.cidade !== undefined
            ? { cidade: request.body.cidade }
            : {}),
          ...(request.body.estado !== undefined
            ? { estado: request.body.estado }
            : {}),
          ...(request.body.referencia !== undefined
            ? { referencia: request.body.referencia }
            : {}),
          ...(coordenadasManuais
            ? {
                latitude:
                  coordenadasManuais.latitude === null
                    ? null
                    : new Prisma.Decimal(coordenadasManuais.latitude.toFixed(6)),
                longitude:
                  coordenadasManuais.longitude === null
                    ? null
                    : new Prisma.Decimal(coordenadasManuais.longitude.toFixed(6)),
              }
            : {}),
          ...(validacao
            ? {
                latitude:
                  validacao.latitude === null
                    ? null
                    : new Prisma.Decimal(validacao.latitude.toFixed(6)),
                longitude:
                  validacao.longitude === null
                    ? null
                    : new Prisma.Decimal(validacao.longitude.toFixed(6)),
              }
            : {}),
        };

        if (localizacaoAlterada) {
          const atualizacao = await app.prisma.endereco.updateMany({
            where: {
              usuarioId: usuario.id,
              atualizadoEm: atual.atualizadoEm,
            },
            data,
          });

          if (atualizacao.count === 0) {
            const aindaExiste = await app.prisma.endereco.findUnique({
              where: { usuarioId: usuario.id },
              select: { id: true },
            });
            if (!aindaExiste) {
              return reply.code(404).send({
                status: 404,
                error: "NOT_FOUND",
                message: "Endereço não encontrado.",
              });
            }

            return reply.code(409).send({
              status: 409,
              error: "CONFLICT",
              message:
                "O endereço foi alterado durante a validação. Consulte-o novamente antes de atualizar.",
            });
          }

          const atualizado = await app.prisma.endereco.findUniqueOrThrow({
            where: { usuarioId: usuario.id },
            select: enderecoSelect,
          });
          return serializarEndereco(atualizado);
        }

        const endereco = await app.prisma.endereco.update({
          where: { usuarioId: usuario.id },
          data,
          select: enderecoSelect,
        });
        return serializarEndereco(endereco);
      } catch (erro) {
        if (
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === "P2025"
        ) {
          return reply.code(404).send({
            status: 404,
            error: "NOT_FOUND",
            message: "Endereço não encontrado.",
          });
        }

        throw erro;
      }
    },
  );

  routes.delete(
    "/auth/me/endereco",
    {
      onRequest: [app.autenticar],
      preHandler: [app.verificarOrigem],
      schema: {
        description: "Exclui o endereço do usuário autenticado.",
        tags: ["Perfil", "Endereços"],
        security: [{ sessionCookie: [] }],
        response: {
          204: z.null(),
          401: erroResponseSchema,
          403: erroResponseSchema,
          404: erroResponseSchema,
          500: erroResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const usuario = request.usuarioAutenticado;
      if (!usuario) {
        return reply.code(401).send({
          status: 401,
          error: "UNAUTHORIZED",
          message: "Autenticação necessária.",
        });
      }

      try {
        await app.prisma.endereco.delete({
          where: { usuarioId: usuario.id },
        });
        return reply.code(204).send(null);
      } catch (erro) {
        if (
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === "P2025"
        ) {
          return reply.code(404).send({
            status: 404,
            error: "NOT_FOUND",
            message: "Endereço não encontrado.",
          });
        }

        throw erro;
      }
    },
  );
}
