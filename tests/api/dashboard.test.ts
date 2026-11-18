import { randomUUID } from "node:crypto";
import { MetodoPagamento, Prisma, StatusReembolso, TipoUsuario } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";
import { obterIntervaloDashboard } from "../../src/routes/dashboard.js";
import { confirmarPagamentoPresencial, processarEventoPagamento } from "../../src/services/pagamentos/tentativas.js";

function cookie(response: { headers: Record<string, unknown> }) {
  const setCookie = response.headers["set-cookie"];
  const first = typeof setCookie === "string" ? setCookie : Array.isArray(setCookie) ? setCookie[0] : null;
  if (typeof first !== "string") throw new Error("Cookie ausente no login de teste.");
  return first.split(";")[0]!;
}

describe("Sprint 16 — dashboard administrativo", () => {
  const apps: ReturnType<typeof criarAplicacao>[] = [];
  afterAll(async () => Promise.all(apps.map((app) => app.close())));

  it("converte períodos civis de São Paulo para limites UTC inclusivos/exclusivos", () => {
    expect(obterIntervaloDashboard("dia", "2024-02-29")).toEqual({ inicio: new Date("2024-02-29T03:00:00.000Z"), fim: new Date("2024-03-01T03:00:00.000Z") });
    expect(obterIntervaloDashboard("mes", "2026-12")).toEqual({ inicio: new Date("2026-12-01T03:00:00.000Z"), fim: new Date("2027-01-01T03:00:00.000Z") });
    expect(obterIntervaloDashboard("semestre", "2026-S1")).toEqual({ inicio: new Date("2026-01-01T03:00:00.000Z"), fim: new Date("2026-07-01T03:00:00.000Z") });
    expect(obterIntervaloDashboard("semestre", "2026-S2")).toEqual({ inicio: new Date("2026-07-01T03:00:00.000Z"), fim: new Date("2027-01-01T03:00:00.000Z") });
    expect(obterIntervaloDashboard("dia", "2026-06-30").fim).toEqual(new Date("2026-07-01T03:00:00.000Z"));
    expect(obterIntervaloDashboard("dia", "2026-07-01").inicio).toEqual(new Date("2026-07-01T03:00:00.000Z"));
    expect(obterIntervaloDashboard("ano", "2024").fim).toEqual(new Date("2025-01-01T03:00:00.000Z"));
    expect(obterIntervaloDashboard("dia", "2018-11-04")).toEqual({ inicio: new Date("2018-11-04T03:00:00.000Z"), fim: new Date("2018-11-05T02:00:00.000Z") });
    expect(() => obterIntervaloDashboard("dia", "2026-02-29")).toThrow("REFERENCIA_INVALIDA");
    const timezoneOriginal = process.env.TZ;
    process.env.TZ = "Pacific/Honolulu";
    try {
      expect(obterIntervaloDashboard("dia", "2024-02-29")).toEqual({ inicio: new Date("2024-02-29T03:00:00.000Z"), fim: new Date("2024-03-01T03:00:00.000Z") });
    } finally {
      if (timezoneOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = timezoneOriginal;
    }
  });

  it("protege ADMIN e agrega pedidos, cobranças e reembolsos sem multiplicar valores", async () => {
    const app = criarAplicacao(); apps.push(app); await app.ready();
    const senha = "SenhaSegura123!";
    const hash = await bcrypt.hash(senha, 6);
    const admin = await app.prisma.usuario.create({ data: { nome: "Admin dashboard", email: `dashboard-${randomUUID()}@test.local`, telefone: "19999990001", senhaHash: hash, tipo: TipoUsuario.ADMIN } });
    const cliente = await app.prisma.usuario.create({ data: { nome: "Cliente dashboard", email: `cliente-dashboard-${randomUUID()}@test.local`, telefone: "19999990002", senhaHash: hash, tipo: TipoUsuario.CLIENTE } });
    const [loginAdmin, loginCliente] = await Promise.all([
      app.inject({ method: "POST", url: "/auth/login", payload: { email: admin.email, senha } }),
      app.inject({ method: "POST", url: "/auth/login", payload: { email: cliente.email, senha } }),
    ]);
    const headersAdmin = { cookie: cookie(loginAdmin) };
    const headersCliente = { cookie: cookie(loginCliente) };
    const diaInicio = new Date("2098-11-17T03:00:00.000Z");
    const diaFim = new Date("2098-11-18T03:00:00.000Z");
    const pedido = await app.prisma.pedido.create({ data: {
      usuarioId: cliente.id, tipoEntrega: "RETIRADA", status: "CANCELADO", statusFinanceiro: "REEMBOLSO_PENDENTE",
      metodoPagamento: MetodoPagamento.PIX, nomeClienteHistorico: "Snapshot cliente", telefoneClienteHistorico: "19999990002",
      subtotal: 40, desconto: 5, taxaEntrega: 0, total: 35, criadoEm: new Date("2098-11-17T12:00:00.000Z"),
    } });
    const outra = await app.prisma.pedido.create({ data: {
      tipoEntrega: "ENTREGA", metodoPagamento: MetodoPagamento.DINHEIRO, nomeClienteHistorico: "Outro snapshot", telefoneClienteHistorico: "19999990003",
      subtotal: 10, desconto: 0, taxaEntrega: 3, total: 13, criadoEm: new Date(diaFim.getTime()),
      cepHistorico: "13000000", logradouroHistorico: "Rua teste", numeroHistorico: "1", bairroHistorico: "Centro", cidadeHistorico: "Campinas", estadoHistorico: "SP", distanciaKm: 1,
    } });
    const presencial = await app.prisma.pedido.create({ data: {
      tipoEntrega: "RETIRADA", metodoPagamento: MetodoPagamento.DINHEIRO, nomeClienteHistorico: "Pagamento presencial", telefoneClienteHistorico: "19999990004",
      subtotal: 18, desconto: 0, taxaEntrega: 0, total: 18, criadoEm: new Date("2098-11-17T13:00:00.000Z"),
    } });
    try {
      const tentativa = (numeroTentativa: number, transacaoExterna: string, status: "PAGO" | "PENDENTE", encerradoEm: Date | null) => app.prisma.tentativaPagamento.create({ data: {
        pedidoId: pedido.id, metodo: MetodoPagamento.PIX, numeroTentativa, status, valor: 35,
        chaveIdempotencia: `dashboard:${randomUUID()}`, transacaoExterna,
        criadoEm: new Date("2098-11-17T11:00:00.000Z"), encerradoEm,
      } });
      const tentativa1 = await tentativa(1, "sim-cobranca-1", "PAGO", new Date("2098-11-17T12:30:00.000Z"));
      const tentativa2 = await tentativa(2, "txn-cobranca-2", "PAGO", new Date("2098-11-17T12:40:00.000Z"));
      const eventoSimulado = (await app.simuladorPagamentos!.criarEvento({ tentativaId: tentativa1.id, cenario: "PAGO", idEvento: `evento:${randomUUID()}` }))[0]!;
      await processarEventoPagamento(app.prisma, app.provedorPagamentos!, eventoSimulado);
      await processarEventoPagamento(app.prisma, app.provedorPagamentos!, eventoSimulado);
      expect(await app.prisma.tentativaPagamento.count({ where: { pedidoId: pedido.id, status: "PAGO" } })).toBe(2);
      const tentativaPresencial = await app.prisma.tentativaPagamento.create({ data: {
        pedidoId: presencial.id, metodo: MetodoPagamento.DINHEIRO, numeroTentativa: 1, status: "PENDENTE", valor: 18,
        chaveIdempotencia: `dashboard:${randomUUID()}`, criadoEm: new Date("2098-11-17T13:00:00.000Z"),
      } });
      await confirmarPagamentoPresencial({ prisma: app.prisma, tentativaId: tentativaPresencial.id, adminId: admin.id, resultado: "PAGO", agora: new Date("2098-11-17T13:10:00.000Z") });
      await app.prisma.tentativaPagamento.create({ data: {
        pedidoId: outra.id, metodo: MetodoPagamento.DINHEIRO, numeroTentativa: 1, status: "PENDENTE", valor: 13,
        chaveIdempotencia: `dashboard:${randomUUID()}`, criadoEm: new Date("2098-11-17T12:00:00.000Z"),
      } });
      await app.prisma.reembolso.create({ data: {
        pedidoId: pedido.id, tentativaPagamentoId: tentativa1.id, metodo: "PIX", status: StatusReembolso.CONFIRMADO, valor: 35, valorConfirmado: 35,
        motivo: "Devolução confirmada", chaveIdempotencia: `refund:${randomUUID()}`, iniciadoPorAdminId: admin.id,
        iniciadoEm: new Date("2098-11-17T13:00:00.000Z"), confirmadoPorAdminId: admin.id, confirmadoEm: new Date("2098-11-17T14:00:00.000Z"),
      } });
      await app.prisma.reembolso.create({ data: {
        pedidoId: pedido.id, tentativaPagamentoId: tentativa2.id, metodo: "PIX", status: StatusReembolso.PENDENTE, valor: 35,
        motivo: "Aguardando devolução", chaveIdempotencia: `refund:${randomUUID()}`, iniciadoPorAdminId: admin.id,
        iniciadoEm: new Date("2098-11-17T15:00:00.000Z"),
      } });
      await app.prisma.reembolso.create({ data: {
        pedidoId: presencial.id, tentativaPagamentoId: tentativaPresencial.id, metodo: "DINHEIRO", status: StatusReembolso.CONFIRMADO, valor: 18, valorConfirmado: 18,
        motivo: "Devolução presencial confirmada", chaveIdempotencia: `refund:${randomUUID()}`, iniciadoPorAdminId: admin.id,
        iniciadoEm: new Date("2098-11-17T14:00:00.000Z"), confirmadoPorAdminId: admin.id, confirmadoEm: new Date("2098-11-17T14:30:00.000Z"),
      } });

      expect((await app.inject({ method: "GET", url: "/admin/dashboard?periodo=dia&referencia=2098-11-17" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/admin/dashboard?periodo=dia&referencia=2098-11-17", headers: headersCliente })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/admin/dashboard?periodo=dia&referencia=2026-02-29", headers: headersAdmin })).statusCode).toBe(400);
      const response = await app.inject({ method: "GET", url: "/admin/dashboard?periodo=dia&referencia=2098-11-17", headers: headersAdmin });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        intervalo: { inicio: diaInicio.toISOString(), fimExclusivo: diaFim.toISOString() },
        pedidos: { quantidade: 2, bruto: "53.00", cancelados: { quantidade: 1, bruto: "35.00" }, porModalidade: [{ tipoEntrega: "RETIRADA", quantidade: 2, bruto: "53.00" }], porMetodoEscolhido: expect.arrayContaining([
          { metodoPagamento: "PIX", quantidade: 1, bruto: "35.00" },
          { metodoPagamento: "DINHEIRO", quantidade: 1, bruto: "18.00" },
        ]) },
        pagamentos: {
          recebidos: { quantidade: 1, valor: "18.00" },
          simulados: { quantidade: 1, valor: "35.00" },
          naoClassificados: { quantidade: 1, valor: "35.00" },
        },
        reembolsos: {
          confirmados: { reais: { quantidade: 1, valor: "18.00" }, simulados: { quantidade: 1, valor: "35.00" }, naoClassificados: { quantidade: 0, valor: "0.00" } },
          pendentes: { reais: { quantidade: 0, valor: "0.00" }, simulados: { quantidade: 0, valor: "0.00" }, naoClassificados: { quantidade: 1, valor: "35.00" } },
        },
        resultadoLiquido: "0.00",
      });
      expect(response.json().reembolsos.confirmados.porMetodo).toEqual(expect.arrayContaining([
        { metodo: "PIX", reais: { quantidade: 0, valor: "0.00" }, simulados: { quantidade: 1, valor: "35.00" }, naoClassificados: { quantidade: 0, valor: "0.00" } },
        { metodo: "DINHEIRO", reais: { quantidade: 1, valor: "18.00" }, simulados: { quantidade: 0, valor: "0.00" }, naoClassificados: { quantidade: 0, valor: "0.00" } },
      ]));
      expect(response.json().pagamentos.pendentes).toEqual({ quantidade: 1, valor: "13.00" });
    } finally {
      await app.prisma.pedido.deleteMany({ where: { id: { in: [pedido.id, outra.id, presencial.id] } } });
      await app.prisma.usuario.deleteMany({ where: { id: { in: [admin.id, cliente.id] } } });
    }
  });

  it("conta somente pagamentos atualmente pendentes e não expirados, pela data de criação da tentativa", async () => {
    const app = criarAplicacao(); apps.push(app); await app.ready();
    const senha = "SenhaSegura123!";
    const admin = await app.prisma.usuario.create({ data: {
      nome: "Admin pendências", email: `dashboard-pending-${randomUUID()}@test.local`, telefone: "19999990005",
      senhaHash: await bcrypt.hash(senha, 6), tipo: TipoUsuario.ADMIN,
    } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: admin.email, senha } });
    const headers = { cookie: cookie(login) };
    const partesHoje = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((parte) => [parte.type, parte.value]));
    const referencia = `${partesHoje.year}-${partesHoje.month}-${partesHoje.day}`;
    const consulta = () => app.inject({ method: "GET", url: `/admin/dashboard?periodo=dia&referencia=${referencia}`, headers });
    const antesResponse = await consulta();
    expect(antesResponse.statusCode).toBe(200);
    const antes = antesResponse.json().pagamentos.pendentes;
    const agora = new Date();
    const intervalo = obterIntervaloDashboard("dia", referencia);
    const pedidoCriadoAntes = await app.prisma.pedido.create({ data: {
      tipoEntrega: "RETIRADA", metodoPagamento: MetodoPagamento.DINHEIRO, nomeClienteHistorico: "Pendente cash", telefoneClienteHistorico: "19999990005",
      subtotal: 11, desconto: 0, taxaEntrega: 0, total: 11, criadoEm: new Date(intervalo.inicio.getTime() - 86_400_000),
    } });
    const pedidoPixVencido = await app.prisma.pedido.create({ data: {
      tipoEntrega: "RETIRADA", metodoPagamento: MetodoPagamento.PIX, nomeClienteHistorico: "PIX vencido", telefoneClienteHistorico: "19999990006",
      subtotal: 22, desconto: 0, taxaEntrega: 0, total: 22, criadoEm: agora,
    } });
    const pedidoPixIncompleto = await app.prisma.pedido.create({ data: {
      tipoEntrega: "RETIRADA", metodoPagamento: MetodoPagamento.PIX, nomeClienteHistorico: "PIX incompleto", telefoneClienteHistorico: "19999990007",
      subtotal: 33, desconto: 0, taxaEntrega: 0, total: 33, criadoEm: agora,
    } });
    const pedidoPixAtivo = await app.prisma.pedido.create({ data: {
      tipoEntrega: "RETIRADA", metodoPagamento: MetodoPagamento.PIX, nomeClienteHistorico: "PIX ativo", telefoneClienteHistorico: "19999990009",
      subtotal: 16, desconto: 0, taxaEntrega: 0, total: 16, criadoEm: agora,
    } });
    const pedidoFalho = await app.prisma.pedido.create({ data: {
      tipoEntrega: "RETIRADA", metodoPagamento: MetodoPagamento.PIX, nomeClienteHistorico: "PIX falho", telefoneClienteHistorico: "19999990008",
      subtotal: 44, desconto: 0, taxaEntrega: 0, total: 44, criadoEm: agora,
    } });
    try {
      await app.prisma.tentativaPagamento.create({ data: {
        pedidoId: pedidoCriadoAntes.id, metodo: MetodoPagamento.DINHEIRO, numeroTentativa: 1, status: "PENDENTE", valor: 11,
        chaveIdempotencia: `pending:${randomUUID()}`, criadoEm: agora,
      } });
      const expiracao = new Date(agora.getTime() - 60_000);
      const confirmacao = new Date(expiracao.getTime() - 300_000);
      await app.prisma.tentativaPagamento.create({ data: {
        pedidoId: pedidoPixVencido.id, metodo: MetodoPagamento.PIX, numeroTentativa: 1, status: "PENDENTE", valor: 22,
        chaveIdempotencia: `pending:${randomUUID()}`, criadoEm: agora, confirmadaEm: confirmacao, expiraEm: expiracao,
      } });
      await app.prisma.tentativaPagamento.create({ data: {
        pedidoId: pedidoPixIncompleto.id, metodo: MetodoPagamento.PIX, numeroTentativa: 1, status: "PENDENTE", valor: 33,
        chaveIdempotencia: `pending:${randomUUID()}`, criadoEm: agora,
      } });
      const confirmacaoAtiva = new Date(agora.getTime() - 60_000);
      await app.prisma.tentativaPagamento.create({ data: {
        pedidoId: pedidoPixAtivo.id, metodo: MetodoPagamento.PIX, numeroTentativa: 1, status: "PENDENTE", valor: 16,
        chaveIdempotencia: `pending:${randomUUID()}`, criadoEm: agora, confirmadaEm: confirmacaoAtiva,
        expiraEm: new Date(confirmacaoAtiva.getTime() + 300_000),
      } });
      await app.prisma.tentativaPagamento.create({ data: {
        pedidoId: pedidoFalho.id, metodo: MetodoPagamento.PIX, numeroTentativa: 1, status: "FALHOU", valor: 44,
        chaveIdempotencia: `pending:${randomUUID()}`, criadoEm: agora, encerradoEm: agora,
      } });
      const depoisResponse = await consulta();
      expect(depoisResponse.statusCode).toBe(200);
      expect(depoisResponse.json().pagamentos.pendentes).toEqual({ quantidade: antes.quantidade + 2, valor: new Prisma.Decimal(antes.valor).add(27).toFixed(2) });
    } finally {
      await app.prisma.pedido.deleteMany({ where: { id: { in: [pedidoCriadoAntes.id, pedidoPixVencido.id, pedidoPixIncompleto.id, pedidoPixAtivo.id, pedidoFalho.id] } } });
      await app.prisma.usuario.delete({ where: { id: admin.id } });
    }
  });
});
