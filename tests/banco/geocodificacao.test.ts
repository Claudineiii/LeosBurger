import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  calcularChaveCacheEndereco,
  GeocodificacaoService,
} from "../../src/services/geocodificacao.js";
import type {
  CandidatoGeocodificado,
  EnderecoParaGeocodificacao,
  Geocodificador,
} from "../../src/providers/geoapify.js";

const prisma = new PrismaClient();
const prismaSegundaInstancia = new PrismaClient();
const chaveHmac = "chave-de-cache-geoapify-com-32-bytes";

const endereco = (sufixo: string): EnderecoParaGeocodificacao => ({
  cep: "13010000",
  logradouro: `Rua Cache ${sufixo}`,
  numero: "123",
  bairro: "Centro",
  cidade: "Campinas",
  estado: "SP",
});

const candidato: CandidatoGeocodificado = {
  latitude: -22.9,
  longitude: -47.06,
  tipoResultado: "building",
  tipoCorrespondencia: "full_match",
  confianca: 0.99,
  numero: "123",
  logradouro: "Rua Geocodificada",
  bairro: "Centro",
  cep: "13010000",
  cidade: "Campinas",
  estado: "São Paulo",
  codigoEstado: "BR-SP",
  codigoPais: "br",
};

type ControleSalvo = {
  diaUtc: Date;
  reservasDia: number;
  ultimaReservaEm: Date | null;
};

async function comControleRestaurado(
  executar: (controleOriginal: ControleSalvo) => Promise<void>,
) {
  const controleOriginal = await prisma.controleGeoapify.findUniqueOrThrow({
    where: { id: 1 },
    select: {
      diaUtc: true,
      reservasDia: true,
      ultimaReservaEm: true,
    },
  });

  try {
    await executar(controleOriginal);
  } finally {
    await prisma.controleGeoapify.update({
      where: { id: 1 },
      data: controleOriginal,
    });
  }
}

async function limparCache(enderecos: EnderecoParaGeocodificacao[]) {
  const chaves = enderecos.map((valor) =>
    calcularChaveCacheEndereco(valor, chaveHmac),
  );
  await prisma.reservaCacheGeoapify.deleteMany({
    where: { chaveHmac: { in: chaves } },
  });
  await prisma.cacheGeoapify.deleteMany({
    where: { chaveHmac: { in: chaves } },
  });
}

function providerDeTeste(
  geocodificar: Geocodificador["geocodificar"],
): Geocodificador {
  return { geocodificar };
}

afterAll(async () => {
  await Promise.all([
    prisma.$disconnect(),
    prismaSegundaInstancia.$disconnect(),
  ]);
});

