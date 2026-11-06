import { createHash, randomBytes } from "node:crypto";
import {
  MotivoPendenciaEndereco,
  Prisma,
  StatusReferenciaEndereco,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

export const validadeReferenciaEnderecoMs = 30 * 60 * 1_000;

const enderecoReferenciaSchema = z.discriminatedUnion("situacao", [
  z
    .object({
      cep: z.string().regex(/^\d{8}$/),
      logradouro: z.string().trim().min(1).max(150),
      numero: z.string().trim().min(1).max(20),
      complemento: z.string().trim().max(100).nullable().optional(),
      bairro: z.string().trim().min(1).max(100),
      cidade: z.string().trim().min(1).max(100),
      estado: z.string().regex(/^[A-Z]{2}$/),
      referencia: z.string().trim().max(150).nullable().optional(),
      situacao: z.literal(StatusReferenciaEndereco.CONFIRMADO),
      motivoPendencia: z.null(),
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180),
    })
    .strict(),
  z
    .object({
      cep: z.string().regex(/^\d{8}$/),
      logradouro: z.string().trim().min(1).max(150),
      numero: z.string().trim().min(1).max(20),
      complemento: z.string().trim().max(100).nullable().optional(),
      bairro: z.string().trim().min(1).max(100),
      cidade: z.string().trim().min(1).max(100),
      estado: z.string().regex(/^[A-Z]{2}$/),
      referencia: z.string().trim().max(150).nullable().optional(),
      situacao: z.literal(StatusReferenciaEndereco.PENDENTE),
      motivoPendencia: z.nativeEnum(MotivoPendenciaEndereco),
      latitude: z.null(),
      longitude: z.null(),
    })
    .strict(),
]);

export type DadosEnderecoReferencia = z.infer<
  typeof enderecoReferenciaSchema
>;

export type ReferenciaEnderecoEmitida = {
  token: string;
  expiraEm: Date;
};

export type ReferenciaEnderecoServiceOptions = {
  agora?: () => Date;
};

export type BuscarReferenciaEnderecoOptions = {
  limparExpirada?: boolean;
};

export function hashTokenReferenciaEndereco(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class ReferenciaEnderecoService {
  readonly #prisma: Pick<PrismaClient, "referenciaEndereco">;
  readonly #agora: () => Date;

  constructor(
    prisma: Pick<PrismaClient, "referenciaEndereco">,
    options: ReferenciaEnderecoServiceOptions = {},
  ) {
    this.#prisma = prisma;
    this.#agora = options.agora ?? (() => new Date());
  }

  async emitir(
    enderecoRecebido: unknown,
  ): Promise<ReferenciaEnderecoEmitida> {
    const endereco = enderecoReferenciaSchema.parse(enderecoRecebido);
    const token = randomBytes(32).toString("base64url");
    const expiraEm = new Date(
      this.#agora().getTime() + validadeReferenciaEnderecoMs,
    );

    await this.#prisma.referenciaEndereco.create({
      data: {
        tokenHash: hashTokenReferenciaEndereco(token),
        cep: endereco.cep,
        logradouro: endereco.logradouro,
        numero: endereco.numero,
        complemento: endereco.complemento ?? null,
        bairro: endereco.bairro,
        cidade: endereco.cidade,
        estado: endereco.estado,
        referencia: endereco.referencia ?? null,
        situacao: endereco.situacao,
        motivoPendencia: endereco.motivoPendencia,
        latitude:
          endereco.latitude === null
            ? null
            : new Prisma.Decimal(endereco.latitude.toFixed(6)),
        longitude:
          endereco.longitude === null
            ? null
            : new Prisma.Decimal(endereco.longitude.toFixed(6)),
        expiraEm,
      },
    });

    return { token, expiraEm };
  }

  async buscar(
    token: string,
    options: BuscarReferenciaEnderecoOptions = {},
  ): Promise<DadosEnderecoReferencia | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return null;
    }

    const tokenHash = hashTokenReferenciaEndereco(token);
    const referencia = await this.#prisma.referenciaEndereco.findUnique({
      where: { tokenHash },
    });
    if (!referencia) {
      return null;
    }

    if (referencia.expiraEm <= this.#agora()) {
      if (options.limparExpirada !== false) {
        await this.#prisma.referenciaEndereco.deleteMany({
          where: {
            id: referencia.id,
            expiraEm: { lte: this.#agora() },
          },
        });
      }
      return null;
    }

    return enderecoReferenciaSchema.parse({
      cep: referencia.cep,
      logradouro: referencia.logradouro,
      numero: referencia.numero,
      ...(referencia.complemento !== null
        ? { complemento: referencia.complemento }
        : {}),
      bairro: referencia.bairro,
      cidade: referencia.cidade,
      estado: referencia.estado,
      ...(referencia.referencia !== null
        ? { referencia: referencia.referencia }
        : {}),
      situacao: referencia.situacao,
      motivoPendencia: referencia.motivoPendencia,
      latitude: referencia.latitude?.toNumber() ?? null,
      longitude: referencia.longitude?.toNumber() ?? null,
    });
  }
}

export async function limparReferenciasECacheExpirados(
  prisma: PrismaClient,
  agora = new Date(),
): Promise<{ referencias: number; cache: number; reservas: number }> {
  const [referencias, cache, reservas] = await prisma.$transaction([
    prisma.referenciaEndereco.deleteMany({
      where: { expiraEm: { lte: agora } },
    }),
    prisma.cacheGeoapify.deleteMany({
      where: { expiraEm: { lte: agora } },
    }),
    prisma.reservaCacheGeoapify.deleteMany({
      where: { expiraEm: { lte: agora } },
    }),
  ]);

  return {
    referencias: referencias.count,
    cache: cache.count,
    reservas: reservas.count,
  };
}
