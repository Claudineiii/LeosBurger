import { randomUUID } from "node:crypto";
import { TipoUsuario } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";

const senhaTeste = "Senha-forte-123";

function cookieDaResposta(cabecalho: unknown) {
  const valor =
    typeof cabecalho === "string"
      ? cabecalho
      : Array.isArray(cabecalho) && typeof cabecalho[0] === "string"
        ? cabecalho[0]
        : undefined;
  if (!valor) {
    throw new Error("Resposta de login sem cookie.");
  }
  return valor.split(";")[0] ?? "";
}

async function comCatalogoAdmin(
  teste: (
    app: FastifyInstance,
    adminCookie: string,
    clienteCookie: string,
    rastrearCategoria: (id: string) => void,
    rastrearItem: (id: string) => void,
  ) => Promise<void>,
) {
  const app = criarAplicacao();
  const categoriaIds: string[] = [];
  const itemIds: string[] = [];
  const usuarioIds: string[] = [];

  try {
    await app.ready();

    const senhaHash = await bcrypt.hash(senhaTeste, 10);
    const admin = await app.prisma.usuario.create({
      data: {
        nome: "Administrador de teste",
        email: `catalogo-admin-${randomUUID()}@example.test`,
        telefone: "19999990001",
        senhaHash,
        tipo: TipoUsuario.ADMIN,
      },
      select: { id: true, email: true },
    });
    const cliente = await app.prisma.usuario.create({
      data: {
        nome: "Cliente de teste",
        email: `catalogo-cliente-${randomUUID()}@example.test`,
        telefone: "19999990002",
        senhaHash,
        tipo: TipoUsuario.CLIENTE,
      },
      select: { id: true, email: true },
    });
    usuarioIds.push(admin.id, cliente.id);

    const loginAdmin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: admin.email, senha: senhaTeste },
    });
    const loginCliente = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: cliente.email, senha: senhaTeste },
    });

    expect(loginAdmin.statusCode).toBe(200);
    expect(loginCliente.statusCode).toBe(200);

    await teste(
      app,
      cookieDaResposta(loginAdmin.headers["set-cookie"]),
      cookieDaResposta(loginCliente.headers["set-cookie"]),
      (id) => categoriaIds.push(id),
      (id) => itemIds.push(id),
    );
  } finally {
    if (itemIds.length > 0 || categoriaIds.length > 0) {
      await app.prisma.item.deleteMany({
        where: {
          OR: [
            ...(itemIds.length > 0 ? [{ id: { in: itemIds } }] : []),
            ...(categoriaIds.length > 0
              ? [{ categoriaId: { in: categoriaIds } }]
              : []),
          ],
        },
      });
    }
    if (categoriaIds.length > 0) {
      await app.prisma.categoria.deleteMany({
        where: { id: { in: categoriaIds } },
      });
    }
    if (usuarioIds.length > 0) {
      await app.prisma.usuario.deleteMany({ where: { id: { in: usuarioIds } } });
    }
    await app.close();
  }
}

async function criarCategoriaNoBanco(app: FastifyInstance) {
  return app.prisma.categoria.create({
    data: { nome: `Categoria teste ${randomUUID()}` },
    select: { id: true },
  });
}

