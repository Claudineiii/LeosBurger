import { describe, it, expect, beforeAll } from "vitest";
import { criarAplicacao } from "../../src/app.js";

describe("Integração com Prisma", () => {
  it("consegue consultar o banco de dados", async () => {
    const app = criarAplicacao();

    await app.ready();

    try {
      const quantidade = await app.prisma.categoria.count();

      expect(quantidade).toBeGreaterThanOrEqual(0);
    } finally {
      await app.close();
    }
  });
});
