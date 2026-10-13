import { describe, it, expect } from "vitest";
import { criarAplicacao } from "../../src/app.js";

describe("GET /health", () => {
  it("retorna 200 e confirma que a API está funcionando", async () => {
    const app = criarAplicacao();

    try {
      const resposta = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({
        status: "ok",
        projeto: "LEOSBurger",
      });
    } finally {
      await app.close();
    }
  });
});
