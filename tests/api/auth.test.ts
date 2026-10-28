import { randomUUID } from "node:crypto";
import { TipoUsuario } from "@prisma/client";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import autenticacaoPlugin, {
  COOKIE_SESSAO_NOME,
} from "../../src/plugins/autenticacao.js";
import { criarAplicacao } from "../../src/app.js";

const senhaTeste = "Senha-forte-123";
const segredoTesteValido = "segredo-de-teste-com-mais-de-32-bytes";

type VariaveisAutenticacao = "NODE_ENV" | "JWT_SECRET" | "FRONTEND_ORIGIN";

async function esperarFalhaConfiguracaoAutenticacao(
  variaveis: Record<VariaveisAutenticacao, string | undefined>,
  mensagem: string,
) {
  const ambienteAnterior = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
  };

  for (const chave of Object.keys(variaveis) as VariaveisAutenticacao[]) {
    const valor = variaveis[chave];
    if (valor === undefined) {
      delete process.env[chave];
    } else {
      process.env[chave] = valor;
    }
  }

  try {
    const app = Fastify({ logger: false });
    app.register(autenticacaoPlugin);
    await expect(app.ready()).rejects.toThrow(mensagem);
  } finally {
    for (const chave of Object.keys(ambienteAnterior) as VariaveisAutenticacao[]) {
      const valor = ambienteAnterior[chave];
      if (valor === undefined) {
        delete process.env[chave];
      } else {
        process.env[chave] = valor;
      }
    }
  }
}

function criarAplicacaoDeTeste() {
  const app = criarAplicacao();

  app.register(async (testApp) => {
    testApp.get(
      "/_test/privado",
      { preHandler: testApp.autenticar },
      async (request) => ({ id: request.usuarioAutenticado?.id }),
    );
    testApp.get(
      "/_test/admin",
      { preHandler: testApp.autorizarAdmin },
      async () => ({ autorizado: true }),
    );
    testApp.post(
      "/_test/admin-write",
      { preHandler: [testApp.verificarOrigem, testApp.autorizarAdmin] },
      async () => ({ autorizado: true }),
    );
  });

  return app;
}

function obterSetCookie(resposta: {
  headers: { "set-cookie"?: unknown };
}) {
  const setCookie = resposta.headers["set-cookie"];
  const primeiroCookie =
    typeof setCookie === "string"
      ? setCookie
      : Array.isArray(setCookie) && typeof setCookie[0] === "string"
        ? setCookie[0]
        : undefined;
  expect(primeiroCookie).toBeDefined();

  if (!primeiroCookie) {
    throw new Error("Resposta não contém o cookie de sessão.");
  }

  return primeiroCookie;
}

function obterCookie(resposta: {
  headers: { "set-cookie"?: unknown };
}) {
  return obterSetCookie(resposta).split(";")[0] ?? "";
}

function obterValorCookie(cookie: string) {
  return cookie.slice(cookie.indexOf("=") + 1);
}

async function comAplicacao(
  teste: (
    app: FastifyInstance,
    criarUsuario: (
      tipo?: TipoUsuario,
      ativo?: boolean,
      email?: string,
    ) => Promise<{ id: string; email: string }>,
    rastrearUsuario: (id: string) => void,
    rastrearEmail: (email: string) => void,
  ) => Promise<void>,
) {
  const app = criarAplicacaoDeTeste();
  const usuarioIds: string[] = [];
  const usuarioEmails: string[] = [];

  try {
    await app.ready();

    const criarUsuario = async (
      tipo: TipoUsuario = TipoUsuario.CLIENTE,
      ativo = true,
      email = `auth-${randomUUID()}@example.test`,
    ) => {
      const usuario = await app.prisma.usuario.create({
        data: {
          nome: "Usuário de autenticação",
          email,
          telefone: "19999999999",
          senhaHash: await bcrypt.hash(senhaTeste, 10),
          tipo,
          ativo,
        },
        select: { id: true, email: true },
      });
      usuarioIds.push(usuario.id);
      return usuario;
    };

    await teste(
      app,
      criarUsuario,
      (id) => {
        if (typeof id !== "string") {
          throw new Error("A fixture de autenticação não retornou um identificador.");
        }

        usuarioIds.push(id);
      },
      (email) => usuarioEmails.push(email),
    );
  } finally {
    if (usuarioEmails.length > 0) {
      await app.prisma.usuario.deleteMany({
        where: { email: { in: usuarioEmails } },
      });
    }

    if (usuarioIds.length > 0) {
      await app.prisma.usuario.deleteMany({
        where: { id: { in: usuarioIds } },
      });
    }

    await app.close();
  }
}

