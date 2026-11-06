import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkoutPreviewBodySchema } from "../../../src/services/checkout-preview.js";

describe("contrato de prévia do checkout", () => {
  const itemId = randomUUID();
  const comboId = randomUUID();
  const adicionalId = randomUUID();

  it("exige exatamente um item ou combo por linha", () => {
    const base = {
      tipoEntrega: "RETIRADA",
      metodoPagamento: "PIX",
      itens: [{ quantidade: 1 }],
    };

    expect(
      checkoutPreviewBodySchema.safeParse({
        ...base,
        itens: [{ itemId, comboId, quantidade: 1 }],
      }).success,
    ).toBe(false);
    expect(
      checkoutPreviewBodySchema.safeParse({
        ...base,
        itens: [{ quantidade: 1 }],
      }).success,
    ).toBe(false);
    expect(
      checkoutPreviewBodySchema.safeParse({
        ...base,
        itens: [{ comboId, quantidade: 1 }],
      }).success,
    ).toBe(true);
  });

  it("não aceita adicionais em combos nem campos que poderiam adulterar preços", () => {
    const base = {
      tipoEntrega: "RETIRADA",
      metodoPagamento: "PIX",
    };

    expect(
      checkoutPreviewBodySchema.safeParse({
        ...base,
        itens: [
          {
            comboId,
            quantidade: 1,
            adicionais: [{ id: adicionalId, quantidade: 1 }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      checkoutPreviewBodySchema.safeParse({
        ...base,
        itens: [
          {
            itemId,
            quantidade: 1,
            preco: 0.01,
            adicionais: [{ id: adicionalId, quantidade: 1 }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejeita referência para retirada e quantidade fora dos limites", () => {
    expect(
      checkoutPreviewBodySchema.safeParse({
        tipoEntrega: "RETIRADA",
        metodoPagamento: "PIX",
        referenciaEndereco: "A".repeat(43),
        itens: [{ itemId, quantidade: 1 }],
      }).success,
    ).toBe(false);
    expect(
      checkoutPreviewBodySchema.safeParse({
        tipoEntrega: "RETIRADA",
        metodoPagamento: "PIX",
        itens: [{ itemId, quantidade: 100 }],
      }).success,
    ).toBe(false);
  });
});
