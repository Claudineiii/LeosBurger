import { randomUUID } from "node:crypto";
import {
  adicionaisConfiguradosSchema,
  lerAdicionaisPublicos,
  validarSelecaoAdicionais,
} from "../../../src/services/adicionais.js";
import { describe, expect, it } from "vitest";

describe("contrato de adicionais", () => {
  it("aplica quantidade máxima 1 quando ausente e publica somente ativos", () => {
    const ativo = {
      id: randomUUID(),
      nome: "Cheddar",
      preco: 2.5,
      ativo: true,
    };
    const inativo = {
      id: randomUUID(),
      nome: "Bacon",
      preco: 3,
      ativo: false,
      quantidadeMaxima: 2,
    };

    expect(adicionaisConfiguradosSchema.parse([ativo])[0]?.quantidadeMaxima).toBe(1);
    expect(lerAdicionaisPublicos([ativo, inativo])).toEqual([
      { ...ativo, quantidadeMaxima: 1 },
    ]);
  });

  it("não publica nem aceita configurações legadas sem identidade e estado", () => {
    expect(lerAdicionaisPublicos([{ nome: "Cheddar", preco: 2.5 }])).toEqual([]);
    expect(() =>
      validarSelecaoAdicionais(
        [{ nome: "Cheddar", preco: 2.5 }],
        [{ id: randomUUID(), quantidade: 1 }],
      ),
    ).toThrow("ADICIONAL_INDISPONIVEL");
  });

  it("rejeita IDs repetidos, seleção duplicada, inativa e quantidade acima do limite", () => {
    const id = randomUUID();
    const adicional = {
      id,
      nome: "Cheddar",
      preco: 2.5,
      ativo: true,
      quantidadeMaxima: 2,
    };

    expect(() =>
      adicionaisConfiguradosSchema.parse([adicional, adicional]),
    ).toThrow();
    expect(() =>
      validarSelecaoAdicionais([adicional], [
        { id, quantidade: 1 },
        { id, quantidade: 1 },
      ]),
    ).toThrow();
    expect(() =>
      validarSelecaoAdicionais([adicional], [{ id, quantidade: 3 }]),
    ).toThrow("QUANTIDADE_ADICIONAL_INVALIDA");
    expect(() =>
      validarSelecaoAdicionais(
        [{ ...adicional, ativo: false }],
        [{ id, quantidade: 1 }],
      ),
    ).toThrow("ADICIONAL_INDISPONIVEL");
  });
});
