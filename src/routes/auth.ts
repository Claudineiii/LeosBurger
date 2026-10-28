import { Prisma, TipoUsuario } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  definirCookieSessao,
  limparCookieSessao,
  obterDuracaoTokenSegundos,
} from "../plugins/autenticacao.js";

const usuarioResponseSchema = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  email: z.string().email(),
  telefone: z.string(),
  tipo: z.enum(["CLIENTE", "ADMIN"]),
});

const cadastroBodySchema = z
  .object({
    nome: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(255),
    telefone: z.string().trim().min(8).max(20),
    senha: z
      .string()
      .min(8)
      .max(72)
      .refine((senha) => Buffer.byteLength(senha, "utf8") <= 72, {
        message: "A senha deve ter no máximo 72 bytes.",
      }),
  })
  .strict();

const loginBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    senha: z
      .string()
      .min(1)
      .max(72)
      .refine((senha) => Buffer.byteLength(senha, "utf8") <= 72, {
        message: "A senha deve ter no máximo 72 bytes.",
      }),
  })
  .strict();

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

const erroAutenticacaoResponseSchema = z.object({
  status: z.literal(401),
  error: z.literal("UNAUTHORIZED"),
  message: z.string(),
});

const erroAutorizacaoResponseSchema = z.object({
  status: z.literal(403),
  error: z.literal("FORBIDDEN"),
  message: z.string(),
});

const erroConflitoResponseSchema = z.object({
  status: z.literal(409),
  error: z.literal("CONFLICT"),
  message: z.string(),
});

const erroInternoResponseSchema = z.object({
  status: z.literal(500),
  error: z.literal("INTERNAL_SERVER_ERROR"),
  message: z.string(),
});

const hashSenhaInexistente = bcrypt.hash(randomUUID(), 12);

export async function authRoutes(app: FastifyInstance) {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    "/auth/cadastro",
    {
      schema: {
        description: "Cadastra um cliente. O papel é sempre CLIENTE.",
        tags: ["Autenticação"],
        body: cadastroBodySchema,
        response: {
          201: usuarioResponseSchema,
          400: erroValidacaoResponseSchema,
          403: erroAutorizacaoResponseSchema,
          409: erroConflitoResponseSchema,
          500: erroInternoResponseSchema,
        },
      },
      preHandler: [app.verificarOrigem],
    },
    async (request, reply) => {
      try {
        const usuario = await app.prisma.usuario.create({
          data: {
            nome: request.body.nome,
            email: request.body.email,
            telefone: request.body.telefone,
            senhaHash: await bcrypt.hash(request.body.senha, 12),
            tipo: TipoUsuario.CLIENTE,
          },
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
            tipo: true,
          },
        });

        return reply.code(201).send(usuario);
      } catch (erro) {
        if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
          return reply.code(409).send({
            status: 409,
            error: "CONFLICT",
            message: "Não foi possível cadastrar com esses dados.",
          });
        }

        throw erro;
      }
    },
  );

  routes.post(
    "/auth/login",
    {
      schema: {
        description: "Autentica um usuário e define o cookie JWT HttpOnly.",
        tags: ["Autenticação"],
        body: loginBodySchema,
        response: {
          200: usuarioResponseSchema,
          400: erroValidacaoResponseSchema,
          401: erroAutenticacaoResponseSchema,
          403: erroAutorizacaoResponseSchema,
          500: erroInternoResponseSchema,
        },
      },
      preHandler: [app.verificarOrigem],
    },
    async (request, reply) => {
      const usuario = await app.prisma.usuario.findUnique({
        where: { email: request.body.email },
        select: {
          id: true,
          nome: true,
          email: true,
          telefone: true,
          senhaHash: true,
          tipo: true,
          ativo: true,
        },
      });
      const hashParaComparacao = usuario?.senhaHash ?? (await hashSenhaInexistente);
      const senhaValida = await bcrypt.compare(request.body.senha, hashParaComparacao);

      if (!usuario || !usuario.ativo || !senhaValida) {
        return reply.code(401).send({
          status: 401,
          error: "UNAUTHORIZED",
          message: "E-mail ou senha inválidos.",
        });
      }

      const token = app.jwt.sign(
        { sub: usuario.id },
        { expiresIn: obterDuracaoTokenSegundos(usuario.tipo) },
      );
      definirCookieSessao(reply, token, usuario.tipo);

      return {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        telefone: usuario.telefone,
        tipo: usuario.tipo,
      };
    },
  );

  routes.post(
    "/auth/logout",
    {
      schema: {
        description:
          "Remove o cookie de autenticação do navegador. JWTs copiados continuam válidos até expirarem.",
        tags: ["Autenticação"],
        response: {
          204: z.null().describe("Cookie de autenticação removido do navegador."),
          403: erroAutorizacaoResponseSchema,
        },
      },
      preHandler: [app.verificarOrigem],
    },
    async (_request, reply) => {
      limparCookieSessao(reply);
      return reply.code(204).send(null);
    },
  );

  routes.get(
    "/auth/me",
    {
      onRequest: [app.autenticar],
      schema: {
        description: "Retorna os dados públicos do usuário autenticado.",
        tags: ["Autenticação"],
        security: [{ sessionCookie: [] }],
        response: {
          200: usuarioResponseSchema,
          401: erroAutenticacaoResponseSchema,
          500: erroInternoResponseSchema,
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

      return usuario;
    },
  );

}
