import "fastify";
import type { PrismaClient } from "@prisma/client";
import type { preHandlerAsyncHookHandler } from "fastify";
import type { UsuarioAutenticado } from "../plugins/autenticacao.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    autenticar: preHandlerAsyncHookHandler;
    verificarOrigem: preHandlerAsyncHookHandler;
    autorizarAdmin: preHandlerAsyncHookHandler;
  }

  interface FastifyRequest {
    usuarioAutenticado: UsuarioAutenticado | null;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      iat?: number;
      exp?: number;
    };
    user: {
      sub: string;
      iat?: number;
      exp?: number;
    };
  }
}
