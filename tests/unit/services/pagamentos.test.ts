import { afterEach, describe, expect, it, vi } from "vitest";
import { limparLimitesPagamentoParaTeste, limitarCobranca, verificarConfiguracaoLimitesPagamento } from "../../../src/services/pagamentos/limites.js";
import { SimuladorPagamentos } from "../../../src/services/pagamentos/simulador.js";
import { transacaoSerializavel } from "../../../src/services/pagamentos/tentativas.js";
import { criarAplicacao } from "../../../src/app.js";
import type { PrismaClient } from "@prisma/client";

describe("contrato e simulador de pagamentos", () => {
  it("rejeita inicialização do simulador em produção", () => {
    expect(() => new SimuladorPagamentos("production")).toThrow(
      "SIMULADOR_PAGAMENTOS_PROIBIDO_EM_PRODUCAO",
    );
  });

  it("falha na inicialização quando produção seleciona o simulador", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAGAMENTOS_PROVEDOR", "simulador");
    vi.stubEnv("PAGAMENTOS_RATE_LIMIT_COBRANCA_INICIAL", "5");
    vi.stubEnv("PAGAMENTOS_RATE_LIMIT_SEGUNDA_TENTATIVA", "3");
    vi.stubEnv("PAGAMENTOS_RATE_LIMIT_JANELA_SEGUNDOS", "600");
    try {
      expect(() => criarAplicacao()).toThrow("SIMULADOR_PAGAMENTOS_PROIBIDO_EM_PRODUCAO");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("normaliza eventos sem aceitar payloads inválidos", () => {
    const simulador = new SimuladorPagamentos("test");
    expect(() => simulador.normalizarEvento({ estado: "PAGO" })).toThrow(
      "EVENTO_PAGAMENTO_INVALIDO",
    );
    expect(
      simulador.normalizarEvento({
        idEvento: "evento-1",
        identificadorCobranca: "cobranca-1",
        identificadorTransacao: "transacao-1",
        estado: "PAGO",
        ocorridoEm: new Date("2026-11-13T12:00:00.000Z"),
      }),
    ).toMatchObject({ estado: "PAGO", identificadorCobranca: "cobranca-1" });
  });
});

describe("limites configuráveis das cobranças", () => {
  afterEach(() => {
    limparLimitesPagamentoParaTeste();
    vi.unstubAllEnvs();
  });

  describe("repetição de transações Serializable", () => {
    it.each([
      ["40001", { code: "40001" }],
      ["P2034", { code: "P2034" }],
      ["40001 encapsulado pelo Prisma", { code: "P2010", meta: { code: "40001" } }],
    ])("repete conflitos %s", async (_descricao, erro) => {
      const transacao = vi.fn()
        .mockRejectedValueOnce(erro)
        .mockImplementationOnce(async (operacao) => operacao({}));
      const prisma = { $transaction: transacao } as unknown as PrismaClient;

      await expect(transacaoSerializavel(prisma, async () => "concluída"))
        .resolves.toBe("concluída");
      expect(transacao).toHaveBeenCalledTimes(2);
    });
  });

  it("limita por operação e escopo, permitindo replay idempotente", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAGAMENTOS_RATE_LIMIT_COBRANCA_INICIAL", "1");
    vi.stubEnv("PAGAMENTOS_RATE_LIMIT_SEGUNDA_TENTATIVA", "2");
    vi.stubEnv("PAGAMENTOS_RATE_LIMIT_JANELA_SEGUNDOS", "10");

    const base = {
      operacao: "COBRANCA_INICIAL" as const,
      identificador: "cliente-1",
      idempotencyKey: "checkout-1",
      agora: 1_000,
    };
    limitarCobranca(base);
    limitarCobranca({ ...base, agora: 1_001 });
    expect(() => limitarCobranca({ ...base, idempotencyKey: "checkout-2", agora: 1_002 })).toThrow(
      "RATE_LIMIT_PAGAMENTO_EXCEDIDO",
    );
    limitarCobranca({ ...base, idempotencyKey: "checkout-3", agora: 11_000 });
    limitarCobranca({ ...base, operacao: "SEGUNDA_TENTATIVA", idempotencyKey: "retry-1" });
  });

  it("exige limites explícitos em produção e falha fechada sem Redis", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAGAMENTOS_RATE_LIMIT_COBRANCA_INICIAL", "5");
    vi.stubEnv("PAGAMENTOS_RATE_LIMIT_SEGUNDA_TENTATIVA", "3");
    vi.stubEnv("PAGAMENTOS_RATE_LIMIT_JANELA_SEGUNDOS", "600");
    expect(verificarConfiguracaoLimitesPagamento).not.toThrow();
    expect(() => limitarCobranca({
      operacao: "COBRANCA_INICIAL",
      identificador: "cliente-1",
      idempotencyKey: "checkout-1",
    })).toThrow("RATE_LIMITER_DISTRIBUIDO_INDISPONIVEL");

    vi.stubEnv("PAGAMENTOS_RATE_LIMIT_COBRANCA_INICIAL", "");
    expect(verificarConfiguracaoLimitesPagamento).toThrow(
      "CONFIGURACAO_OBRIGATORIA:PAGAMENTOS_RATE_LIMIT_COBRANCA_INICIAL",
    );
  });
});
