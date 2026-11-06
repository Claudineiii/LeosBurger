import { createHmac, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ErroGeoapify } from "../providers/geoapify.js";
import type {
  CandidatoGeocodificado,
  EnderecoParaGeocodificacao,
  Geocodificador,
} from "./contratos-geocodificacao.js";

const duracaoCacheMs = 30 * 60 * 1_000;
const intervaloMinimoMs = 250;
const limiteDiario = 3_000;
const duracaoReservaMs = 15_000;
const esperaReservaMs = 15_000;

const candidatoCacheSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    tipoResultado: z.string().optional(),
    tipoCorrespondencia: z.string().optional(),
    confianca: z.number().finite().min(0).max(1).optional(),
    numero: z.string().optional(),
    logradouro: z.string().optional(),
    bairro: z.string().optional(),
    cep: z.string().optional(),
    cidade: z.string().optional(),
    estado: z.string().optional(),
    codigoEstado: z.string().optional(),
    codigoPais: z.string().optional(),
  })
  .strict();

const candidatosCacheSchema = z.array(candidatoCacheSchema);

export type ResultadoGeocodificacao = {
  candidatos: CandidatoGeocodificado[];
  origem: "CACHE" | "GEOAPIFY";
};

export type CodigoErroGeocodificacao =
  | "CONFIGURATION"
  | "CACHE_INVALIDO"
  | "CONTROLE_INDISPONIVEL"
  | "LIMITE_DIARIO"
  | "PROVEDOR_INDISPONIVEL";

export class ErroGeocodificacao extends Error {
  constructor(
    readonly code: CodigoErroGeocodificacao,
    message: string,
  ) {
    super(message);
    this.name = "ErroGeocodificacao";
  }
}

export type GeocodificacaoServiceOptions = {
  cacheHmacKey?: string;
  agora?: () => Date;
  duracaoCacheMs?: number;
};

