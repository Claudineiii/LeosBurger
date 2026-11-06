import { describe, expect, it } from "vitest";
import { hashTokenReferenciaEndereco } from "../../../src/services/referencias-endereco.js";

describe("hash da referência temporária de endereço", () => {
  it("é determinístico e não reproduz o token", () => {
    const token = "A".repeat(43);
    const hash = hashTokenReferenciaEndereco(token);

    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(token);
    expect(hashTokenReferenciaEndereco(token)).toBe(hash);
  });

  it("gera hashes diferentes para tokens diferentes", () => {
    expect(
      hashTokenReferenciaEndereco("A".repeat(43)),
    ).not.toBe(hashTokenReferenciaEndereco("B".repeat(43)));
  });
});
