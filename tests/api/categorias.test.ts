import { describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";

describe("GET /categorias", () => {
  it("retorna 200 e uma lista com o formato público das categorias", async () => {
    const app = criarAplicacao();

    try {
      const resposta = await app.inject({
        method: "GET",
        url: "/categorias",
      });
      const categorias: unknown = resposta.json();

      expect(resposta.statusCode).toBe(200);
      expect(Array.isArray(categorias)).toBe(true);

      if (Array.isArray(categorias)) {
        for (const categoria of categorias) {
          expect(categoria).toEqual(
            expect.objectContaining({
              id: expect.any(String),
              nome: expect.any(String),
              ordem: expect.any(Number),
            }),
          );
          expect(
            categoria.descricao === null ||
              typeof categoria.descricao === "string",
          ).toBe(true);
        }
      }
    } finally {
      await app.close();
    }
  });
});