describe("persistência compartilhada da geocodificação", () => {
  it("reutiliza cache entre instâncias sem persistir o endereço consultado", async () => {
    const enderecoTeste = endereco(`Privado_${Date.now()}_A`);
    const providerA = vi.fn<Geocodificador["geocodificar"]>(async () => [
      candidato,
    ]);
    const providerB = vi.fn<Geocodificador["geocodificar"]>(async () => [
      candidato,
    ]);
    const chave = calcularChaveCacheEndereco(enderecoTeste, chaveHmac);

    await limparCache([enderecoTeste]);
    try {
      const primeiraInstancia = new GeocodificacaoService(
        prisma,
        providerDeTeste(providerA),
        { cacheHmacKey: chaveHmac },
      );
      const segundaInstancia = new GeocodificacaoService(
        prismaSegundaInstancia,
        providerDeTeste(providerB),
        { cacheHmacKey: chaveHmac },
      );

      const primeiroResultado =
        await primeiraInstancia.geocodificar(enderecoTeste);
      const segundoResultado =
        await segundaInstancia.geocodificar(enderecoTeste);
      const registro = await prisma.cacheGeoapify.findUniqueOrThrow({
        where: { chaveHmac: chave },
      });

      expect(primeiroResultado.origem).toBe("GEOAPIFY");
      expect(segundoResultado.origem).toBe("CACHE");
      expect(providerA).toHaveBeenCalledOnce();
      expect(providerB).not.toHaveBeenCalled();
      expect(registro.chaveHmac).not.toContain(enderecoTeste.logradouro);
      expect(JSON.stringify(registro.resultado)).not.toContain(
        enderecoTeste.logradouro,
      );
      expect(registro.expiraEm.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
      expect(registro.expiraEm.getTime()).toBeLessThan(Date.now() + 31 * 60_000);
    } finally {
      await limparCache([enderecoTeste]);
    }
  });

  it("coalesce cache misses simultâneos para o mesmo endereço entre instâncias", async () => {
    const enderecoTeste = endereco(`ConcorrenciaMesmoEndereco_${Date.now()}`);
    const provider = vi.fn<Geocodificador["geocodificar"]>(async () => {
      await new Promise<void>((resolver) => setTimeout(resolver, 100));
      return [candidato];
    });

    await limparCache([enderecoTeste]);
    await comControleRestaurado(async () => {
      try {
        const servicoA = new GeocodificacaoService(
          prisma,
          providerDeTeste(provider),
          { cacheHmacKey: chaveHmac },
        );
        const servicoB = new GeocodificacaoService(
          prismaSegundaInstancia,
          providerDeTeste(provider),
          { cacheHmacKey: chaveHmac },
        );

        const resultados = await Promise.all([
          servicoA.geocodificar(enderecoTeste),
          servicoB.geocodificar(enderecoTeste),
        ]);

        expect(provider).toHaveBeenCalledOnce();
        expect(resultados.map(({ origem }) => origem).sort()).toEqual([
          "CACHE",
          "GEOAPIFY",
        ]);
      } finally {
        await limparCache([enderecoTeste]);
      }
    });
  });

  it("consulta o provider novamente após a expiração do cache", async () => {
    const enderecoTeste = endereco(`Expirado_${Date.now()}`);
    const provider = vi.fn<Geocodificador["geocodificar"]>(async () => [
      candidato,
    ]);
    const chave = calcularChaveCacheEndereco(enderecoTeste, chaveHmac);
    let agora = new Date();

    await limparCache([enderecoTeste]);
    try {
      const servico = new GeocodificacaoService(
        prisma,
        providerDeTeste(provider),
        {
          cacheHmacKey: chaveHmac,
          agora: () => agora,
          duracaoCacheMs: 1_000,
        },
      );

      await servico.geocodificar(enderecoTeste);
      agora = new Date(agora.getTime() + 1_001);
      const resultado = await servico.geocodificar(enderecoTeste);

      expect(resultado.origem).toBe("GEOAPIFY");
      expect(provider).toHaveBeenCalledTimes(2);
      const cache = await prisma.cacheGeoapify.findUniqueOrThrow({
        where: { chaveHmac: chave },
      });
      expect(cache.expiraEm.getTime()).toBe(agora.getTime() + 1_000);
    } finally {
      await limparCache([enderecoTeste]);
    }
  });

  it("serializa reservas globais em instâncias diferentes", async () => {
    const enderecoA = endereco(`Concorrente_A_${Date.now()}`);
    const enderecoB = endereco(`Concorrente_B_${Date.now()}`);
    const instantesChamadas: number[] = [];
    const provider = vi.fn<Geocodificador["geocodificar"]>(async () => {
      instantesChamadas.push(Date.now());
      return [candidato];
    });

    await limparCache([enderecoA, enderecoB]);
    await comControleRestaurado(async () => {
      try {
        const servicoA = new GeocodificacaoService(
          prisma,
          providerDeTeste(provider),
          { cacheHmacKey: chaveHmac },
        );
        const servicoB = new GeocodificacaoService(
          prismaSegundaInstancia,
          providerDeTeste(provider),
          { cacheHmacKey: chaveHmac },
        );

        await Promise.all([
          servicoA.geocodificar(enderecoA),
          servicoB.geocodificar(enderecoB),
        ]);

        expect(instantesChamadas).toHaveLength(2);
        expect(Math.abs((instantesChamadas[1] ?? 0) - (instantesChamadas[0] ?? 0)))
          .toBeGreaterThanOrEqual(200);
      } finally {
        await limparCache([enderecoA, enderecoB]);
      }
    });
  });

  it("bloqueia nova consulta quando o orçamento diário está esgotado", async () => {
    const enderecoTeste = endereco(`Limite_${Date.now()}`);
    const provider = vi.fn<Geocodificador["geocodificar"]>(async () => [
      candidato,
    ]);

    await limparCache([enderecoTeste]);
    await comControleRestaurado(async () => {
      try {
        const agora = new Date();
        await prisma.controleGeoapify.update({
          where: { id: 1 },
          data: {
            diaUtc: new Date(
              Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()),
            ),
            reservasDia: 3_000,
          },
        });

        const servico = new GeocodificacaoService(
          prisma,
          providerDeTeste(provider),
          { cacheHmacKey: chaveHmac },
        );

        await expect(servico.geocodificar(enderecoTeste)).rejects.toMatchObject({
          code: "LIMITE_DIARIO",
        });
        expect(provider).not.toHaveBeenCalled();
      } finally {
        await limparCache([enderecoTeste]);
      }
    });
  });
});
