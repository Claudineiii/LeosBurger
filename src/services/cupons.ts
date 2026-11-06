import { Prisma, TipoDescontoCupom } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  calcularPercentual,
  decimalDeCentavos,
  formatarCentavos,
  paraCentavos,
  percentualEmPontosBase,
} from "./valores-monetarios.js";

const dataCivilSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((valor) => {
    const data = new Date(`${valor}T00:00:00.000Z`);
    return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
  });

const dinheiroSchema = z
  .number()
  .finite()
  .min(0)
  .max(99_999_999.99)
  .refine((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-8);

export const cupomAdminBodySchema = z
  .object({
    codigo: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((codigo) => codigo.toUpperCase()),
    tipoDesconto: z.nativeEnum(TipoDescontoCupom),
    valor: dinheiroSchema.refine((valor) => valor > 0),
    ativo: z.boolean().default(true),
    validadeInicio: dataCivilSchema,
    validadeFim: dataCivilSchema,
    compraMinima: dinheiroSchema.nullable().optional(),
    limiteUsos: z.number().int().positive().nullable().optional(),
    itemIds: z.array(z.string().uuid()).default([]),
    comboIds: z.array(z.string().uuid()).default([]),
  })
  .strict()
  .superRefine((cupom, contexto) => {
    if (cupom.validadeInicio > cupom.validadeFim) {
      contexto.addIssue({
        code: "custom",
        path: ["validadeFim"],
        message: "A data final deve ser igual ou posterior à inicial.",
      });
    }
    if (cupom.tipoDesconto === TipoDescontoCupom.PERCENTUAL && cupom.valor > 30) {
      contexto.addIssue({
        code: "custom",
        path: ["valor"],
        message: "O desconto percentual máximo é 30%.",
      });
    }
    if (new Set(cupom.itemIds).size !== cupom.itemIds.length) {
      contexto.addIssue({
        code: "custom",
        path: ["itemIds"],
        message: "Os itens elegíveis não podem estar duplicados.",
      });
    }
    if (new Set(cupom.comboIds).size !== cupom.comboIds.length) {
      contexto.addIssue({
        code: "custom",
        path: ["comboIds"],
        message: "Os combos elegíveis não podem estar duplicados.",
      });
    }
  });

export type CupomAdminRecebido = z.infer<typeof cupomAdminBodySchema>;

export function obterDataCivilSaoPaulo(agora = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function dataCivilParaBanco(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

export async function salvarCupom(
  prisma: PrismaClient,
  dadosRecebidos: unknown,
  id?: string,
) {
  const dados = cupomAdminBodySchema.parse(dadosRecebidos);
  return prisma.$transaction(async (tx) => {
    const [itens, combos] = await Promise.all([
      tx.item.findMany({
        where: { id: { in: dados.itemIds } },
        select: { id: true },
      }),
      tx.combo.findMany({
        where: { id: { in: dados.comboIds } },
        select: { id: true },
      }),
    ]);
    if (itens.length !== dados.itemIds.length || combos.length !== dados.comboIds.length) {
      throw new Error("ELEGIBILIDADE_CUPOM_INVALIDA");
    }

    const campos = {
      codigo: dados.codigo,
      tipoDesconto: dados.tipoDesconto,
      valor: new Prisma.Decimal(dados.valor.toFixed(2)),
      ativo: dados.ativo,
      validadeInicio: dataCivilParaBanco(dados.validadeInicio),
      validadeFim: dataCivilParaBanco(dados.validadeFim),
      compraMinima:
        dados.compraMinima == null
          ? null
          : new Prisma.Decimal(dados.compraMinima.toFixed(2)),
      limiteUsos: dados.limiteUsos ?? null,
      itensElegiveis: {
        create: dados.itemIds.map((itemId) => ({ itemId })),
      },
      combosElegiveis: {
        create: dados.comboIds.map((comboId) => ({ comboId })),
      },
    };

    if (id) {
      await tx.cupomItem.deleteMany({ where: { cupomId: id } });
      await tx.cupomCombo.deleteMany({ where: { cupomId: id } });
      return tx.cupom.update({ where: { id }, data: campos });
    }

    return tx.cupom.create({ data: campos });
  });
}

export type LinhaCupom = {
  tipo: "ITEM" | "COMBO";
  referenciaId: string;
  subtotalCentavos: bigint;
};

export async function calcularDescontoCupom(
  prisma: Pick<PrismaClient, "cupom" | "cupomUtilizacao">,
  codigoRecebido: string | undefined,
  linhas: LinhaCupom[],
  agora = new Date(),
): Promise<{ codigo: string | null; descontoCentavos: bigint; subtotalElegivelCentavos: bigint }> {
  if (!codigoRecebido) {
    return { codigo: null, descontoCentavos: 0n, subtotalElegivelCentavos: 0n };
  }

  const codigo = codigoRecebido.trim().toUpperCase();
  const cupom = await prisma.cupom.findUnique({
    where: { codigo },
    include: {
      itensElegiveis: { select: { itemId: true } },
      combosElegiveis: { select: { comboId: true } },
    },
  });
  if (!cupom || !cupom.ativo) {
    throw new Error("CUPOM_INVALIDO");
  }

  const hoje = obterDataCivilSaoPaulo(agora);
  const inicio = cupom.validadeInicio.toISOString().slice(0, 10);
  const fim = cupom.validadeFim.toISOString().slice(0, 10);
  if (hoje < inicio || hoje > fim) {
    throw new Error("CUPOM_INVALIDO");
  }

  if (
    cupom.limiteUsos !== null &&
    (await prisma.cupomUtilizacao.count({ where: { cupomId: cupom.id } })) >=
      cupom.limiteUsos
  ) {
    throw new Error("CUPOM_INVALIDO");
  }

  const itensElegiveis = new Set(cupom.itensElegiveis.map(({ itemId }) => itemId));
  const combosElegiveis = new Set(cupom.combosElegiveis.map(({ comboId }) => comboId));
  const subtotalElegivelCentavos = linhas.reduce((total, linha) => {
    const elegivel =
      linha.tipo === "ITEM"
        ? itensElegiveis.has(linha.referenciaId)
        : combosElegiveis.has(linha.referenciaId);
    return total + (elegivel ? linha.subtotalCentavos : 0n);
  }, 0n);
  if (
    cupom.compraMinima !== null &&
    subtotalElegivelCentavos < paraCentavos(cupom.compraMinima)
  ) {
    throw new Error("CUPOM_INVALIDO");
  }

  const valorCentavos = paraCentavos(cupom.valor);
  const descontoCentavos =
    cupom.tipoDesconto === TipoDescontoCupom.FIXO
      ? valorCentavos > subtotalElegivelCentavos
        ? subtotalElegivelCentavos
        : valorCentavos
      : calcularPercentual(
          subtotalElegivelCentavos,
          percentualEmPontosBase(cupom.valor),
        );

  return {
    codigo: cupom.codigo,
    descontoCentavos,
    subtotalElegivelCentavos,
  };
}

export async function registrarUtilizacaoCupom(
  tx: Prisma.TransactionClient,
  cupomId: string,
  pedidoId: string,
): Promise<void> {
  const [cupom] = await tx.$queryRaw<{ id: string; limiteUsos: number | null }[]>`
    SELECT "id", "limite_usos" AS "limiteUsos"
    FROM "cupons"
    WHERE "id" = ${cupomId}
    FOR UPDATE
  `;
  if (!cupom) {
    throw new Error("CUPOM_INVALIDO");
  }
  if (
    cupom.limiteUsos !== null &&
    (await tx.cupomUtilizacao.count({ where: { cupomId } })) >= cupom.limiteUsos
  ) {
    throw new Error("CUPOM_ESGOTADO");
  }

  await tx.cupomUtilizacao.create({ data: { cupomId, pedidoId } });
}

export function serializarCupom(cupom: {
  id: string;
  codigo: string;
  tipoDesconto: TipoDescontoCupom;
  valor: Prisma.Decimal;
  ativo: boolean;
  validadeInicio: Date;
  validadeFim: Date;
  compraMinima: Prisma.Decimal | null;
  limiteUsos: number | null;
  itensElegiveis: Array<{ itemId: string }>;
  combosElegiveis: Array<{ comboId: string }>;
}) {
  return {
    id: cupom.id,
    codigo: cupom.codigo,
    tipoDesconto: cupom.tipoDesconto,
    valor: formatarCentavos(paraCentavos(cupom.valor)),
    ativo: cupom.ativo,
    validadeInicio: cupom.validadeInicio.toISOString().slice(0, 10),
    validadeFim: cupom.validadeFim.toISOString().slice(0, 10),
    compraMinima:
      cupom.compraMinima === null
        ? null
        : formatarCentavos(paraCentavos(cupom.compraMinima)),
    limiteUsos: cupom.limiteUsos,
    itemIds: cupom.itensElegiveis.map(({ itemId }) => itemId),
    comboIds: cupom.combosElegiveis.map(({ comboId }) => comboId),
  };
}

export function serializarDescontoCupom(valor: bigint): string {
  return formatarCentavos(valor);
}

export function decimalDescontoCupom(valor: bigint): Prisma.Decimal {
  return decimalDeCentavos(valor);
}
