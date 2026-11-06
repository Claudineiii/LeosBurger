import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  calcularChaveCacheEndereco,
  ErroGeocodificacao,
  GeocodificacaoService,
} from "../../../src/services/geocodificacao.js";
import type { Geocodificador } from "../../../src/services/contratos-geocodificacao.js";
import type { EnderecoParaGeocodificacao } from "../../../src/providers/geoapify.js";

const chaveHmac = "chave-de-cache-geoapify-com-32-bytes";

const endereco: EnderecoParaGeocodificacao = {
  cep: "13010-000",
  logradouro: "Rua Exemplo",
  numero: "123",
  bairro: "Centro",
  cidade: "Campinas",
  estado: "SP",
};

describe("cache de geocodificação", () => {
  it("gera a mesma chave HMAC para endereço normalizado equivalente", () => {
    const equivalente: EnderecoParaGeocodificacao = {
      cep: "13010000",
      logradouro: "  RUA   EXEMPLO ",
      numero: "123",
      bairro: " centro ",
      cidade: "CAMPINAS",
      estado: "sp",
    };

    expect(calcularChaveCacheEndereco(endereco, chaveHmac)).toBe(
      calcularChaveCacheEndereco(equivalente, chaveHmac),
    );
  });

  it("gera chaves diferentes para endereços diferentes", () => {
    expect(
      calcularChaveCacheEndereco(
        { ...endereco, numero: "124" },
        chaveHmac,
      ),
    ).not.toBe(calcularChaveCacheEndereco(endereco, chaveHmac));
  });

  it("rejeita chave HMAC curta sem expor o valor recebido", () => {
    expect(() => calcularChaveCacheEndereco(endereco, "curta")).toThrowError(
      new ErroGeocodificacao(
        "CONFIGURATION",
        "A chave HMAC do cache Geoapify deve conter pelo menos 32 bytes.",
      ),
    );
    expect(() => calcularChaveCacheEndereco(endereco, "segredo-curto")).not
      .toThrow("segredo-curto");
  });

  it("não chama o provider quando o PostgreSQL não permite consultar o cache", async () => {
    const falhaBanco = new Error("database unavailable");
    const prisma = {
      cacheGeoapify: {
        findUnique: vi.fn().mockRejectedValue(falhaBanco),
      },
    } as unknown as PrismaClient;
    const provider: Geocodificador = {
      geocodificar: vi.fn(async () => []),
    };
    const servico = new GeocodificacaoService(prisma, provider, {
      cacheHmacKey: chaveHmac,
    });

    await expect(servico.geocodificar(endereco)).rejects.toBe(falhaBanco);
    expect(provider.geocodificar).not.toHaveBeenCalled();
  });
});
