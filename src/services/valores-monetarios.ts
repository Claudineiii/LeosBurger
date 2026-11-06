import { Prisma } from "@prisma/client";

const padraoCentavos = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

export function paraCentavos(valor: Prisma.Decimal | string | number): bigint {
  const texto = valor instanceof Prisma.Decimal ? valor.toFixed(2) : String(valor);
  const partes = padraoCentavos.exec(texto);
  if (!partes) {
    throw new Error("VALOR_MONETARIO_INVALIDO");
  }

  const inteiro = BigInt(partes[2]!);
  const centavos = BigInt((partes[3] ?? "").padEnd(2, "0"));
  const resultado = inteiro * 100n + centavos;
  return partes[1] === "-" ? -resultado : resultado;
}

export function formatarCentavos(valor: bigint): string {
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;
  const inteiro = absoluto / 100n;
  const centavos = String(absoluto % 100n).padStart(2, "0");
  return `${negativo ? "-" : ""}${inteiro}.${centavos}`;
}

export function decimalDeCentavos(valor: bigint): Prisma.Decimal {
  return new Prisma.Decimal(formatarCentavos(valor));
}

export function percentualEmPontosBase(valor: Prisma.Decimal): bigint {
  return paraCentavos(valor);
}

export function calcularPercentual(
  baseCentavos: bigint,
  pontosBase: bigint,
): bigint {
  return (baseCentavos * pontosBase + 5_000n) / 10_000n;
}
