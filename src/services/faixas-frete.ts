import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { paraCentavos, formatarCentavos } from "./valores-monetarios.js";

export const MAXIMO_ENTREGA_KM = 6;

const distanciaSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAXIMO_ENTREGA_KM)
  .refine((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-8);

const valorSchema = z
  .number()
  .finite()
  .min(0)
  .max(99_999_999.99)
  .refine((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-8);

export const faixaFreteSchema = z
  .object({
    id: z.string().uuid().optional(),
    distanciaMinima: distanciaSchema,
    distanciaMaxima: distanciaSchema,
    valor: valorSchema,
  })
  .strict()
  .refine((faixa) => faixa.distanciaMinima < faixa.distanciaMaxima, {
    path: ["distanciaMaxima"],
    message: "A distância máxima deve ser maior que a mínima.",
  });

export const substituicaoFaixasSchema = z
  .array(faixaFreteSchema)
  .superRefine((faixas, contexto) => {
    const ids = new Set<string>();
    const ordenadas = [...faixas].sort(
      (a, b) => a.distanciaMinima - b.distanciaMinima,
    );

    for (const [indice, faixa] of faixas.entries()) {
      if (faixa.id && ids.has(faixa.id)) {
        contexto.addIssue({
          code: "custom",
          path: [indice, "id"],
          message: "O ID de cada faixa deve ser único.",
        });
      }
      if (faixa.id) {
        ids.add(faixa.id);
      }
    }

    if (ordenadas.length === 0) {
      return;
    }

    if (ordenadas[0]!.distanciaMinima !== 0) {
      contexto.addIssue({
        code: "custom",
        path: [0, "distanciaMinima"],
        message: "As faixas devem começar em 0 km.",
      });
    }

    for (let indice = 1; indice < ordenadas.length; indice += 1) {
      if (
        ordenadas[indice - 1]!.distanciaMaxima !==
        ordenadas[indice]!.distanciaMinima
      ) {
        contexto.addIssue({
          code: "custom",
          path: [indice, "distanciaMinima"],
          message: "As faixas não podem ter lacunas ou sobreposições.",
        });
      }
    }

    if (
      ordenadas[ordenadas.length - 1]!.distanciaMaxima !== MAXIMO_ENTREGA_KM
    ) {
      contexto.addIssue({
        code: "custom",
        path: [faixas.length - 1, "distanciaMaxima"],
        message: "A última faixa deve terminar em 6 km.",
      });
    }
  });

export type FaixaFreteConfigurada = z.infer<typeof faixaFreteSchema>;

export type ResultadoFrete =
  | {
      situacao: "DISPONIVEL";
      distanciaKm: number;
      valor: bigint;
      faixa: {
        id: string;
        distanciaMinima: number;
        distanciaMaxima: number;
      };
    }
  | { situacao: "INDISPONIVEL" };

export function calcularDistanciaKm(
  latitudeOrigem: number,
  longitudeOrigem: number,
  latitudeDestino: number,
  longitudeDestino: number,
): number {
  const radianos = (graus: number) => (graus * Math.PI) / 180;
  const diferencaLatitude = radianos(latitudeDestino - latitudeOrigem);
  const diferencaLongitude = radianos(longitudeDestino - longitudeOrigem);
  const parteHaversine =
    Math.sin(diferencaLatitude / 2) ** 2 +
    Math.cos(radianos(latitudeOrigem)) *
      Math.cos(radianos(latitudeDestino)) *
      Math.sin(diferencaLongitude / 2) ** 2;

  return 6_371 * 2 * Math.atan2(Math.sqrt(parteHaversine), Math.sqrt(1 - parteHaversine));
}

function coordenadasOrigemConfigurada():
  | { latitude: number; longitude: number }
  | null {
  const latitude = process.env.RESTAURANTE_LATITUDE?.trim();
  const longitude = process.env.RESTAURANTE_LONGITUDE?.trim();
  if (!latitude || !longitude) {
    return null;
  }

  const latitudeNumero = Number(latitude);
  const longitudeNumero = Number(longitude);
  if (
    !Number.isFinite(latitudeNumero) ||
    !Number.isFinite(longitudeNumero) ||
    latitudeNumero < -90 ||
    latitudeNumero > 90 ||
    longitudeNumero < -180 ||
    longitudeNumero > 180
  ) {
    return null;
  }

  return { latitude: latitudeNumero, longitude: longitudeNumero };
}

export async function substituirFaixasFrete(
  prisma: PrismaClient,
  faixasRecebidas: unknown,
) {
  const faixas = substituicaoFaixasSchema.parse(faixasRecebidas);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(711202611) IS NULL AS "lockObtained"
    `;
    const existentes = await tx.faixaFrete.findMany({
      select: { id: true },
    });
    const idsExistentes = new Set(existentes.map(({ id }) => id));
    if (faixas.some((faixa) => faixa.id && !idsExistentes.has(faixa.id))) {
      throw new Error("FAIXA_FRETE_INEXISTENTE");
    }

    await tx.faixaFrete.updateMany({
      where: { ativa: true },
      data: { ativa: false },
    });

    for (const faixa of faixas) {
      const dados = {
        distanciaMinima: new Prisma.Decimal(faixa.distanciaMinima.toFixed(2)),
        distanciaMaxima: new Prisma.Decimal(faixa.distanciaMaxima.toFixed(2)),
        valor: new Prisma.Decimal(faixa.valor.toFixed(2)),
        ativa: true,
      };
      if (faixa.id) {
        await tx.faixaFrete.update({ where: { id: faixa.id }, data: dados });
      } else {
        await tx.faixaFrete.create({ data: dados });
      }
    }

    return tx.faixaFrete.findMany({
      where: { ativa: true },
      orderBy: [{ distanciaMinima: "asc" }, { id: "asc" }],
    });
  });
}

export function serializarFaixaFrete(faixa: {
  id: string;
  distanciaMinima: Prisma.Decimal;
  distanciaMaxima: Prisma.Decimal;
  valor: Prisma.Decimal;
  ativa: boolean;
}) {
  return {
    id: faixa.id,
    distanciaMinima: faixa.distanciaMinima.toNumber(),
    distanciaMaxima: faixa.distanciaMaxima.toNumber(),
    valor: formatarCentavos(paraCentavos(faixa.valor)),
    ativa: faixa.ativa,
  };
}

export async function calcularFrete(
  prisma: Pick<PrismaClient, "faixaFrete">,
  destino: { latitude: number; longitude: number } | null,
): Promise<ResultadoFrete> {
  const origem = coordenadasOrigemConfigurada();
  if (!origem || !destino) {
    return { situacao: "INDISPONIVEL" };
  }

  const distanciaKm = calcularDistanciaKm(
    origem.latitude,
    origem.longitude,
    destino.latitude,
    destino.longitude,
  );
  if (!Number.isFinite(distanciaKm) || distanciaKm > MAXIMO_ENTREGA_KM) {
    return { situacao: "INDISPONIVEL" };
  }

  const faixas = await prisma.faixaFrete.findMany({
    where: { ativa: true },
    orderBy: [{ distanciaMinima: "asc" }, { id: "asc" }],
  });
  const validacao = substituicaoFaixasSchema.safeParse(
    faixas.map((faixa) => ({
      id: faixa.id,
      distanciaMinima: faixa.distanciaMinima.toNumber(),
      distanciaMaxima: faixa.distanciaMaxima.toNumber(),
      valor: faixa.valor.toNumber(),
    })),
  );
  if (!validacao.success) {
    return { situacao: "INDISPONIVEL" };
  }

  const faixa = faixas.find((candidata, indice) => {
    const minima = validacao.data[indice]!.distanciaMinima;
    const maxima = validacao.data[indice]!.distanciaMaxima;
    return (
      distanciaKm >= minima &&
      (distanciaKm < maxima ||
        (maxima === MAXIMO_ENTREGA_KM && distanciaKm <= maxima))
    );
  });
  if (!faixa) {
    return { situacao: "INDISPONIVEL" };
  }

  return {
    situacao: "DISPONIVEL",
    distanciaKm,
    valor: paraCentavos(faixa.valor),
    faixa: {
      id: faixa.id,
      distanciaMinima: faixa.distanciaMinima.toNumber(),
      distanciaMaxima: faixa.distanciaMaxima.toNumber(),
    },
  };
}
