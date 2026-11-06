import { describe, expect, it } from "vitest";
import {
  calcularDistanciaKm,
  substituicaoFaixasSchema,
} from "../../../src/services/faixas-frete.js";

describe("regras das faixas de frete", () => {
  it("aceita intervalos contínuos semiabertos com máximo inclusivo em 6 km", () => {
    expect(
      substituicaoFaixasSchema.safeParse([
        { distanciaMinima: 0, distanciaMaxima: 2, valor: 0 },
        { distanciaMinima: 2, distanciaMaxima: 6, valor: 10 },
      ]).success,
    ).toBe(true);
  });

  it("rejeita lacunas, sobreposições e limite final diferente de 6 km", () => {
    for (const faixas of [
      [
        { distanciaMinima: 0, distanciaMaxima: 2, valor: 1 },
        { distanciaMinima: 2.1, distanciaMaxima: 6, valor: 2 },
      ],
      [
        { distanciaMinima: 0, distanciaMaxima: 2.1, valor: 1 },
        { distanciaMinima: 2, distanciaMaxima: 6, valor: 2 },
      ],
      [{ distanciaMinima: 0, distanciaMaxima: 5.99, valor: 1 }],
    ]) {
      expect(substituicaoFaixasSchema.safeParse(faixas).success).toBe(false);
    }
  });

  it("calcula distância em linha reta usando coordenadas geográficas", () => {
    expect(calcularDistanciaKm(-22.9068, -47.0616, -22.9068, -47.0616)).toBe(0);
    expect(calcularDistanciaKm(-22.9068, -47.0616, -22.9168, -47.0616)).toBeCloseTo(
      1.1119,
      3,
    );
  });
});