function normalizarTexto(valor: string): string {
  return valor
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

export function calcularChaveCacheEndereco(
  endereco: EnderecoParaGeocodificacao,
  chave: string,
): string {
  if (Buffer.byteLength(chave, "utf8") < 32) {
    throw new ErroGeocodificacao(
      "CONFIGURATION",
      "A chave HMAC do cache Geoapify deve conter pelo menos 32 bytes.",
    );
  }

  const enderecoNormalizado = JSON.stringify([
    endereco.cep.replace(/\D/g, ""),
    normalizarTexto(endereco.logradouro),
    normalizarTexto(endereco.numero),
    normalizarTexto(endereco.bairro),
    normalizarTexto(endereco.cidade),
    normalizarTexto(endereco.estado),
  ]);

  return createHmac("sha256", chave)
    .update(enderecoNormalizado, "utf8")
    .digest("hex");
}

function reduzirCandidato(candidato: CandidatoGeocodificado): Prisma.InputJsonValue {
  return {
    latitude: candidato.latitude,
    longitude: candidato.longitude,
    ...(candidato.tipoResultado !== undefined
      ? { tipoResultado: candidato.tipoResultado }
      : {}),
    ...(candidato.tipoCorrespondencia !== undefined
      ? { tipoCorrespondencia: candidato.tipoCorrespondencia }
      : {}),
    ...(candidato.confianca !== undefined
      ? { confianca: candidato.confianca }
      : {}),
    ...(candidato.numero !== undefined ? { numero: candidato.numero } : {}),
    ...(candidato.logradouro !== undefined
      ? { logradouro: candidato.logradouro }
      : {}),
    ...(candidato.bairro !== undefined ? { bairro: candidato.bairro } : {}),
    ...(candidato.cep !== undefined ? { cep: candidato.cep } : {}),
    ...(candidato.cidade !== undefined ? { cidade: candidato.cidade } : {}),
    ...(candidato.estado !== undefined ? { estado: candidato.estado } : {}),
    ...(candidato.codigoEstado !== undefined
      ? { codigoEstado: candidato.codigoEstado }
      : {}),
    ...(candidato.codigoPais !== undefined
      ? { codigoPais: candidato.codigoPais }
      : {}),
  };
}

function lerCandidatosCache(resultado: Prisma.JsonValue): CandidatoGeocodificado[] {
  const validacao = candidatosCacheSchema.safeParse(resultado);
  if (!validacao.success) {
    throw new ErroGeocodificacao(
      "CACHE_INVALIDO",
      "O cache de geocodificação contém dados inválidos.",
    );
  }

  return validacao.data.map((candidato) => ({
    latitude: candidato.latitude,
    longitude: candidato.longitude,
    ...(candidato.tipoResultado !== undefined
      ? { tipoResultado: candidato.tipoResultado }
      : {}),
    ...(candidato.tipoCorrespondencia !== undefined
      ? { tipoCorrespondencia: candidato.tipoCorrespondencia }
      : {}),
    ...(candidato.confianca !== undefined
      ? { confianca: candidato.confianca }
      : {}),
    ...(candidato.numero !== undefined ? { numero: candidato.numero } : {}),
    ...(candidato.logradouro !== undefined
      ? { logradouro: candidato.logradouro }
      : {}),
    ...(candidato.bairro !== undefined ? { bairro: candidato.bairro } : {}),
    ...(candidato.cep !== undefined ? { cep: candidato.cep } : {}),
    ...(candidato.cidade !== undefined ? { cidade: candidato.cidade } : {}),
    ...(candidato.estado !== undefined ? { estado: candidato.estado } : {}),
    ...(candidato.codigoEstado !== undefined
      ? { codigoEstado: candidato.codigoEstado }
      : {}),
    ...(candidato.codigoPais !== undefined
      ? { codigoPais: candidato.codigoPais }
      : {}),
  }));
}

export class GeocodificacaoService {
  readonly #prisma: PrismaClient;
  readonly #provider: Geocodificador;
  readonly #cacheHmacKey: string;
  readonly #agora: () => Date;
  readonly #duracaoCacheMs: number;

  constructor(
    prisma: PrismaClient,
    provider: Geocodificador,
    options: GeocodificacaoServiceOptions = {},
  ) {
    const cacheHmacKey =
      options.cacheHmacKey ?? process.env.GEOAPIFY_CACHE_HMAC_KEY;
    if (!cacheHmacKey || Buffer.byteLength(cacheHmacKey, "utf8") < 32) {
      throw new ErroGeocodificacao(
        "CONFIGURATION",
        "GEOAPIFY_CACHE_HMAC_KEY deve conter pelo menos 32 bytes.",
      );
    }

    const duracaoCache = options.duracaoCacheMs ?? duracaoCacheMs;
    if (!Number.isSafeInteger(duracaoCache) || duracaoCache <= 0) {
      throw new ErroGeocodificacao(
        "CONFIGURATION",
        "A duração do cache Geoapify deve ser um inteiro positivo.",
      );
    }

    this.#prisma = prisma;
    this.#provider = provider;
    this.#cacheHmacKey = cacheHmacKey;
    this.#agora = options.agora ?? (() => new Date());
    this.#duracaoCacheMs = duracaoCache;
  }

  async geocodificar(
    endereco: EnderecoParaGeocodificacao,
  ): Promise<ResultadoGeocodificacao> {
    const chaveHmac = calcularChaveCacheEndereco(
      endereco,
      this.#cacheHmacKey,
    );
    const cacheInicial = await this.lerCacheValido(chaveHmac);
    if (cacheInicial) {
      return { candidatos: cacheInicial, origem: "CACHE" };
    }

    const tokenReserva = randomBytes(32).toString("hex");
    const limiteEspera = Date.now() + esperaReservaMs;
    let possuiReserva = false;

    while (!possuiReserva) {
      const reserva = await this.#prisma.$queryRaw<{ chaveHmac: string }[]>`
        INSERT INTO "reservas_cache_geoapify" (
          "chave_hmac", "token_reserva", "expira_em"
        )
        VALUES (
          ${chaveHmac}, ${tokenReserva},
          clock_timestamp() + (${duracaoReservaMs} * interval '1 millisecond')
        )
        ON CONFLICT ("chave_hmac") DO UPDATE
          SET "token_reserva" = EXCLUDED."token_reserva",
              "expira_em" = EXCLUDED."expira_em"
          WHERE "reservas_cache_geoapify"."expira_em" <= clock_timestamp()
        RETURNING "chave_hmac" AS "chaveHmac"
      `;
      possuiReserva = reserva.length > 0;

      if (possuiReserva) {
        break;
      }

      const cacheConcorrente = await this.lerCacheValido(chaveHmac);
      if (cacheConcorrente) {
        return { candidatos: cacheConcorrente, origem: "CACHE" };
      }
      if (Date.now() >= limiteEspera) {
        throw new ErroGeocodificacao(
          "CONTROLE_INDISPONIVEL",
          "A consulta compartilhada de geocodificação excedeu o tempo de espera.",
        );
      }
      await new Promise<void>((resolver) => setTimeout(resolver, 50));
    }

    try {
      const cacheAposReserva = await this.lerCacheValido(chaveHmac);
      if (cacheAposReserva) {
        return { candidatos: cacheAposReserva, origem: "CACHE" };
      }

      await this.reservarQuota();
      let candidatos: CandidatoGeocodificado[];
      try {
        candidatos = await this.#provider.geocodificar(endereco);
      } catch (erro) {
        if (erro instanceof ErroGeoapify) {
          throw new ErroGeocodificacao(
            erro.code === "CONFIGURATION"
              ? "CONFIGURATION"
              : "PROVEDOR_INDISPONIVEL",
            "Não foi possível concluir a consulta de geocodificação.",
          );
        }
        throw erro;
      }
      const resultado: Prisma.InputJsonValue = candidatos.map(reduzirCandidato);
      const agora = this.#agora();

      await this.#prisma.cacheGeoapify.upsert({
        where: { chaveHmac },
        create: {
          chaveHmac,
          resultado,
          expiraEm: new Date(agora.getTime() + this.#duracaoCacheMs),
        },
        update: {
          resultado,
          expiraEm: new Date(agora.getTime() + this.#duracaoCacheMs),
        },
      });

      return { candidatos, origem: "GEOAPIFY" };
    } finally {
      await this.#prisma.reservaCacheGeoapify.deleteMany({
        where: { chaveHmac, tokenReserva },
      });
    }
  }

  private async lerCacheValido(
    chaveHmac: string,
  ): Promise<CandidatoGeocodificado[] | null> {
    const cache = await this.#prisma.cacheGeoapify.findUnique({
      where: { chaveHmac },
    });
    if (!cache || cache.expiraEm <= this.#agora()) {
      return null;
    }

    return lerCandidatosCache(cache.resultado);
  }

  private async reservarQuota(): Promise<void> {
    await this.#prisma.$transaction(
      async (tx) => {
        const [controle] = await tx.$queryRaw<
          {
            diaUtc: string;
            reservasDia: number;
            ultimaReservaEm: Date | null;
            agora: Date;
          }[]
        >`
          SELECT
            to_char("dia_utc", 'YYYY-MM-DD') AS "diaUtc",
            "reservas_dia" AS "reservasDia",
            "ultima_reserva_em" AS "ultimaReservaEm",
            clock_timestamp() AS "agora"
          FROM "controle_geoapify"
          WHERE "id" = 1
          FOR UPDATE
        `;

        if (!controle) {
          throw new ErroGeocodificacao(
            "CONTROLE_INDISPONIVEL",
            "O controle compartilhado de uso do Geoapify não está disponível.",
          );
        }

        const reservasNoDia = (diaUtc: string) =>
          controle.diaUtc === diaUtc ? controle.reservasDia : 0;
        const diaInicial = controle.agora.toISOString().slice(0, 10);
        if (reservasNoDia(diaInicial) >= limiteDiario) {
          throw new ErroGeocodificacao(
            "LIMITE_DIARIO",
            "O limite diário de consultas Geoapify foi atingido.",
          );
        }

        if (controle.ultimaReservaEm) {
          const intervaloDesdeUltima =
            controle.agora.getTime() - controle.ultimaReservaEm.getTime();
          const esperaMs = intervaloMinimoMs - intervaloDesdeUltima;
          if (esperaMs > 0) {
            await new Promise<void>((resolver) => {
              setTimeout(resolver, esperaMs);
            });
          }
        }

        const [relogio] = await tx.$queryRaw<
          { diaUtc: string; agora: Date }[]
        >`
          SELECT
            to_char((clock_timestamp() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS "diaUtc",
            clock_timestamp() AS "agora"
        `;

        if (!relogio) {
          throw new ErroGeocodificacao(
            "CONTROLE_INDISPONIVEL",
            "Não foi possível reservar uma consulta Geoapify.",
          );
        }

        const reservasAtuais = reservasNoDia(relogio.diaUtc);
        if (reservasAtuais >= limiteDiario) {
          throw new ErroGeocodificacao(
            "LIMITE_DIARIO",
            "O limite diário de consultas Geoapify foi atingido.",
          );
        }

        await tx.controleGeoapify.update({
          where: { id: 1 },
          data: {
            diaUtc: new Date(`${relogio.diaUtc}T00:00:00.000Z`),
            reservasDia: reservasAtuais + 1,
            ultimaReservaEm: relogio.agora,
          },
        });
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }
}
