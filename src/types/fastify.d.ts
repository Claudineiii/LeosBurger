import "fastify";
import type { PrismaClient } from "@prisma/client";
import type { preHandlerAsyncHookHandler } from "fastify";
import type { UsuarioAutenticado } from "../plugins/autenticacao.js";
import type { ProvedorPagamentos } from "../services/pagamentos/contrato.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    autenticar: preHandlerAsyncHookHandler;
    autenticarOpcional: preHandlerAsyncHookHandler;
    verificarOrigem: preHandlerAsyncHookHandler;
    autorizarAdmin: preHandlerAsyncHookHandler;
    provedorPagamentos: ProvedorPagamentos | null;
    simuladorPagamentos: import("../services/pagamentos/simulador.js").SimuladorPagamentos | null;
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
