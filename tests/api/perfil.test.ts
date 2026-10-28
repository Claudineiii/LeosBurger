import { randomUUID } from "node:crypto";
import { MetodoPagamento, TipoEntrega, TipoUsuario } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";

const senhaTeste = "Senha-forte-123";
const origemValida = "http://localhost:5173";

type UsuarioTeste = {
  id: string;
  email: string;
};

function obterCookie(resposta: { headers: { "set-cookie"?: unknown } }) {
  const setCookie = resposta.headers["set-cookie"];
  const valor =
    typeof setCookie === "string"
      ? setCookie
      : Array.isArray(setCookie) && typeof setCookie[0] === "string"
        ? setCookie[0]
        : undefined;

  if (!valor) {
    throw new Error("Resposta de login sem cookie de sessão.");
  }

  return valor.split(";")[0] ?? "";
}

async function criarSessao(app: FastifyInstance, usuario: UsuarioTeste) {
  const resposta = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: usuario.email, senha: senhaTeste },
  });

  expect(resposta.statusCode).toBe(200);
  return obterCookie(resposta);
}

async function comUsuarios(
  teste: (
    app: FastifyInstance,
    primeiro: UsuarioTeste,
    primeiroCookie: string,
    segundo: UsuarioTeste,
    segundoCookie: string,
    rastrearPedido: (id: string) => void,
  ) => Promise<void>,
) {
  const app = criarAplicacao();
  const usuarioIds: string[] = [];
  const pedidoIds: string[] = [];

  try {
    await app.ready();

    const criarUsuario = async (): Promise<UsuarioTeste> => {
      const email = `perfil-${randomUUID()}@example.test`;
      const usuario = await app.prisma.usuario.create({
        data: {
          nome: "Usuário de teste",
          email,
          telefone: "19999999999",
          senhaHash: await bcrypt.hash(senhaTeste, 10),
          tipo: TipoUsuario.CLIENTE,
        },
        select: { id: true, email: true },
      });
      usuarioIds.push(usuario.id);
      return usuario;
    };

    const primeiro = await criarUsuario();
    const segundo = await criarUsuario();
    const [primeiroCookie, segundoCookie] = await Promise.all([
      criarSessao(app, primeiro),
      criarSessao(app, segundo),
    ]);

    await teste(app, primeiro, primeiroCookie, segundo, segundoCookie, (id) => {
      pedidoIds.push(id);
    });
  } finally {
    if (pedidoIds.length > 0) {
      await app.prisma.pedido.deleteMany({
        where: { id: { in: pedidoIds } },
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

function headersComCookie(cookie: string) {
  return {
    cookie,
    origin: origemValida,
  };
}

const enderecoValido = {
  cep: "12345-678",
  logradouro: "Rua das Flores",
  numero: "S/N",
  bairro: "Centro",
  cidade: "Campinas",
  estado: "sp",
};

describe("perfil e endereços do usuário", () => {
  it("protege perfil e endereço contra acesso sem autenticação", async () => {
    await comUsuarios(async (app) => {
      const respostas = await Promise.all([
        app.inject({ method: "GET", url: "/auth/me" }),
        app.inject({
          method: "PATCH",
          url: "/auth/me",
          headers: { origin: origemValida },
          payload: { nome: "Novo nome" },
        }),
        app.inject({ method: "GET", url: "/auth/me/endereco" }),
        app.inject({
          method: "POST",
          url: "/auth/me/endereco",
          headers: { origin: origemValida },
          payload: enderecoValido,
        }),
        app.inject({
          method: "PATCH",
          url: "/auth/me/endereco",
          headers: { origin: origemValida },
          payload: { numero: "10" },
        }),
        app.inject({
          method: "DELETE",
          url: "/auth/me/endereco",
          headers: { origin: origemValida },
        }),
      ]);

      expect(respostas.map((resposta) => resposta.statusCode)).toEqual([
        401, 401, 401, 401, 401, 401,
      ]);
    });
  });

  it("recusa origem divergente nas operações que alteram dados", async () => {
    await comUsuarios(async (app, _primeiro, cookie) => {
      const respostaPerfil = await app.inject({
        method: "PATCH",
        url: "/auth/me",
        headers: {
          cookie,
          origin: "https://origem-maliciosa.example",
        },
        payload: { nome: "Nome alterado" },
      });
      const respostaEndereco = await app.inject({
        method: "POST",
        url: "/auth/me/endereco",
        headers: {
          cookie,
          origin: "https://origem-maliciosa.example",
        },
        payload: enderecoValido,
      });

      expect(respostaPerfil.statusCode).toBe(403);
      expect(respostaEndereco.statusCode).toBe(403);
    });
  });

  it("consulta e atualiza somente o próprio perfil sem expor dados internos", async () => {
    await comUsuarios(async (app, primeiro, primeiroCookie, segundo) => {
      const consulta = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: headersComCookie(primeiroCookie),
      });
      const atualizacao = await app.inject({
        method: "PATCH",
        url: "/auth/me",
        headers: headersComCookie(primeiroCookie),
        payload: {
          nome: "  Nome Atualizado  ",
          email: "  NOVO-EMAIL@EXAMPLE.TEST ",
          telefone: "11988887777",
        },
      });
      const consultaAtualizada = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: headersComCookie(primeiroCookie),
      });

      expect(consulta.statusCode).toBe(200);
      expect(consulta.json()).toMatchObject({
        id: primeiro.id,
        nome: "Usuário de teste",
        email: primeiro.email,
      });
      expect(consulta.json()).not.toHaveProperty("senhaHash");
      expect(consulta.json()).not.toHaveProperty("ativo");
      expect(atualizacao.statusCode).toBe(200);
      expect(atualizacao.json()).toEqual({
        id: primeiro.id,
        nome: "Nome Atualizado",
        email: "novo-email@example.test",
        telefone: "11988887777",
        tipo: "CLIENTE",
      });
      expect(atualizacao.json()).not.toHaveProperty("senhaHash");
      expect(consultaAtualizada.json().email).toBe("novo-email@example.test");

      const perfilSegundo = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: headersComCookie(await criarSessao(app, segundo)),
      });
      expect(perfilSegundo.json().id).toBe(segundo.id);
      expect(perfilSegundo.json().email).toBe(segundo.email);
    });
  });

  it("rejeita payloads inválidos, campos protegidos e e-mail duplicado", async () => {
    await comUsuarios(async (app, primeiro, primeiroCookie, segundo) => {
      const headers = headersComCookie(primeiroCookie);
      const respostas = await Promise.all([
        app.inject({
          method: "PATCH",
          url: "/auth/me",
          headers,
          payload: { email: "email-invalido" },
        }),
        app.inject({
          method: "PATCH",
          url: "/auth/me",
          headers,
          payload: { tipo: "ADMIN" },
        }),
        app.inject({
          method: "PATCH",
          url: "/auth/me",
          headers,
          payload: { usuarioId: segundo.id },
        }),
        app.inject({
          method: "PATCH",
          url: "/auth/me",
          headers,
          payload: {},
        }),
        app.inject({
          method: "PATCH",
          url: "/auth/me",
          headers,
          payload: { email: segundo.email },
        }),
      ]);

      expect(respostas.map((resposta) => resposta.statusCode)).toEqual([
        400, 400, 400, 400, 409,
      ]);

      const perfil = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers,
      });
      expect(perfil.json().id).toBe(primeiro.id);
      expect(perfil.json().email).toBe(primeiro.email);
    });
  });

  it("cria, consulta e atualiza o endereço normalizando CEP e estado", async () => {
    await comUsuarios(async (app, _primeiro, cookie) => {
      const headers = headersComCookie(cookie);
      const criado = await app.inject({
        method: "POST",
        url: "/auth/me/endereco",
        headers,
        payload: enderecoValido,
      });
      const consultado = await app.inject({
        method: "GET",
        url: "/auth/me/endereco",
        headers,
      });
      const atualizado = await app.inject({
        method: "PATCH",
        url: "/auth/me/endereco",
        headers,
        payload: {
          cep: "87654321",
          estado: "rj",
          complemento: null,
        },
      });

      expect(criado.statusCode).toBe(201);
      expect(criado.json()).toMatchObject({
        cep: "12345678",
        numero: "S/N",
        estado: "SP",
        complemento: null,
        referencia: null,
      });
      expect(criado.json()).not.toHaveProperty("usuarioId");
      expect(criado.json()).not.toHaveProperty("latitude");
      expect(consultado.statusCode).toBe(200);
      expect(consultado.json().id).toBe(criado.json().id);
      expect(atualizado.statusCode).toBe(200);
      expect(atualizado.json()).toMatchObject({
        cep: "87654321",
        estado: "RJ",
        complemento: null,
        numero: "S/N",
      });
    });
  });

  it("valida o endereço e impede duplicidade e campos arbitrários", async () => {
    await comUsuarios(async (app, primeiro, cookie) => {
      const headers = headersComCookie(cookie);
      const criado = await app.inject({
        method: "POST",
        url: "/auth/me/endereco",
        headers,
        payload: enderecoValido,
      });
      const duplicado = await app.inject({
        method: "POST",
        url: "/auth/me/endereco",
        headers,
        payload: enderecoValido,
      });
      const cepInvalido = await app.inject({
        method: "POST",
        url: "/auth/me/endereco",
        headers,
        payload: { ...enderecoValido, cep: "12A45-678" },
      });
      const estadoInvalido = await app.inject({
        method: "POST",
        url: "/auth/me/endereco",
        headers,
        payload: { ...enderecoValido, estado: "SPX" },
      });
      const usuarioArbitrario = await app.inject({
        method: "POST",
        url: "/auth/me/endereco",
        headers,
        payload: { ...enderecoValido, usuarioId: primeiro.id },
      });
      const patchVazio = await app.inject({
        method: "PATCH",
        url: "/auth/me/endereco",
        headers,
        payload: {},
      });
      const numeroLongo = await app.inject({
        method: "PATCH",
        url: "/auth/me/endereco",
        headers,
        payload: { numero: "1".repeat(21) },
      });
      const numeroNumerico = await app.inject({
        method: "PATCH",
        url: "/auth/me/endereco",
        headers,
        payload: { numero: 123 },
      });
      const enderecoDepoisDaDuplicidade = await app.inject({
        method: "GET",
        url: "/auth/me/endereco",
        headers,
      });

      expect(criado.statusCode).toBe(201);
      expect(duplicado.statusCode).toBe(409);
      expect(cepInvalido.statusCode).toBe(400);
      expect(cepInvalido.json().error).toBe("VALIDATION_ERROR");
      expect(cepInvalido.json().details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "/cep" }),
        ]),
      );
      expect(estadoInvalido.statusCode).toBe(400);
      expect(usuarioArbitrario.statusCode).toBe(400);
      expect(patchVazio.statusCode).toBe(400);
      expect(numeroLongo.statusCode).toBe(400);
      expect(numeroNumerico.statusCode).toBe(400);
      expect(enderecoDepoisDaDuplicidade.json().id).toBe(criado.json().id);
    });
  });

  it("responde 404 quando o endereço do usuário não existe", async () => {
    await comUsuarios(async (app, _primeiro, cookie) => {
      const headers = headersComCookie(cookie);
      const respostas = await Promise.all([
        app.inject({ method: "GET", url: "/auth/me/endereco", headers }),
        app.inject({
          method: "PATCH",
          url: "/auth/me/endereco",
          headers,
          payload: { numero: "10" },
        }),
        app.inject({ method: "DELETE", url: "/auth/me/endereco", headers }),
      ]);

      expect(respostas.map((resposta) => resposta.statusCode)).toEqual([
        404, 404, 404,
      ]);
    });
  });

  it("não permite consultar, alterar ou excluir endereço de outro usuário", async () => {
    await comUsuarios(async (app, _primeiro, primeiroCookie, _segundo, segundoCookie) => {
      const headersPrimeiro = headersComCookie(primeiroCookie);
      const headersSegundo = headersComCookie(segundoCookie);
      const criado = await app.inject({
        method: "POST",
        url: "/auth/me/endereco",
        headers: headersPrimeiro,
        payload: enderecoValido,
      });
      const consultaAlheia = await app.inject({
        method: "GET",
        url: "/auth/me/endereco",
        headers: headersSegundo,
      });
      const atualizacaoAlheia = await app.inject({
        method: "PATCH",
        url: "/auth/me/endereco",
        headers: headersSegundo,
        payload: { numero: "999" },
      });
      const exclusaoAlheia = await app.inject({
        method: "DELETE",
        url: "/auth/me/endereco",
        headers: headersSegundo,
      });
      const enderecoOriginal = await app.inject({
        method: "GET",
        url: "/auth/me/endereco",
        headers: headersPrimeiro,
      });

      expect(criado.statusCode).toBe(201);
      expect(consultaAlheia.statusCode).toBe(404);
      expect(atualizacaoAlheia.statusCode).toBe(404);
      expect(exclusaoAlheia.statusCode).toBe(404);
      expect(enderecoOriginal.json()).toMatchObject({
        id: criado.json().id,
        numero: "S/N",
      });
    });
  });

  it("preserva o snapshot do pedido ao atualizar e excluir o endereço atual", async () => {
    await comUsuarios(async (app, usuario, cookie, _segundo, _cookieSegundo, rastrearPedido) => {
      const headers = headersComCookie(cookie);
      const endereco = await app.inject({
        method: "POST",
        url: "/auth/me/endereco",
        headers,
        payload: enderecoValido,
      });
      const pedido = await app.prisma.pedido.create({
        data: {
          usuarioId: usuario.id,
          tipoEntrega: TipoEntrega.ENTREGA,
          nomeClienteHistorico: "Usuário de teste",
          telefoneClienteHistorico: "19999999999",
          cepHistorico: "12345678",
          logradouroHistorico: "Rua das Flores",
          numeroHistorico: "S/N",
          bairroHistorico: "Centro",
          cidadeHistorico: "Campinas",
          estadoHistorico: "SP",
          distanciaKm: 0,
          subtotal: 15,
          total: 15,
          metodoPagamento: MetodoPagamento.PIX,
        },
        select: { id: true },
      });
      rastrearPedido(pedido.id);

      const atualizacao = await app.inject({
        method: "PATCH",
        url: "/auth/me/endereco",
        headers,
        payload: { logradouro: "Avenida Nova", numero: "100" },
      });
      const exclusao = await app.inject({
        method: "DELETE",
        url: "/auth/me/endereco",
        headers,
      });
      const pedidoHistorico = await app.prisma.pedido.findUniqueOrThrow({
        where: { id: pedido.id },
        select: {
          cepHistorico: true,
          logradouroHistorico: true,
          numeroHistorico: true,
          bairroHistorico: true,
          cidadeHistorico: true,
          estadoHistorico: true,
        },
      });
      const enderecoAusente = await app.inject({
        method: "GET",
        url: "/auth/me/endereco",
        headers,
      });

      expect(endereco.statusCode).toBe(201);
      expect(atualizacao.statusCode).toBe(200);
      expect(exclusao.statusCode).toBe(204);
      expect(exclusao.body).toBe("");
      expect(pedidoHistorico).toEqual({
        cepHistorico: "12345678",
        logradouroHistorico: "Rua das Flores",
        numeroHistorico: "S/N",
        bairroHistorico: "Centro",
        cidadeHistorico: "Campinas",
        estadoHistorico: "SP",
      });
      expect(enderecoAusente.statusCode).toBe(404);
    });
  });

  it("documenta contratos e respostas públicas no OpenAPI", async () => {
    await comUsuarios(async (app) => {
      const paths = app.swagger().paths;
      const deleteAddressResponse =
        paths?.["/auth/me/endereco"]?.delete?.responses?.["204"];
      const deleteAddressContent =
        deleteAddressResponse && "content" in deleteAddressResponse
          ? deleteAddressResponse.content
          : undefined;
      const profileResponse = paths?.["/auth/me"]?.get?.responses?.["200"];
      const profileContent =
        profileResponse && "content" in profileResponse
          ? profileResponse.content
          : undefined;
      const profileSchema = profileContent?.["application/json"]?.schema;
      const profileProperties =
        profileSchema && "properties" in profileSchema
          ? profileSchema.properties
          : undefined;

      expect(paths?.["/auth/me"]?.get?.responses?.["200"]).toBeDefined();
      expect(paths?.["/auth/me"]?.patch?.responses?.["409"]).toBeDefined();
      expect(paths?.["/auth/me/endereco"]?.get?.responses?.["404"]).toBeDefined();
      expect(paths?.["/auth/me/endereco"]?.post?.responses?.["201"]).toBeDefined();
      expect(
        paths?.["/auth/me/endereco"]?.patch &&
          "requestBody" in paths["/auth/me/endereco"].patch
          ? paths["/auth/me/endereco"].patch.requestBody
          : undefined,
      ).toBeDefined();
      expect(deleteAddressContent).toBeUndefined();
      expect(profileProperties).not.toHaveProperty("senhaHash");
    });
  });
});
