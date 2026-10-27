import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { criarAplicacao } from "../../src/app.js";

type DadosComboTeste = {
  ativo?: boolean;
  descricao?: string | null;
  imagemUrl?: string | null;
  ordem?: number;
  preco?: number;
};

async function executarComBancoDeTeste(
  teste: (
    app: FastifyInstance,
    criarCategoria: () => Promise<{ id: string }>,
    criarItem: (
      categoriaId: string,
      nome: string,
      ativo?: boolean,
    ) => Promise<{ id: string; nome: string }>,
    criarCombo: (
      nome: string,
      dados?: DadosComboTeste,
    ) => Promise<{ id: string; nome: string }>,
    adicionarItem: (
      comboId: string,
      itemId: string,
      quantidade?: number,
    ) => Promise<void>,
  ) => Promise<void>,
) {
  const app = criarAplicacao();
  const categoriaIds: string[] = [];
  const itemIds: string[] = [];
  const comboIds: string[] = [];

  try {
    await app.ready();

    const criarCategoria = async () => {
      const categoria = await app.prisma.categoria.create({
        data: {
          nome: `Sprint 5 ${randomUUID()}`,
        },
        select: { id: true },
      });
      categoriaIds.push(categoria.id);
      return categoria;
    };

    const criarItem = async (categoriaId: string, nome: string, ativo = true) => {
      const item = await app.prisma.item.create({
        data: {
          categoriaId,
          nome,
          preco: 10,
          ativo,
        },
        select: {
          id: true,
          nome: true,
        },
      });
      itemIds.push(item.id);
      return item;
    };

    const criarCombo = async (nome: string, dados: DadosComboTeste = {}) => {
      const combo = await app.prisma.combo.create({
        data: {
          nome,
          preco: dados.preco ?? 30,
          ativo: dados.ativo ?? true,
          descricao: dados.descricao ?? null,
          imagemUrl: dados.imagemUrl ?? null,
          ordem: dados.ordem ?? 0,
        },
        select: {
          id: true,
          nome: true,
        },
      });
      comboIds.push(combo.id);
      return combo;
    };

    const adicionarItem = async (comboId: string, itemId: string, quantidade = 1) => {
      await app.prisma.itemCombo.create({
        data: {
          comboId,
          itemId,
          quantidade,
        },
      });
    };

    await teste(app, criarCategoria, criarItem, criarCombo, adicionarItem);
  } finally {
    if (comboIds.length > 0) {
      await app.prisma.combo.deleteMany({
        where: { id: { in: comboIds } },
      });
    }

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

describe("GET /combos", () => {
  it("retorna combos elegíveis com composição pública e preço numérico", async () => {
    await executarComBancoDeTeste(
      async (app, criarCategoria, criarItem, criarCombo, adicionarItem) => {
        const categoria = await criarCategoria();
        const itemZ = await criarItem(categoria.id, `Componente Z ${randomUUID()}`);
        const itemA = await criarItem(categoria.id, `Componente A ${randomUUID()}`);
        const itemInativo = await criarItem(
          categoria.id,
          `Componente inativo ${randomUUID()}`,
          false,
        );
        const comboElegivel = await criarCombo(`Elegível ${randomUUID()}`, {
          descricao: "Descrição pública",
          imagemUrl: "https://example.com/combo.png",
          ordem: 2,
          preco: 42.75,
        });
        const comboInativo = await criarCombo(`Combo inativo ${randomUUID()}`, {
          ativo: false,
        });
        const comboComComponenteInativo = await criarCombo(
          `Componente indisponível ${randomUUID()}`,
        );
        const comboSemComposicao = await criarCombo(`Sem composição ${randomUUID()}`);

        await adicionarItem(comboElegivel.id, itemZ.id, 3);
        await adicionarItem(comboElegivel.id, itemA.id, 2);
        await adicionarItem(comboInativo.id, itemA.id);
        await adicionarItem(comboComComponenteInativo.id, itemA.id);
        await adicionarItem(comboComComponenteInativo.id, itemInativo.id);

        const resposta = await app.inject({ method: "GET", url: "/combos" });
        const corpo = resposta.json();
        const comboRetornado = corpo.find(
          (combo: { id: string }) => combo.id === comboElegivel.id,
        );

        expect(resposta.statusCode).toBe(200);
        expect(comboRetornado).toEqual({
          id: comboElegivel.id,
          nome: comboElegivel.nome,
          descricao: "Descrição pública",
          preco: 42.75,
          imagemUrl: "https://example.com/combo.png",
          ordem: 2,
          itens: [
            { id: itemA.id, nome: itemA.nome, quantidade: 2 },
            { id: itemZ.id, nome: itemZ.nome, quantidade: 3 },
          ],
        });
        expect(typeof comboRetornado.preco).toBe("number");
        expect(corpo.map((combo: { id: string }) => combo.id)).not.toContain(comboInativo.id);
        expect(corpo.map((combo: { id: string }) => combo.id)).not.toContain(
          comboComComponenteInativo.id,
        );
        expect(corpo.map((combo: { id: string }) => combo.id)).not.toContain(
          comboSemComposicao.id,
        );
        expect(resposta.body).not.toContain('"ativo"');
        expect(resposta.body).not.toContain("criadoEm");
        expect(resposta.body).not.toContain("atualizadoEm");
        expect(resposta.body).not.toContain("itensCombo");
      },
    );
  });

  it("retorna 200 com lista vazia quando não há combos elegíveis", async () => {
    await executarComBancoDeTeste(async (app) => {
      const buscarCombos = vi.spyOn(app.prisma.combo, "findMany").mockResolvedValue([]);

      const resposta = await app.inject({ method: "GET", url: "/combos" });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual([]);
      buscarCombos.mockRestore();
    });
  });

  it("ordena combos por ordem, nome e identificador de forma determinística", async () => {
    await executarComBancoDeTeste(
      async (app, criarCategoria, criarItem, criarCombo, adicionarItem) => {
        const categoria = await criarCategoria();
        const item = await criarItem(categoria.id, `Componente ${randomUUID()}`);
        const comboZ = await criarCombo(`Ordenação Z ${randomUUID()}`, { ordem: 1 });
        const comboA = await criarCombo(`Ordenação A ${randomUUID()}`, { ordem: 1 });
        const comboDepois = await criarCombo(`Ordenação depois ${randomUUID()}`, {
          ordem: 2,
        });

        await adicionarItem(comboZ.id, item.id);
        await adicionarItem(comboA.id, item.id);
        await adicionarItem(comboDepois.id, item.id);

        const resposta = await app.inject({ method: "GET", url: "/combos" });
        const idsDosCombosDeTeste = resposta
          .json()
          .map((combo: { id: string }) => combo.id)
          .filter((id: string) =>
            [comboA.id, comboZ.id, comboDepois.id].includes(id),
          );

        expect(resposta.statusCode).toBe(200);
        expect(idsDosCombosDeTeste).toEqual([comboA.id, comboZ.id, comboDepois.id]);
      },
    );
  });

  it("publica a resposta de sucesso e o erro interno no OpenAPI", async () => {
    await executarComBancoDeTeste(async (app) => {
      const documento = app.swagger();
      const operacao = documento.paths?.["/combos"]?.get;
      const respostas = operacao?.responses;
      const documentoSerializado = JSON.stringify(documento);

      expect(operacao?.description).toBe(
        "Lista os combos ativos com todos os componentes disponíveis.",
      );
      expect(respostas).toHaveProperty("200");
      expect(respostas).toHaveProperty("500");
      expect(documentoSerializado).toContain("quantidade");
      expect(documentoSerializado).toContain("preco");
    });
  });
});
