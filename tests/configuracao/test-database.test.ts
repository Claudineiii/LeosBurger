import { describe, expect, it } from "vitest";
import { validarUrlBancoTeste } from "../../scripts/test-database.js";

describe("Proteção do banco de testes", () => {
  it("aceita somente o banco local autorizado", () => {
    expect(
      validarUrlBancoTeste(
        "postgresql://usuario:senha@127.0.0.1:5432/leosburger_test?schema=public",
      ),
    ).toContain("/leosburger_test");
  });

  it("rejeita o banco de desenvolvimento", () => {
    expect(() =>
      validarUrlBancoTeste(
        "postgresql://usuario:senha@127.0.0.1:5432/leosburger_db?schema=public",
      ),
    ).toThrow(/exclusivamente para leosburger_test/);
  });

  it("rejeita servidores de banco remotos", () => {
    expect(() =>
      validarUrlBancoTeste(
        "postgresql://usuario:senha@db.example.com:5432/leosburger_test?schema=public",
      ),
    ).toThrow(/servidor local/);
  });
});
