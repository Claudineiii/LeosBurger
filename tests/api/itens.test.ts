import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";

type DadosItemTeste = {
  nome: string;
  ordem: number;
  ativo?: boolean;
  descricao?: string | null;
  imagemUrl?: string | null;
  preco?: number;
};

async function executarComBancoDeTeste(
  teste: (
    app: FastifyInstance,
    criarCategoria: (ordem?: number) => Promise<{ id: string }>,
    criarItem: (
      categoriaId: string,
      dados: DadosItemTeste,
    ) => Promise<{ id: string; nome: string }>,
  ) => Promise<void>,
) {
  const app = criarAplicacao();
  const categoriaIds: string[] = [];
  const itemIds: string[] = [];

  try {
    await app.ready();

    const criarCategoria = async (ordem = 0) => {
      const categoria = await app.prisma.categoria.create({
        data: {
          nome: `Sprint 3 ${randomUUID()}`,
          ordem,
        },
        select: { id: true },
      });
      categoriaIds.push(categoria.id);
      return categoria;
    };

    const criarItem = async (categoriaId: string, dados: DadosItemTeste) => {
      const item = await app.prisma.item.create({
        data: {
          categoriaId,
          nome: dados.nome,
          ordem: dados.ordem,
          ativo: dados.ativo ?? true,
          descricao: dados.descricao ?? null,
          imagemUrl: dados.imagemUrl ?? null,
          preco: dados.preco ?? 12.5,
        },
        select: { id: true, nome: true },
      });
      itemIds.push(item.id);
      return item;
    };

    await teste(app, criarCategoria, criarItem);
  } finally {
    if (itemIds.length > 0) {
      await app.prisma.item.deleteMany({
        where: { id: { in: itemIds } },
      });
    }

    if (categoriaIds.length > 0) {
      await app.prisma.categoria.deleteMany({
        where: { id: { in: categoriaIds } },
      });
    }

    await app.close();
  }
}