describe("administração de categorias e itens", () => {
  it("exige autenticação e papel ADMIN para consultas e alterações", async () => {
    await comCatalogoAdmin(async (app, adminCookie, clienteCookie, trackCategoria) => {
      const semSessao = await app.inject({
        method: "GET",
        url: "/admin/categorias",
      });
      const cliente = await app.inject({
        method: "GET",
        url: "/admin/categorias",
        headers: { cookie: clienteCookie },
      });
      const clienteEscrita = await app.inject({
        method: "POST",
        url: "/admin/categorias",
        headers: { cookie: clienteCookie },
        payload: { nome: "Sem permissão" },
      });
      const origemNaoPermitida = await app.inject({
        method: "POST",
        url: "/admin/categorias",
        headers: {
          cookie: adminCookie,
          origin: "https://origem-nao-permitida.example",
        },
        payload: { nome: "Origem bloqueada" },
      });
      const origemPermitida = await app.inject({
        method: "POST",
        url: "/admin/categorias",
        headers: {
          cookie: adminCookie,
          origin: "http://localhost:5173",
        },
        payload: { nome: `Origem permitida ${randomUUID()}` },
      });
      if (origemPermitida.statusCode === 201) {
        const categoriaCriada = origemPermitida.json() as { id: string };
        trackCategoria(categoriaCriada.id);
      }
      const admin = await app.inject({
        method: "GET",
        url: "/admin/categorias",
        headers: { cookie: adminCookie },
      });

      expect(semSessao.statusCode).toBe(401);
      expect(cliente.statusCode).toBe(403);
      expect(clienteEscrita.statusCode).toBe(403);
      expect(origemNaoPermitida.statusCode).toBe(403);
      expect(origemPermitida.statusCode).toBe(201);
      expect(admin.statusCode).toBe(200);
    });
  });

  it("cria categoria com campos permitidos e rejeita dados inválidos ou extras", async () => {
    await comCatalogoAdmin(async (app, adminCookie, _clienteCookie, trackCategoria) => {
      const criada = await app.inject({
        method: "POST",
        url: "/admin/categorias",
        headers: { cookie: adminCookie },
        payload: { nome: "  Lanches especiais  ", descricao: " Novidades ", ordem: 4 },
      });
      const invalida = await app.inject({
        method: "POST",
        url: "/admin/categorias",
        headers: { cookie: adminCookie },
        payload: { nome: "   ", ativo: false },
      });

      expect(criada.statusCode).toBe(201);
      expect(criada.json()).toMatchObject({
        id: expect.any(String),
        nome: "Lanches especiais",
        descricao: "Novidades",
        ativo: true,
        ordem: 4,
      });
      trackCategoria(criada.json().id);
      expect(invalida.statusCode).toBe(400);
    });
  });

  it("mapeia nome de categoria duplicado para conflito sem expor erro do banco", async () => {
    await comCatalogoAdmin(async (app, adminCookie, _clienteCookie, trackCategoria) => {
      const nome = `Categoria duplicada ${randomUUID()}`;
      const primeira = await app.inject({
        method: "POST",
        url: "/admin/categorias",
        headers: { cookie: adminCookie },
        payload: { nome },
      });
      trackCategoria(primeira.json().id);

      const duplicada = await app.inject({
        method: "POST",
        url: "/admin/categorias",
        headers: { cookie: adminCookie },
        payload: { nome },
      });

      expect(duplicada.statusCode).toBe(409);
      expect(duplicada.json()).toEqual({
        status: 409,
        error: "CONFLICT",
        message: "Já existe categoria com esses dados.",
      });
    });
  });

  it("retorna 404 para IDs válidos inexistentes em GET e PATCH", async () => {
    await comCatalogoAdmin(async (app, adminCookie) => {
      const idInexistente = randomUUID();
      const respostas = await Promise.all([
        app.inject({
          method: "GET",
          url: `/admin/categorias/${idInexistente}`,
          headers: { cookie: adminCookie },
        }),
        app.inject({
          method: "PATCH",
          url: `/admin/categorias/${idInexistente}`,
          headers: { cookie: adminCookie },
          payload: { nome: "Não existe" },
        }),
        app.inject({
          method: "GET",
          url: `/admin/itens/${idInexistente}`,
          headers: { cookie: adminCookie },
        }),
        app.inject({
          method: "PATCH",
          url: `/admin/itens/${idInexistente}`,
          headers: { cookie: adminCookie },
          payload: { nome: "Não existe" },
        }),
      ]);

      expect(respostas.map((resposta) => resposta.statusCode)).toEqual([
        404, 404, 404, 404,
      ]);
      for (const resposta of respostas) {
        expect(resposta.json()).toEqual({
          status: 404,
          error: "NOT_FOUND",
          message: "Recurso não encontrado.",
        });
      }
    });
  });

  it("edita, ativa e desativa categorias; lista inativas só na administração", async () => {
    await comCatalogoAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria) => {
        const categoria = await app.prisma.categoria.create({
          data: { nome: `Categoria gerenciada ${randomUUID()}`, ativo: false },
          select: { id: true },
        });
        trackCategoria(categoria.id);

        const editada = await app.inject({
          method: "PATCH",
          url: `/admin/categorias/${categoria.id}`,
          headers: { cookie: adminCookie },
          payload: { nome: "Categoria renomeada", descricao: "Editada", ordem: 3 },
        });
        const listagemAdminInativa = await app.inject({
          method: "GET",
          url: "/admin/categorias",
          headers: { cookie: adminCookie },
        });
        const ativada = await app.inject({
          method: "PATCH",
          url: `/admin/categorias/${categoria.id}`,
          headers: { cookie: adminCookie },
          payload: { ativo: true },
        });
        const listagemAdmin = await app.inject({
          method: "GET",
          url: "/admin/categorias",
          headers: { cookie: adminCookie },
        });
        const listagemPublicaAtiva = await app.inject({
          method: "GET",
          url: "/categorias",
        });
        const desativada = await app.inject({
          method: "PATCH",
          url: `/admin/categorias/${categoria.id}`,
          headers: { cookie: adminCookie },
          payload: { ativo: false },
        });
        const listagemPublicaDepois = await app.inject({
          method: "GET",
          url: "/categorias",
        });
        const detalhe = await app.inject({
          method: "GET",
          url: `/admin/categorias/${categoria.id}`,
          headers: { cookie: adminCookie },
        });

        expect(editada.statusCode).toBe(200);
        expect(editada.json()).toMatchObject({
          nome: "Categoria renomeada",
          descricao: "Editada",
          ordem: 3,
          ativo: false,
        });
        expect(listagemAdminInativa.json()).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: categoria.id, ativo: false })]),
        );
        expect(ativada.json().ativo).toBe(true);
        expect(listagemAdmin.json()).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: categoria.id, ativo: true })]),
        );
        expect(listagemPublicaAtiva.json()).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: categoria.id })]),
        );
        expect(desativada.json().ativo).toBe(false);
        expect(listagemPublicaDepois.json()).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ id: categoria.id })]),
        );
        expect(detalhe.statusCode).toBe(200);
        expect(detalhe.json().ativo).toBe(false);
      },
    );
  });

  it("cria item com preço monetário e JSON válido sem expor adicionais publicamente", async () => {
    await comCatalogoAdmin(async (app, adminCookie, _clienteCookie, trackCategoria, trackItem) => {
      const categoria = await criarCategoriaNoBanco(app);
      trackCategoria(categoria.id);
      const payload = {
        categoriaId: categoria.id,
        nome: `Item administrado ${randomUUID()}`,
        descricao: "Descrição do produto",
        preco: 19.9,
        imagemUrl: "https://example.test/item.jpg",
        ordem: 2,
        adicionais: [{ nome: "Cheddar", preco: 2.5 }],
      };

      const criado = await app.inject({
        method: "POST",
        url: "/admin/itens",
        headers: { cookie: adminCookie },
        payload,
      });
      if (criado.statusCode === 201) {
        trackItem(criado.json().id);
      }

      const publico = criado.statusCode === 201
        ? await app.inject({ method: "GET", url: `/itens/${criado.json().id}` })
        : undefined;

      expect(criado.statusCode).toBe(201);
      expect(criado.json()).toMatchObject({
        id: expect.any(String),
        categoriaId: categoria.id,
        nome: payload.nome,
        descricao: payload.descricao,
        preco: 19.9,
        imagemUrl: payload.imagemUrl,
        ativo: true,
        ordem: 2,
        adicionais: payload.adicionais,
      });
      expect(publico?.statusCode).toBe(200);
      expect(publico?.body).not.toContain("adicionais");
      expect(publico?.body).not.toContain("ativo");
    });
  });

  it("rejeita preço negativo, preço com fração inválida e categoria inexistente", async () => {
    await comCatalogoAdmin(async (app, adminCookie, _clienteCookie, trackCategoria) => {
      const categoria = await criarCategoriaNoBanco(app);
      trackCategoria(categoria.id);
      const base = {
        categoriaId: categoria.id,
        nome: `Item inválido ${randomUUID()}`,
        preco: 10,
      };
      const precoNegativo = await app.inject({
        method: "POST",
        url: "/admin/itens",
        headers: { cookie: adminCookie },
        payload: { ...base, preco: -1 },
      });
      const casasDecimais = await app.inject({
        method: "POST",
        url: "/admin/itens",
        headers: { cookie: adminCookie },
        payload: { ...base, preco: 1.234 },
      });
      const categoriaAusente = await app.inject({
        method: "POST",
        url: "/admin/itens",
        headers: { cookie: adminCookie },
        payload: { ...base, categoriaId: randomUUID() },
      });
      const imagemInvalida = await app.inject({
        method: "POST",
        url: "/admin/itens",
        headers: { cookie: adminCookie },
        payload: { ...base, imagemUrl: "javascript:alert(1)" },
      });

      expect(precoNegativo.statusCode).toBe(400);
      expect(casasDecimais.statusCode).toBe(400);
      expect(categoriaAusente.statusCode).toBe(400);
      expect(imagemInvalida.statusCode).toBe(400);
      expect(categoriaAusente.json()).toMatchObject({
        status: 400,
        error: "VALIDATION_ERROR",
      });
    });
  });

  it("rejeita nome de item duplicado na mesma categoria", async () => {
    await comCatalogoAdmin(async (app, adminCookie, _clienteCookie, trackCategoria, trackItem) => {
      const categoria = await criarCategoriaNoBanco(app);
      trackCategoria(categoria.id);
      const nome = `Item único ${randomUUID()}`;
      const primeiro = await app.inject({
        method: "POST",
        url: "/admin/itens",
        headers: { cookie: adminCookie },
        payload: { categoriaId: categoria.id, nome, preco: 10 },
      });
      trackItem(primeiro.json().id);
      const duplicado = await app.inject({
        method: "POST",
        url: "/admin/itens",
        headers: { cookie: adminCookie },
        payload: { categoriaId: categoria.id, nome, preco: 12 },
      });

      expect(primeiro.statusCode).toBe(201);
      expect(duplicado.statusCode).toBe(409);
      expect(duplicado.body).not.toContain("P2002");
    });
  });

  it("rejeita nome duplicado ao editar item na mesma categoria", async () => {
    await comCatalogoAdmin(async (app, adminCookie, _clienteCookie, trackCategoria, trackItem) => {
      const categoria = await criarCategoriaNoBanco(app);
      trackCategoria(categoria.id);
      const nome = `Item de edição duplicada ${randomUUID()}`;
      const primeiro = await app.prisma.item.create({
        data: { categoriaId: categoria.id, nome, preco: 10 },
        select: { id: true },
      });
      const segundo = await app.prisma.item.create({
        data: {
          categoriaId: categoria.id,
          nome: `Outro item ${randomUUID()}`,
          preco: 12,
        },
        select: { id: true },
      });
      trackItem(primeiro.id);
      trackItem(segundo.id);

      const resposta = await app.inject({
        method: "PATCH",
        url: `/admin/itens/${segundo.id}`,
        headers: { cookie: adminCookie },
        payload: { nome },
      });

      expect(resposta.statusCode).toBe(409);
      expect(resposta.body).not.toContain("P2002");
    });
  });

  it("edita item, altera categoria e estado; lista inativos para ADMIN", async () => {
    await comCatalogoAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria, trackItem) => {
        const categoriaOriginal = await criarCategoriaNoBanco(app);
        const categoriaNova = await criarCategoriaNoBanco(app);
        trackCategoria(categoriaOriginal.id);
        trackCategoria(categoriaNova.id);
        const item = await app.prisma.item.create({
          data: {
            categoriaId: categoriaOriginal.id,
            nome: `Item editável ${randomUUID()}`,
            preco: 10,
            ativo: false,
          },
          select: { id: true },
        });
        trackItem(item.id);

        const editado = await app.inject({
          method: "PATCH",
          url: `/admin/itens/${item.id}`,
          headers: { cookie: adminCookie },
          payload: {
            categoriaId: categoriaNova.id,
            nome: "Item atualizado",
            preco: 25.75,
            descricao: "Nova descrição",
          },
        });
        const ativado = await app.inject({
          method: "PATCH",
          url: `/admin/itens/${item.id}`,
          headers: { cookie: adminCookie },
          payload: { ativo: true },
        });
        const desativado = await app.inject({
          method: "PATCH",
          url: `/admin/itens/${item.id}`,
          headers: { cookie: adminCookie },
          payload: { ativo: false },
        });
        const listagemAdmin = await app.inject({
          method: "GET",
          url: "/admin/itens",
          headers: { cookie: adminCookie },
        });
        const listagemPublica = await app.inject({
          method: "GET",
          url: `/itens?categoriaId=${categoriaNova.id}`,
        });
        const detalheAdmin = await app.inject({
          method: "GET",
          url: `/admin/itens/${item.id}`,
          headers: { cookie: adminCookie },
        });

        expect(editado.statusCode).toBe(200);
        expect(editado.json()).toMatchObject({
          categoriaId: categoriaNova.id,
          nome: "Item atualizado",
          preco: 25.75,
          descricao: "Nova descrição",
          ativo: false,
        });
        expect(ativado.json().ativo).toBe(true);
        expect(desativado.json().ativo).toBe(false);
        expect(listagemAdmin.json()).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: item.id, ativo: false })]),
        );
        expect(listagemPublica.json()).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ id: item.id })]),
        );
        expect(detalheAdmin.statusCode).toBe(200);
        expect(detalheAdmin.json().ativo).toBe(false);
      },
    );
  });

  it("rejeita campos desconhecidos, atualização vazia e ID inválido", async () => {
    await comCatalogoAdmin(async (app, adminCookie) => {
      const desconhecido = await app.inject({
        method: "POST",
        url: "/admin/categorias",
        headers: { cookie: adminCookie },
        payload: { nome: "Categoria válida", tipo: "ADMIN" },
      });
      const vazio = await app.inject({
        method: "PATCH",
        url: `/admin/categorias/${randomUUID()}`,
        headers: { cookie: adminCookie },
        payload: {},
      });
      const idInvalido = await app.inject({
        method: "GET",
        url: "/admin/itens/nao-uuid",
        headers: { cookie: adminCookie },
      });

      expect(desconhecido.statusCode).toBe(400);
      expect(vazio.statusCode).toBe(400);
      expect(idInvalido.statusCode).toBe(400);
    });
  });

  it("rejeita campos desconhecidos no cadastro de item", async () => {
    await comCatalogoAdmin(async (app, adminCookie, _clienteCookie, trackCategoria) => {
      const categoria = await criarCategoriaNoBanco(app);
      trackCategoria(categoria.id);
      const resposta = await app.inject({
        method: "POST",
        url: "/admin/itens",
        headers: { cookie: adminCookie },
        payload: {
          categoriaId: categoria.id,
          nome: "Item com campo não permitido",
          preco: 10,
          papel: "ADMIN",
        },
      });

      expect(resposta.statusCode).toBe(400);
    });
  });

  it("documenta no OpenAPI todos os endpoints administrativos protegidos", async () => {
    await comCatalogoAdmin(async (app) => {
      const resposta = await app.inject({
        method: "GET",
        url: "/reference/openapi.json",
      });
      const documento = resposta.json();
      const caminhos = documento.paths as Record<
        string,
        Record<string, { security?: Array<Record<string, string[]>> }>
      >;

      expect(resposta.statusCode).toBe(200);
      for (const [caminho, metodos] of Object.entries({
        "/admin/categorias": ["get", "post"],
        "/admin/categorias/{id}": ["get", "patch"],
        "/admin/itens": ["get", "post"],
        "/admin/itens/{id}": ["get", "patch"],
      })) {
        for (const metodo of metodos) {
          expect(caminhos[caminho]?.[metodo]).toBeDefined();
          expect(caminhos[caminho]?.[metodo]?.security).toEqual([
            { sessionCookie: [] },
          ]);
        }
      }
    });
  });
});