describe("autenticação e autorização", () => {
  it("cadastra cliente, normaliza o e-mail e armazena somente o hash", async () => {
    await comAplicacao(async (app, _criarUsuario, _rastrearUsuario, rastrearEmail) => {
      const email = `cliente-novo-${randomUUID()}@example.test`;
      rastrearEmail(email);
      const resposta = await app.inject({
        method: "POST",
        url: "/auth/cadastro",
        payload: {
          nome: "  Cliente Novo  ",
          email: `  ${email.toUpperCase()} `,
          telefone: "19999998888",
          senha: senhaTeste,
        },
      });
      const corpo = resposta.json();
      const usuario = await app.prisma.usuario.findUnique({
        where: { email },
      });

      expect(resposta.statusCode).toBe(201);
      expect(corpo).toEqual({
        id: expect.any(String),
        nome: "Cliente Novo",
        email,
        telefone: "19999998888",
        tipo: "CLIENTE",
      });
      expect(resposta.body).not.toContain("senha");
      expect(resposta.body).not.toContain("senhaHash");
      expect(usuario?.senhaHash).not.toBe(senhaTeste);
      expect(await bcrypt.compare(senhaTeste, usuario?.senhaHash ?? "")).toBe(true);
    });
  });

  it("rejeita dados inválidos e impede escolher ADMIN no cadastro público", async () => {
    await comAplicacao(async (app) => {
      const emailAdmin = `admin-${randomUUID()}@example.test`;
      const respostas = await Promise.all([
        app.inject({
          method: "POST",
          url: "/auth/cadastro",
          payload: {
            nome: "Cliente",
            email: "email-invalido",
            telefone: "123",
            senha: "curta",
          },
        }),
        app.inject({
          method: "POST",
          url: "/auth/cadastro",
          payload: {
            nome: "Cliente",
            email: emailAdmin,
            telefone: "19999999999",
            senha: senhaTeste,
            tipo: "ADMIN",
          },
        }),
      ]);

      for (const resposta of respostas) {
        expect(resposta.statusCode).toBe(400);
        expect(resposta.json().error).toBe("VALIDATION_ERROR");
      }
      expect(
        await app.prisma.usuario.findUnique({ where: { email: emailAdmin } }),
      ).toBeNull();
    });
  });

  it("rejeita requisições de outra origem em operações de escrita", async () => {
    await comAplicacao(async (app) => {
      const email = `origem-${randomUUID()}@example.test`;
      const resposta = await app.inject({
        method: "POST",
        url: "/auth/cadastro",
        headers: { origin: "https://origem-maliciosa.example" },
        payload: {
          nome: "Cliente",
          email,
          telefone: "19999999999",
          senha: senhaTeste,
        },
      });

      expect(resposta.statusCode).toBe(403);
      expect(await app.prisma.usuario.findUnique({ where: { email } })).toBeNull();
    });
  });

  it("permite cadastro sem Origin para clientes que não são navegadores", async () => {
    await comAplicacao(async (app, _criarUsuario, _rastrearUsuario, rastrearEmail) => {
      const email = `sem-origem-${randomUUID()}@example.test`;
      rastrearEmail(email);
      const resposta = await app.inject({
        method: "POST",
        url: "/auth/cadastro",
        payload: {
          nome: "Cliente sem navegador",
          email,
          telefone: "19999999999",
          senha: senhaTeste,
        },
      });

      expect(resposta.statusCode).toBe(201);
      expect(resposta.json().tipo).toBe(TipoUsuario.CLIENTE);
    });
  });

  it("permite CORS com credenciais somente para a origem configurada", async () => {
    await comAplicacao(async (app) => {
      const preflightPermitido = await app.inject({
        method: "OPTIONS",
        url: "/auth/login",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      const preflightNegado = await app.inject({
        method: "OPTIONS",
        url: "/auth/login",
        headers: {
          origin: "https://origem-maliciosa.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });

      expect(preflightPermitido.statusCode).toBe(204);
      expect(preflightPermitido.headers["access-control-allow-origin"]).toBe(
        "http://localhost:5173",
      );
      expect(preflightPermitido.headers["access-control-allow-credentials"]).toBe("true");
      expect(preflightNegado.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  it("responde com conflito para e-mail duplicado após normalização", async () => {
    await comAplicacao(async (app, _criarUsuario, _rastrearUsuario, rastrearEmail) => {
      const email = `duplicado-${randomUUID()}@example.test`;
      rastrearEmail(email);
      const cadastro = {
        nome: "Cliente",
        telefone: "19999999999",
        senha: senhaTeste,
      };

      const primeiraResposta = await app.inject({
        method: "POST",
        url: "/auth/cadastro",
        payload: { ...cadastro, email },
      });
      const segundaResposta = await app.inject({
        method: "POST",
        url: "/auth/cadastro",
        payload: { ...cadastro, email: ` ${email.toUpperCase()} ` },
      });

      expect(primeiraResposta.statusCode).toBe(201);
      expect(segundaResposta.statusCode).toBe(409);
      expect(segundaResposta.json()).toEqual({
        status: 409,
        error: "CONFLICT",
        message: "Não foi possível cadastrar com esses dados.",
      });

    });
  });

  it("autentica cliente, define cookie protegido e usa a validade de 30 dias", async () => {
    await comAplicacao(async (app, criarUsuario) => {
      const usuario = await criarUsuario();
      const resposta = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: ` ${usuario.email.toUpperCase()} `, senha: senhaTeste },
      });
      const setCookie = obterSetCookie(resposta);
      const cookie = obterCookie(resposta);
      const token = obterValorCookie(cookie);
      const claims = app.jwt.verify<{ sub: string; iat: number; exp: number }>(token);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({
        id: usuario.id,
        nome: "Usuário de autenticação",
        email: usuario.email,
        telefone: "19999999999",
        tipo: "CLIENTE",
      });
      expect(cookie).toContain(`${COOKIE_SESSAO_NOME}=`);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain("Max-Age=2592000");
      expect(claims.sub).toBe(usuario.id);
      expect(claims).not.toHaveProperty("tipo");
      expect(claims.exp - claims.iat).toBe(30 * 24 * 60 * 60);
      expect(resposta.body).not.toContain("senhaHash");
      expect(resposta.body).not.toContain(token);
    });
  });

  it("usa a validade de 12 horas para usuário ADMIN", async () => {
    await comAplicacao(async (app, criarUsuario) => {
      const usuario = await criarUsuario(TipoUsuario.ADMIN);
      const resposta = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: usuario.email, senha: senhaTeste },
      });
      const setCookie = obterSetCookie(resposta);
      const cookie = obterCookie(resposta);
      const claims = app.jwt.verify<{
        sub: string;
        iat: number;
        exp: number;
      }>(obterValorCookie(cookie));

      expect(resposta.statusCode).toBe(200);
      expect(setCookie).toContain("Max-Age=43200");
      expect(claims.exp - claims.iat).toBe(12 * 60 * 60);
    });
  });

  it("adiciona Secure ao cookie quando NODE_ENV é production", async () => {
    await comAplicacao(async (app, criarUsuario) => {
      const usuario = await criarUsuario();
      const nodeEnvAnterior = process.env.NODE_ENV;

      try {
        process.env.NODE_ENV = "production";
        const resposta = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: usuario.email, senha: senhaTeste },
        });

        expect(resposta.statusCode).toBe(200);
        expect(obterSetCookie(resposta)).toContain("Secure");
      } finally {
        if (nodeEnvAnterior === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = nodeEnvAnterior;
        }
      }
    });
  });

  it("não distingue credenciais inválidas e rejeita usuário inativo", async () => {
    await comAplicacao(async (app, criarUsuario) => {
      const usuario = await criarUsuario();
      const payload = (email: string, senha: string) =>
        app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email, senha },
        });

      const respostas = await Promise.all([
        payload(usuario.email, "Senha incorreta 123"),
        payload(`ausente-${randomUUID()}@example.test`, senhaTeste),
      ]);

      expect(respostas[0]?.statusCode).toBe(401);
      expect(respostas[1]?.statusCode).toBe(401);
      expect(respostas[0]?.json()).toEqual(respostas[1]?.json());
      expect(respostas[0]?.json()).toEqual({
        status: 401,
        error: "UNAUTHORIZED",
        message: "E-mail ou senha inválidos.",
      });

      await app.prisma.usuario.update({
        where: { id: usuario.id },
        data: { ativo: false },
      });
      const respostaInativo = await payload(usuario.email, senhaTeste);
      expect(respostaInativo.statusCode).toBe(401);
      expect(respostaInativo.json()).toEqual(respostas[0]?.json());
    });
  });

  it("retorna somente os dados públicos do usuário autenticado em /auth/me", async () => {
    await comAplicacao(async (app, criarUsuario) => {
      const usuario = await criarUsuario();
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: usuario.email, senha: senhaTeste },
      });
      const resposta = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie: obterCookie(login) },
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({
        id: usuario.id,
        nome: "Usuário de autenticação",
        email: usuario.email,
        telefone: "19999999999",
        tipo: "CLIENTE",
      });
      expect(resposta.body).not.toContain("senha");
      expect(resposta.body).not.toContain("senhaHash");
      expect(resposta.body).not.toContain("ativo");
      expect(resposta.body).not.toContain("criadoEm");
    });
  });

  it("rejeita sessão ausente, inválida e expirada", async () => {
    await comAplicacao(async (app, criarUsuario) => {
      const usuario = await criarUsuario();
      const tokenInvalido = `${COOKIE_SESSAO_NOME}=token-invalido`;
      const tokenExpirado = app.jwt.sign({
        sub: usuario.id,
        iat: Math.floor(Date.now() / 1000) - 120,
        exp: Math.floor(Date.now() / 1000) - 60,
      });

      const respostas = await Promise.all([
        app.inject({ method: "GET", url: "/auth/me" }),
        app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${app.jwt.sign({ sub: usuario.id })}` },
        }),
        app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { cookie: tokenInvalido },
        }),
        app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { cookie: `${COOKIE_SESSAO_NOME}=${tokenExpirado}` },
        }),
      ]);

      for (const resposta of respostas) {
        expect(resposta.statusCode).toBe(401);
        expect(resposta.json()).toEqual({
          status: 401,
          error: "UNAUTHORIZED",
          message: "Autenticação necessária.",
        });
      }
    });
  });

  it("revalida o estado ativo do usuário em cada requisição protegida", async () => {
    await comAplicacao(async (app, criarUsuario) => {
      const usuario = await criarUsuario();
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: usuario.email, senha: senhaTeste },
      });
      const cookie = obterCookie(login);

      await app.prisma.usuario.update({
        where: { id: usuario.id },
        data: { ativo: false },
      });
      const resposta = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie },
      });

      expect(resposta.statusCode).toBe(401);
    });
  });

  it("logout limpa o cookie com os mesmos atributos sem revogar JWT copiado", async () => {
    await comAplicacao(async (app, criarUsuario) => {
      const usuario = await criarUsuario();
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: usuario.email, senha: senhaTeste },
      });
      const cookieCopiado = obterCookie(login);
      const respostaLogout = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { cookie: cookieCopiado },
      });
      const cookieLimpoHeader = respostaLogout.headers["set-cookie"];
      const cookieLimpo = Array.isArray(cookieLimpoHeader)
        ? cookieLimpoHeader[0]
        : cookieLimpoHeader;
      const respostaComTokenCopiado = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie: cookieCopiado },
      });

      expect(respostaLogout.statusCode).toBe(204);
      expect(respostaLogout.body).toBe("");
      expect(cookieLimpo).toContain(`${COOKIE_SESSAO_NOME}=`);
      expect(cookieLimpo).toContain("HttpOnly");
      expect(cookieLimpo).toContain("SameSite=Strict");
      expect(cookieLimpo).toContain("Path=/");
      expect(cookieLimpo).toContain("Max-Age=0");
      expect(respostaComTokenCopiado.statusCode).toBe(200);
    });
  });

  it("distingue visitante, cliente e ADMIN nas rotas privadas reutilizáveis", async () => {
    await comAplicacao(async (app, criarUsuario) => {
      const cliente = await criarUsuario();
      const admin = await criarUsuario(TipoUsuario.ADMIN);
      const login = async (usuario: { id: string; email: string }) =>
        app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: usuario.email, senha: senhaTeste },
        });

      const [loginCliente, loginAdmin] = await Promise.all([login(cliente), login(admin)]);
      const respostaVisitante = await app.inject({
        method: "GET",
        url: "/_test/admin",
      });
      const respostaCliente = await app.inject({
        method: "GET",
        url: "/_test/admin",
        headers: { cookie: obterCookie(loginCliente) },
      });
      const respostaAdmin = await app.inject({
        method: "GET",
        url: "/_test/admin",
        headers: { cookie: obterCookie(loginAdmin) },
      });
      const respostaPrivadaCliente = await app.inject({
        method: "GET",
        url: "/_test/privado",
        headers: { cookie: obterCookie(loginCliente) },
      });
      const escritaAdmin = await app.inject({
        method: "POST",
        url: "/_test/admin-write",
        headers: {
          cookie: obterCookie(loginAdmin),
          origin: "http://localhost:5173",
        },
      });
      const escritaOrigemExterna = await app.inject({
        method: "POST",
        url: "/_test/admin-write",
        headers: {
          cookie: obterCookie(loginAdmin),
          origin: "https://origem-maliciosa.example",
        },
      });

      expect(respostaVisitante.statusCode).toBe(401);
      expect(respostaCliente.statusCode).toBe(403);
      expect(respostaAdmin.statusCode).toBe(200);
      expect(respostaPrivadaCliente.json()).toEqual({ id: cliente.id });
      expect(escritaAdmin.statusCode).toBe(200);
      expect(escritaOrigemExterna.statusCode).toBe(403);
    });
  });

  it("aplica o tipo atual do banco após alteração de permissões", async () => {
    await comAplicacao(async (app, criarUsuario) => {
      const admin = await criarUsuario(TipoUsuario.ADMIN);
      const loginAdmin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: admin.email, senha: senhaTeste },
      });
      const cookieAdmin = obterCookie(loginAdmin);

      await app.prisma.usuario.update({
        where: { id: admin.id },
        data: { tipo: TipoUsuario.CLIENTE },
      });
      const adminRebaixado = await app.inject({
        method: "GET",
        url: "/_test/admin",
        headers: { cookie: cookieAdmin },
      });

      const cliente = await criarUsuario();
      const loginCliente = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: cliente.email, senha: senhaTeste },
      });
      const cookieCliente = obterCookie(loginCliente);

      await app.prisma.usuario.update({
        where: { id: cliente.id },
        data: { tipo: TipoUsuario.ADMIN },
      });
      const clientePromovido = await app.inject({
        method: "GET",
        url: "/_test/admin",
        headers: { cookie: cookieCliente },
      });

      expect(adminRebaixado.statusCode).toBe(403);
      expect(clientePromovido.statusCode).toBe(200);
      expect(clientePromovido.json()).toEqual({ autorizado: true });
    });
  });

  it("mantém públicas as rotas do catálogo", async () => {
    await comAplicacao(async (app) => {
      const respostas = await Promise.all([
        app.inject({ method: "GET", url: "/categorias" }),
        app.inject({ method: "GET", url: "/itens" }),
        app.inject({ method: "GET", url: "/combos" }),
      ]);

      expect(respostas.map((resposta) => resposta.statusCode)).toEqual([200, 200, 200]);
    });
  });

  it("documenta endpoints, cookie de sessão e contratos de erro no OpenAPI", async () => {
    await comAplicacao(async (app) => {
      const resposta = await app.inject({
        method: "GET",
        url: "/reference/openapi.json",
      });
      const documento = resposta.json();

      expect(resposta.statusCode).toBe(200);
      expect(documento.components.securitySchemes.sessionCookie).toEqual({
        type: "apiKey",
        in: "cookie",
        name: COOKIE_SESSAO_NOME,
      });
      expect(documento.paths["/auth/cadastro"].post.responses["201"]).toBeDefined();
      expect(documento.paths["/auth/cadastro"].post.responses["403"]).toBeDefined();
      expect(documento.paths["/auth/login"].post.responses["401"]).toBeDefined();
      expect(documento.paths["/auth/logout"].post.responses["204"]).toEqual({
        description: "Cookie de autenticação removido do navegador.",
      });
      expect(documento.paths["/auth/me"].get.parameters ?? []).toEqual([]);
      expect(documento.paths["/auth/me"].get.security).toEqual([{ sessionCookie: [] }]);
      expect(documento.paths["/auth/me"].get.responses["401"]).toBeDefined();
      expect(resposta.body).not.toContain("senhaHash");
    });
  });
});

describe("configuração de autenticação", () => {
  it("falha ao iniciar quando JWT_SECRET está ausente", async () => {
    await esperarFalhaConfiguracaoAutenticacao(
      {
        NODE_ENV: "test",
        JWT_SECRET: undefined,
        FRONTEND_ORIGIN: "http://localhost:5173",
      },
      "JWT_SECRET deve conter pelo menos 32 bytes.",
    );
  });

  it("falha ao iniciar quando JWT_SECRET tem menos de 32 bytes", async () => {
    await esperarFalhaConfiguracaoAutenticacao(
      {
        NODE_ENV: "test",
        JWT_SECRET: "curto",
        FRONTEND_ORIGIN: "http://localhost:5173",
      },
      "JWT_SECRET deve conter pelo menos 32 bytes.",
    );
  });

  it("falha ao iniciar em produção quando FRONTEND_ORIGIN está ausente", async () => {
    await esperarFalhaConfiguracaoAutenticacao(
      {
        NODE_ENV: "production",
        JWT_SECRET: segredoTesteValido,
        FRONTEND_ORIGIN: undefined,
      },
      "FRONTEND_ORIGIN é obrigatório em produção.",
    );
  });

  it("falha ao iniciar em produção quando FRONTEND_ORIGIN é inválida", async () => {
    await esperarFalhaConfiguracaoAutenticacao(
      {
        NODE_ENV: "production",
        JWT_SECRET: segredoTesteValido,
        FRONTEND_ORIGIN: "origem inválida",
      },
      "FRONTEND_ORIGIN deve ser uma origem HTTP ou HTTPS válida.",
    );
  });

  it("falha ao iniciar em produção quando FRONTEND_ORIGIN não usa HTTPS", async () => {
    await esperarFalhaConfiguracaoAutenticacao(
      {
        NODE_ENV: "production",
        JWT_SECRET: segredoTesteValido,
        FRONTEND_ORIGIN: "http://loja.example",
      },
      "FRONTEND_ORIGIN deve ser uma origem válida e usar HTTPS em produção.",
    );
  });
});
