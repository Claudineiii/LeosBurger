import { createHash, randomBytes, randomUUID } from "node:crypto";
import { MetodoPagamento, Prisma, StatusPedido } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";
import {
  confirmarPagamentoPresencial,
  expirarTentativasPixVencidas,
  iniciarTentativaInicial,
  processarEventoPagamento,
  solicitarSegundaTentativa,
} from "../../src/services/pagamentos/tentativas.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("tentativas de pagamento", () => {
  const app = criarAplicacao();

  afterAll(async () => app.close());

  it("cria a segunda tentativa idempotentemente e nunca permite a terceira", async () => {
    await app.ready();
    const token = randomBytes(32).toString("base64url");
    const pedido = await app.prisma.pedido.create({
      data: {
        tipoEntrega: "RETIRADA",
        metodoPagamento: MetodoPagamento.PIX,
        nomeClienteHistorico: "Visitante de pagamento",
        telefoneClienteHistorico: "19999991234",
        subtotal: new Prisma.Decimal("25.00"),
        desconto: new Prisma.Decimal("0.00"),
        taxaEntrega: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal("25.00"),
        tokenAcompanhamentoHash: sha256(token),
      },
    });
    try {
      const primeira = await iniciarTentativaInicial({
        prisma: app.prisma,
        provedor: app.provedorPagamentos,
        pedidoId: pedido.id,
        chavePedido: randomUUID(),
        identificadorRateLimit: `ip:${randomUUID()}`,
      });
      expect(primeira.numeroTentativa).toBe(1);
      expect(primeira.expiraEm!.getTime() - primeira.confirmadaEm!.getTime()).toBe(300_000);

      await app.prisma.tentativaPagamento.update({
        where: { id: primeira.id },
        data: { status: "FALHOU", encerradoEm: new Date() },
      });
      const chave = randomUUID();
      const headers = { "x-pedido-token": token, "idempotency-key": chave };
      const [resposta, repeticao] = await Promise.all([
        app.inject({ method: "POST", url: `/pedidos/${pedido.id}/tentativas-pagamento`, headers }),
        app.inject({ method: "POST", url: `/pedidos/${pedido.id}/tentativas-pagamento`, headers }),
      ]);
      expect([resposta.statusCode, repeticao.statusCode].sort()).toEqual([200, 201]);
      expect(resposta.json().id).toBe(repeticao.json().id);
      expect(resposta.json().numeroTentativa).toBe(2);
      expect(
        new Date(resposta.json().expiraEm).getTime() - new Date(resposta.json().confirmadaEm).getTime(),
      ).toBe(300_000);
      const consulta = await app.inject({
        method: "GET",
        url: `/pedidos/${pedido.id}/tentativas-pagamento`,
        headers: { "x-pedido-token": token },
      });
      expect(consulta.statusCode).toBe(200);
      expect(consulta.json().tentativas).toHaveLength(2);
      const semToken = await app.inject({
        method: "GET",
        url: `/pedidos/${pedido.id}/tentativas-pagamento`,
      });
      expect(semToken.statusCode).toBe(404);
      expect(await app.prisma.tentativaPagamento.count({ where: { pedidoId: pedido.id } })).toBe(2);

      const terceira = await app.inject({
        method: "POST",
        url: `/pedidos/${pedido.id}/tentativas-pagamento`,
        headers: { ...headers, "idempotency-key": randomUUID() },
      });
      expect(terceira.statusCode).toBe(409);
    } finally {
      await app.prisma.pedido.delete({ where: { id: pedido.id } });
    }
  });

  it("expira a segunda cobrança, cancela o pedido e preserva o histórico", async () => {
    await app.ready();
    const pedido = await app.prisma.pedido.create({
      data: {
        tipoEntrega: "RETIRADA",
        metodoPagamento: MetodoPagamento.PIX,
        nomeClienteHistorico: "Pedido expirado",
        telefoneClienteHistorico: "19999991234",
        subtotal: 20,
        desconto: 0,
        taxaEntrega: 0,
        total: 20,
        historicoStatus: [
          { status: "PENDENTE", alteradoEm: new Date().toISOString(), motivo: "PEDIDO_CRIADO" },
        ],
      },
    });
    try {
      const primeira = await iniciarTentativaInicial({
        prisma: app.prisma,
        provedor: app.provedorPagamentos,
        pedidoId: pedido.id,
        chavePedido: randomUUID(),
        identificadorRateLimit: `ip:${randomUUID()}`,
      });
      await app.prisma.tentativaPagamento.update({
        where: { id: primeira.id },
        data: { status: "RECUSADO", encerradoEm: new Date() },
      });
      const segunda = await app.prisma.tentativaPagamento.create({
        data: {
          pedidoId: pedido.id,
          metodo: MetodoPagamento.PIX,
          numeroTentativa: 2,
          status: "PENDENTE",
          valor: 20,
          chaveIdempotencia: `teste:${randomUUID()}`,
          confirmadaEm: new Date(Date.now() - 600_000),
          expiraEm: new Date(Date.now() - 300_000),
        },
      });

      await expirarTentativasPixVencidas(app.prisma);
      const pedidoAtualizado = await app.prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
      const tentativaAtualizada = await app.prisma.tentativaPagamento.findUniqueOrThrow({ where: { id: segunda.id } });
      expect(pedidoAtualizado.status).toBe(StatusPedido.CANCELADO);
      expect(pedidoAtualizado.historicoStatus).toMatchObject([
        { motivo: "PEDIDO_CRIADO" },
        { status: "CANCELADO", motivo: "EXPIRACAO_SEGUNDA_TENTATIVA_PIX" },
      ]);
      expect(tentativaAtualizada.status).toBe("EXPIRADO");
    } finally {
      await app.prisma.pedido.delete({ where: { id: pedido.id } });
    }
  });

  it("serializa solicitações concorrentes com chaves diferentes", async () => {
    await app.ready();
    const token = randomBytes(32).toString("base64url");
    const pedido = await app.prisma.pedido.create({
      data: {
        tipoEntrega: "RETIRADA",
        metodoPagamento: MetodoPagamento.PIX,
        nomeClienteHistorico: "Concorrência pagamentos",
        telefoneClienteHistorico: "19999991234",
        subtotal: 20,
        desconto: 0,
        taxaEntrega: 0,
        total: 20,
        tokenAcompanhamentoHash: sha256(token),
      },
    });
    try {
      const primeira = await iniciarTentativaInicial({
        prisma: app.prisma,
        provedor: app.provedorPagamentos,
        pedidoId: pedido.id,
        chavePedido: randomUUID(),
        identificadorRateLimit: `ip:${randomUUID()}`,
      });
      await app.prisma.tentativaPagamento.update({
        where: { id: primeira.id },
        data: { status: "RECUSADO", encerradoEm: new Date() },
      });
      const respostas = await Promise.all([
        app.inject({
          method: "POST",
          url: `/pedidos/${pedido.id}/tentativas-pagamento`,
          headers: { "x-pedido-token": token, "idempotency-key": randomUUID() },
        }),
        app.inject({
          method: "POST",
          url: `/pedidos/${pedido.id}/tentativas-pagamento`,
          headers: { "x-pedido-token": token, "idempotency-key": randomUUID() },
        }),
      ]);
      expect(respostas.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409]);
      expect(await app.prisma.tentativaPagamento.count({ where: { pedidoId: pedido.id } })).toBe(2);
    } finally {
      await app.prisma.pedido.delete({ where: { id: pedido.id } });
    }
  });

  it("audita evento duplicado e registra pagamento tardio sem reabrir o pedido", async () => {
    await app.ready();
    const pedido = await app.prisma.pedido.create({
      data: {
        tipoEntrega: "RETIRADA",
        metodoPagamento: MetodoPagamento.PIX,
        status: StatusPedido.CANCELADO,
        nomeClienteHistorico: "Pagamento tardio",
        telefoneClienteHistorico: "19999991234",
        subtotal: 20,
        desconto: 0,
        taxaEntrega: 0,
        total: 20,
      },
    });
    try {
      const tentativa = await app.prisma.tentativaPagamento.create({
        data: {
          pedidoId: pedido.id,
          metodo: MetodoPagamento.PIX,
          numeroTentativa: 1,
          valor: 20,
          chaveIdempotencia: `teste:${randomUUID()}`,
          identificadorExterno: randomUUID(),
        },
      });
      const eventos = await app.simuladorPagamentos!.criarEvento({
        tentativaId: tentativa.id,
        cenario: "DUPLICADO",
        dataEvento: new Date(Date.now() - 360_000),
        idEvento: randomUUID(),
      });
      await processarEventoPagamento(app.prisma, app.simuladorPagamentos!, eventos[0]);
      await processarEventoPagamento(app.prisma, app.simuladorPagamentos!, eventos[1]);

      const pedidoAtualizado = await app.prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
      const tentativaAtualizada = await app.prisma.tentativaPagamento.findUniqueOrThrow({ where: { id: tentativa.id } });
      expect(pedidoAtualizado.status).toBe("CANCELADO");
      expect(pedidoAtualizado.statusFinanceiro).toBe("REEMBOLSO_PENDENTE");
      expect(tentativaAtualizada.status).toBe("PAGO");
      expect(tentativaAtualizada.eventos).toHaveLength(1);
      expect(tentativaAtualizada.auditoria).toMatchObject([
        { tipo: "EVENTO_RECEBIDO" },
        { tipo: "EVENTO_DUPLICADO" },
      ]);
    } finally {
      await app.prisma.pedido.delete({ where: { id: pedido.id } });
    }
  });

  it("confirma pagamento presencial somente por operação administrativa", async () => {
    await app.ready();
    const pedido = await app.prisma.pedido.create({
      data: {
        tipoEntrega: "RETIRADA",
        metodoPagamento: MetodoPagamento.CREDITO,
        nomeClienteHistorico: "Pagamento presencial",
        telefoneClienteHistorico: "19999991234",
        subtotal: 31,
        desconto: 0,
        taxaEntrega: 0,
        total: 31,
      },
    });
    try {
      const tentativa = await iniciarTentativaInicial({
        prisma: app.prisma,
        provedor: app.provedorPagamentos,
        pedidoId: pedido.id,
        chavePedido: randomUUID(),
        identificadorRateLimit: `ip:${randomUUID()}`,
      });
      expect(tentativa.status).toBe("PENDENTE");
      const atualizada = await confirmarPagamentoPresencial({
        prisma: app.prisma,
        tentativaId: tentativa.id,
        adminId: randomUUID(),
        resultado: "PAGO",
      });
      expect(atualizada.status).toBe("PAGO");
      expect(atualizada.auditoria).toMatchObject([
        { tipo: "CONFIRMACAO_PRESENCIAL_ADMIN", resultado: "PAGO" },
      ]);
      expect((await app.prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } })).statusFinanceiro)
        .toBe("PAGO");

      await expect(confirmarPagamentoPresencial({
        prisma: app.prisma,
        tentativaId: tentativa.id,
        adminId: randomUUID(),
        resultado: "RECUSADO",
      })).rejects.toThrow("TENTATIVA_JA_ENCERRADA");
    } finally {
      await app.prisma.pedido.delete({ where: { id: pedido.id } });
    }
  });

  it("audita duas cobranças distintas pagas sem criar reembolso automático", async () => {
    await app.ready();
    const pedido = await app.prisma.pedido.create({
      data: {
        tipoEntrega: "RETIRADA",
        metodoPagamento: MetodoPagamento.PIX,
        nomeClienteHistorico: "Duas cobranças",
        telefoneClienteHistorico: "19999991234",
        subtotal: 40,
        desconto: 0,
        taxaEntrega: 0,
        total: 40,
      },
    });
    try {
      const primeira = await iniciarTentativaInicial({
        prisma: app.prisma,
        provedor: app.provedorPagamentos,
        pedidoId: pedido.id,
        chavePedido: randomUUID(),
        identificadorRateLimit: `ip:${randomUUID()}`,
      });
      await app.prisma.tentativaPagamento.update({
        where: { id: primeira.id },
        data: { status: "FALHOU", encerradoEm: new Date() },
      });
      const resultadoSegunda = await solicitarSegundaTentativa({
        prisma: app.prisma,
        provedor: app.provedorPagamentos!,
        pedidoId: pedido.id,
        chaveRequisicao: randomUUID(),
        identificadorRateLimit: `ip:${randomUUID()}`,
      });
      const segunda = resultadoSegunda.tentativa;
      const pagamentoSegunda = await app.simuladorPagamentos!.criarEvento({
        tentativaId: segunda.id,
        cenario: "PAGO",
      });
      const pagamentoPrimeira = await app.simuladorPagamentos!.criarEvento({
        tentativaId: primeira.id,
        cenario: "PAGO",
      });
      await processarEventoPagamento(app.prisma, app.simuladorPagamentos!, pagamentoSegunda[0]!);
      await processarEventoPagamento(app.prisma, app.simuladorPagamentos!, pagamentoPrimeira[0]!);

      const tentativas = await app.prisma.tentativaPagamento.findMany({
        where: { pedidoId: pedido.id },
        orderBy: { numeroTentativa: "asc" },
      });
      expect(tentativas.map(({ status }) => status)).toEqual(["PAGO", "PAGO"]);
      expect(JSON.stringify(tentativas)).toContain("OUTRA_COBRANCA_DO_PEDIDO_TAMBEM_PAGA");
      expect((await app.prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } })).statusFinanceiro)
        .toBe("PAGO");
    } finally {
      await app.prisma.pedido.delete({ where: { id: pedido.id } });
    }
  });
});
