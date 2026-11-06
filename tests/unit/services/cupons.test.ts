import { TipoDescontoCupom } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  cupomAdminBodySchema,
  obterDataCivilSaoPaulo,
} from "../../../src/services/cupons.js";
import {
  calcularPercentual,
  formatarCentavos,
  paraCentavos,
} from "../../../src/services/valores-monetarios.js";

describe("regras de cupons e valores monetários", () => {
  it("valida datas civis e limite percentual de 30%", () => {
    const base = {
      codigo: "  desconto-1 ",
      tipoDesconto: TipoDescontoCupom.PERCENTUAL,
      valor: 30,
      validadeInicio: "2026-01-01",
      validadeFim: "2026-12-31",
      itemIds: [],
      comboIds: [],
    };

    expect(cupomAdminBodySchema.parse(base).codigo).toBe("DESCONTO-1");
    expect(cupomAdminBodySchema.safeParse({ ...base, valor: 30.01 }).success).toBe(
      false,
    );
    expect(
      cupomAdminBodySchema.safeParse({ ...base, validadeInicio: "2026-02-30" })
        .success,
    ).toBe(false);
  });

  it("calcula percentuais em centavos sem aritmética financeira de ponto flutuante", () => {
    const base = paraCentavos("19.99");
    const desconto = calcularPercentual(base, 1_550n);

    expect(formatarCentavos(desconto)).toBe("3.10");
    expect(formatarCentavos(paraCentavos("0.10") + paraCentavos("0.20"))).toBe(
      "0.30",
    );
  });

  it("determina a data civil de São Paulo", () => {
    expect(obterDataCivilSaoPaulo(new Date("2026-01-01T02:30:00.000Z"))).toBe(
      "2025-12-31",
    );
  });
});
