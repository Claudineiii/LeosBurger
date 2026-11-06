import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";

const origemValida = "http://localhost:5173";
const endereco = {
  cep: "13010-000",
  logradouro: `Rua de Teste ${randomUUID()}`,
  numero: "123",
  bairro: "Centro",
  cidade: "Campinas",
  estado: "sp",
};

const tokensCriados = new Set<string>();

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function comApiGeoapifyDesativada(
  teste: (app: ReturnType<typeof criarAplicacao>) => Promise<void>,
) {
  const apiKeyAnterior = process.env.GEOAPIFY_API_KEY;
  const cacheKeyAnterior = process.env.GEOAPIFY_CACHE_HMAC_KEY;
  process.env.GEOAPIFY_API_KEY = "";
  process.env.GEOAPIFY_CACHE_HMAC_KEY = "";
  const app = criarAplicacao();

  try {
    await app.ready();
    await teste(app);
  } finally {
    try {
      if (tokensCriados.size > 0) {
        await app.prisma.referenciaEndereco.deleteMany({
          where: { tokenHash: { in: [...tokensCriados] } },
        });
        tokensCriados.clear();
      }
      await app.close();
    } finally {
      if (apiKeyAnterior === undefined) {
        delete process.env.GEOAPIFY_API_KEY;
      } else {
        process.env.GEOAPIFY_API_KEY = apiKeyAnterior;
      }

      if (cacheKeyAnterior === undefined) {
        delete process.env.GEOAPIFY_CACHE_HMAC_KEY;
      } else {
        process.env.GEOAPIFY_CACHE_HMAC_KEY = cacheKeyAnterior;
      }
    }
  }
}

afterAll(() => {
  tokensCriados.clear();
});

describe("POST /checkout/endereco-visitante/validar", () => {
  it("emite referência pendente sem conta quando Geoapify não está configurado", async () => {
    await comApiGeoapifyDesativada(async (app) => {
      const resposta = await app.inject({
        method: "POST",
        url: "/checkout/endereco-visitante/validar",
        headers: { origin: origemValida },
        payload: {
          ...endereco,
          complemento: "Casa 2",
          referencia: "Portão azul",
        },
      });

      expect(resposta.statusCode).toBe(201);
      expect(resposta.json()).toMatchObject({
        situacao: "PENDENTE",
      });
      expect(resposta.json()).not.toHaveProperty("motivoPendencia");
      expect(resposta.json().referenciaEndereco).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(resposta.json().expiraEm).toBeTypeOf("string");
      expect(resposta.json()).not.toHaveProperty("latitude");
      expect(resposta.json()).not.toHaveProperty("longitude");
      expect(JSON.stringify(resposta.json())).not.toContain(endereco.logradouro);

      const tokenHash = hashToken(resposta.json().referenciaEndereco);
      tokensCriados.add(tokenHash);
      const registro = await app.prisma.referenciaEndereco.findUniqueOrThrow({
        where: { tokenHash },
      });
      expect(registro.tokenHash).toBe(tokenHash);
      expect(registro.situacao).toBe("PENDENTE");
      expect(registro.complemento).toBe("Casa 2");
      expect(registro.referencia).toBe("Portão azul");
      expect(registro.latitude).toBeNull();
      expect(registro.longitude).toBeNull();
    });
  });

  it("rejeita coordenadas e campos fora do contrato", async () => {
    await comApiGeoapifyDesativada(async (app) => {
      const resposta = await app.inject({
        method: "POST",
        url: "/checkout/endereco-visitante/validar",
        headers: { origin: origemValida },
        payload: { ...endereco, latitude: -22.9, longitude: -47.06 },
      });

      expect(resposta.statusCode).toBe(400);
      expect(
        await app.prisma.referenciaEndereco.count({
          where: { logradouro: endereco.logradouro },
        }),
      ).toBe(0);
    });
  });
});