describe("rotas de itens", () => {
  it("retorna lista vazia quando a categoria não tem itens ativos", async () => {
    await executarComBancoDeTeste(async (app, criarCategoria) => {
      const categoria = await criarCategoria();
      const resposta = await app.inject({
        method: "GET",
        url: `/itens?categoriaId=${categoria.id}`,
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual([]);
    });
  });

  describe("GET /itens/:id", () => {
    it("retorna o item ativo com preço numérico e somente campos públicos", async () => {
      await executarComBancoDeTeste(async (app, criarCategoria, criarItem) => {
        const categoria = await criarCategoria();
        const item = await criarItem(categoria.id, {
          nome: `Detalhe ${randomUUID()}`,
          ordem: 2,
          descricao: "Descrição do item",
          imagemUrl: "https://example.com/detalhe.png",
          preco: 23.45,
        });

        const resposta = await app.inject({
          method: "GET",
          url: `/itens/${item.id}`,
        });
        const corpo = resposta.json();

        expect(resposta.statusCode).toBe(200);
        expect(corpo).toEqual({
          id: item.id,
          categoriaId: categoria.id,
          nome: item.nome,
          descricao: "Descrição do item",
          preco: 23.45,
          imagemUrl: "https://example.com/detalhe.png",
          ordem: 2,
        });
        expect(typeof corpo.preco).toBe("number");
        expect(resposta.body).not.toContain("adicionais");
        expect(resposta.body).not.toContain("criadoEm");
        expect(resposta.body).not.toContain("atualizadoEm");
        expect(resposta.body).not.toContain('"ativo"');
      });
    });

    it("retorna 400 para um UUID malformado", async () => {
      await executarComBancoDeTeste(async (app) => {
        const resposta = await app.inject({
          method: "GET",
          url: "/itens/id-invalido",
        });

        expect(resposta.statusCode).toBe(400);
        expect(resposta.json()).toEqual({
          status: 400,
          error: "VALIDATION_ERROR",
          message: "Os dados da requisição são inválidos.",
          details: [
            {
              field: "/id",
              message: "id deve ser um UUID válido.",
            },
          ],
        });
      });
    });

    it("retorna 404 para um UUID válido sem item correspondente", async () => {
      await executarComBancoDeTeste(async (app) => {
        const resposta = await app.inject({
          method: "GET",
          url: `/itens/${randomUUID()}`,
        });

        expect(resposta.statusCode).toBe(404);
        expect(resposta.json()).toEqual({
          status: 404,
          error: "NOT_FOUND",
          message: "Recurso não encontrado.",
        });
      });
    });

    it("retorna o mesmo 404 para um item inativo", async () => {
      await executarComBancoDeTeste(async (app, criarCategoria, criarItem) => {
        const categoria = await criarCategoria();
        const item = await criarItem(categoria.id, {
          nome: `Inativo ${randomUUID()}`,
          ordem: 1,
          ativo: false,
        });

        const resposta = await app.inject({
          method: "GET",
          url: `/itens/${item.id}`,
        });

        expect(resposta.statusCode).toBe(404);
        expect(resposta.json()).toEqual({
          status: 404,
          error: "NOT_FOUND",
          message: "Recurso não encontrado.",
        });
        expect(resposta.body).not.toContain(item.id);
      });
    });
  });

  it("lista itens ativos, exclui inativos e retorna somente campos públicos", async () => {
    await executarComBancoDeTeste(async (app, criarCategoria, criarItem) => {
      const categoria = await criarCategoria();
      const itemAtivo = await criarItem(categoria.id, {
        nome: `Ativo ${randomUUID()}`,
        ordem: 1,
        descricao: "Descrição pública",
        imagemUrl: "https://example.com/item.png",
        preco: 15.75,
      });
      const itemInativo = await criarItem(categoria.id, {
        nome: `Inativo ${randomUUID()}`,
        ordem: 2,
        ativo: false,
      });

      const resposta = await app.inject({ method: "GET", url: "/itens" });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual(
        expect.arrayContaining([
          {
            id: itemAtivo.id,
            categoriaId: categoria.id,
            nome: itemAtivo.nome,
            descricao: "Descrição pública",
            preco: 15.75,
            imagemUrl: "https://example.com/item.png",
            ordem: 1,
          },
        ]),
      );
      expect(resposta.body).not.toContain(itemInativo.id);
      expect(resposta.body).not.toContain("adicionais");
      expect(resposta.body).not.toContain("criadoEm");
      expect(resposta.body).not.toContain("atualizadoEm");
      expect(resposta.body).not.toContain('"ativo"');
    });
  });

  it("filtra itens pela categoria informada", async () => {
    await executarComBancoDeTeste(async (app, criarCategoria, criarItem) => {
      const categoriaFiltrada = await criarCategoria();
      const outraCategoria = await criarCategoria();
      const itemFiltrado = await criarItem(categoriaFiltrada.id, {
        nome: `Filtrado ${randomUUID()}`,
        ordem: 0,
      });
      await criarItem(outraCategoria.id, {
        nome: `Outra categoria ${randomUUID()}`,
        ordem: 0,
      });

      const resposta = await app.inject({
        method: "GET",
        url: `/itens?categoriaId=${categoriaFiltrada.id}`,
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual([
        expect.objectContaining({
          id: itemFiltrado.id,
          categoriaId: categoriaFiltrada.id,
        }),
      ]);
    });
  });

  it("retorna 400 quando categoriaId não é um UUID válido", async () => {
    await executarComBancoDeTeste(async (app) => {
      const resposta = await app.inject({
        method: "GET",
        url: "/itens?categoriaId=invalido",
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.json()).toEqual({
        status: 400,
        error: "VALIDATION_ERROR",
        message: "Os dados da requisição são inválidos.",
        details: [
          {
            field: "/categoriaId",
            message: "categoriaId deve ser um UUID válido.",
          },
        ],
      });
    });
  });

  it("ordena os itens por ordem e nome de forma determinística", async () => {
    await executarComBancoDeTeste(async (app, criarCategoria, criarItem) => {
      const categoria = await criarCategoria();
      await criarItem(categoria.id, {
        nome: "Produto Z",
        ordem: 1,
      });
      await criarItem(categoria.id, {
        nome: "Produto B",
        ordem: 0,
      });
      await criarItem(categoria.id, {
        nome: "Produto A",
        ordem: 1,
      });

      const resposta = await app.inject({
        method: "GET",
        url: `/itens?categoriaId=${categoria.id}`,
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json().map((item: { nome: string }) => item.nome)).toEqual([
        "Produto B",
        "Produto A",
        "Produto Z",
      ]);
    });
  });
});
