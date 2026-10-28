import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";

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

const criarEnderecoBodySchema = enderecoSchema
  .omit({ complemento: true, referencia: true })
  .extend({
    complemento: enderecoSchema.shape.complemento.optional(),
    referencia: enderecoSchema.shape.referencia.optional(),
  })
  .strict();

const atualizarEnderecoBodySchema = enderecoSchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

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
} as const;

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

      return endereco;
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
        const endereco = await app.prisma.endereco.create({
          data: {
            ...request.body,
            complemento: request.body.complemento ?? null,
            referencia: request.body.referencia ?? null,
            usuarioId: usuario.id,
          },
          select: enderecoSelect,
        });
        return reply.code(201).send(endereco);
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
        return await app.prisma.endereco.update({
          where: { usuarioId: usuario.id },
          data: {
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
            ...(request.body.bairro !== undefined ? { bairro: request.body.bairro } : {}),
            ...(request.body.cidade !== undefined ? { cidade: request.body.cidade } : {}),
            ...(request.body.estado !== undefined ? { estado: request.body.estado } : {}),
            ...(request.body.referencia !== undefined
              ? { referencia: request.body.referencia }
              : {}),
          },
          select: enderecoSelect,
        });
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
