import { describe, expect, it } from "vitest";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import { criarAplicacao } from "../../src/app.js";

function criarAplicacaoComRotasDeTeste() {
  const app = criarAplicacao();

  app.register(async (testApp) => {
    const routes = testApp.withTypeProvider<ZodTypeProvider>();

    routes.get(
      "/_test/validacao",
      {
        schema: {
          querystring: z.object({
            nome: z.string().min(3),
          }),
        },
      },
      async (request) => ({ nome: request.query.nome }),
    );

    routes.get(
      "/_test/serializacao",
      {
        schema: {
          response: {
            200: z.object({ valor: z.string() }),
          },
        },
      },
      async () => JSON.parse('{"valor":123}'),
    );

    routes.get("/_test/erro-interno", async () => {
      throw new Error("detalhe interno sigiloso");
    });
  });

  return app;
}

describe("tratamento centralizado de erros", () => {
  it("retorna o formato padrão para erro de validação Zod", async () => {
    const app = criarAplicacaoComRotasDeTeste();

    try {
      const resposta = await app.inject({
        method: "GET",
        url: "/_test/validacao?nome=a",
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.json()).toEqual({
        status: 400,
        error: "VALIDATION_ERROR",
        message: "Os dados da requisição são inválidos.",
        details: [
          {
            field: "/nome",
            message: expect.any(String),
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("retorna o formato padrão para rota inexistente", async () => {
    const app = criarAplicacaoComRotasDeTeste();

    try {
      const resposta = await app.inject({
        method: "GET",
        url: "/rota-inexistente",
      });

      expect(resposta.statusCode).toBe(404);
      expect(resposta.json()).toEqual({
        status: 404,
        error: "NOT_FOUND",
        message: "Recurso não encontrado.",
      });
    } finally {
      await app.close();
    }
  });

  it("não expõe detalhes de falhas inesperadas ou de serialização", async () => {
    const app = criarAplicacaoComRotasDeTeste();

    try {
      const respostas = await Promise.all([
        app.inject({ method: "GET", url: "/_test/erro-interno" }),
        app.inject({ method: "GET", url: "/_test/serializacao" }),
      ]);

      for (const resposta of respostas) {
        expect(resposta.statusCode).toBe(500);
        expect(resposta.json()).toEqual({
          status: 500,
          error: "INTERNAL_SERVER_ERROR",
          message: "Ocorreu um erro interno no servidor.",
        });
        expect(resposta.body).not.toContain("sigiloso");
        expect(resposta.body).not.toContain("123");
      }
    } finally {
      await app.close();
    }
  });
});
