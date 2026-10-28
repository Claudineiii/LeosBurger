import { TipoUsuario } from "@prisma/client";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import fp from "fastify-plugin";
import type {
  FastifyInstance,
  FastifyReply,
  preHandlerAsyncHookHandler,
} from "fastify";
import { z } from "zod";

export const COOKIE_SESSAO_NOME = "leosburger_session";

const duracaoCookieSegundos = {
  CLIENTE: 30 * 24 * 60 * 60,
  ADMIN: 12 * 60 * 60,
} satisfies Record<TipoUsuario, number>;

function obterAtributosCookie() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

const usuarioIdSchema = z.string().uuid();

function responderNaoAutenticado(reply: FastifyReply) {
  reply.code(401).send({
    status: 401,
    error: "UNAUTHORIZED",
    message: "Autenticação necessária.",
  });
}

async function autenticacaoPlugin(app: FastifyInstance) {
  const segredo = process.env.JWT_SECRET;
  if (!segredo || Buffer.byteLength(segredo, "utf8") < 32) {
    throw new Error("JWT_SECRET deve conter pelo menos 32 bytes.");
  }

  const origemFrontend = process.env.FRONTEND_ORIGIN;
  if (!origemFrontend && process.env.NODE_ENV === "production") {
    throw new Error("FRONTEND_ORIGIN é obrigatório em produção.");
  }

  if (origemFrontend) {
    let urlOrigem: URL;
    try {
      urlOrigem = new URL(origemFrontend);
    } catch {
      throw new Error("FRONTEND_ORIGIN deve ser uma origem HTTP ou HTTPS válida.");
    }

    if (
      urlOrigem.origin !== origemFrontend ||
      (process.env.NODE_ENV === "production" && urlOrigem.protocol !== "https:")
    ) {
      throw new Error("FRONTEND_ORIGIN deve ser uma origem válida e usar HTTPS em produção.");
    }
  }

  await app.register(cors, {
    origin: origemFrontend ? [origemFrontend] : false,
    credentials: Boolean(origemFrontend),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  });
  await app.register(cookie);
  await app.register(jwt, {
    secret: segredo,
    sign: { algorithm: "HS256" },
    verify: { algorithms: ["HS256"] },
    cookie: {
      cookieName: COOKIE_SESSAO_NOME,
      signed: false,
    },
  });

  app.decorateRequest("usuarioAutenticado", null);

  const autenticar: preHandlerAsyncHookHandler = async (request, reply) => {
    let payload: { sub: string };

    try {
      payload = await request.jwtVerify<{ sub: string }>({ onlyCookie: true });
    } catch {
      responderNaoAutenticado(reply);
      return;
    }

    if (!usuarioIdSchema.safeParse(payload.sub).success) {
      responderNaoAutenticado(reply);
      return;
    }

    const usuario = await app.prisma.usuario.findFirst({
      where: {
        id: payload.sub,
        ativo: true,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        tipo: true,
      },
    });

    if (!usuario) {
      responderNaoAutenticado(reply);
      return;
    }

    request.usuarioAutenticado = usuario;
  };

  const verificarOrigem: preHandlerAsyncHookHandler = async (request, reply) => {
    const origemRecebida = request.headers.origin;
    if (!origemRecebida) {
      return;
    }

    const origemEsperada =
      origemFrontend ?? `${request.protocol}://${request.headers.host ?? ""}`;

    if (origemRecebida !== origemEsperada) {
      reply.code(403).send({
        status: 403,
        error: "FORBIDDEN",
        message: "Acesso não autorizado.",
      });
    }
  };

  const autorizarAdmin: preHandlerAsyncHookHandler = async (request, reply) => {
    await autenticar.call(app, request, reply);
    if (reply.sent) {
      return;
    }

    if (request.usuarioAutenticado?.tipo !== TipoUsuario.ADMIN) {
      reply.code(403).send({
        status: 403,
        error: "FORBIDDEN",
        message: "Acesso não autorizado.",
      });
    }
  };

  app.decorate("autenticar", autenticar);
  app.decorate("verificarOrigem", verificarOrigem);
  app.decorate("autorizarAdmin", autorizarAdmin);
}

export function definirCookieSessao(
  reply: FastifyReply,
  token: string,
  tipo: TipoUsuario,
) {
  reply.setCookie(COOKIE_SESSAO_NOME, token, {
    ...obterAtributosCookie(),
    maxAge: duracaoCookieSegundos[tipo],
  });
}

export function limparCookieSessao(reply: FastifyReply) {
  reply.clearCookie(COOKIE_SESSAO_NOME, obterAtributosCookie());
}

export function obterDuracaoTokenSegundos(tipo: TipoUsuario) {
  return duracaoCookieSegundos[tipo];
}

export type UsuarioAutenticado = {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  tipo: TipoUsuario;
};

export default fp(autenticacaoPlugin);
