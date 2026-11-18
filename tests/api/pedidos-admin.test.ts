import { createHash, randomBytes, randomUUID } from "node:crypto";
import { MetodoPagamento, Prisma, StatusPedido, TipoEntrega, TipoUsuario } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

function cookie(response: { headers: Record<string, unknown> }) {
  const setCookie = response.headers["set-cookie"];
  const first = typeof setCookie === "string" ? setCookie : Array.isArray(setCookie) ? setCookie[0] : null;
  if (typeof first !== "string") throw new Error("Cookie ausente no login de teste.");
  return first.split(";")[0]!;
}

describe("Sprint 15 — Administração, cancelamentos e reembolsos", () => {
  const apps: ReturnType<typeof criarAplicacao>[] = [];
  afterAll(async () => Promise.all(apps.map((app) => app.close())));

  async function ambiente() {
    const app = criarAplicacao();
    apps.push(app);
    await app.ready();
    const senha = "SenhaSegura123!";
    const senhaHash = await bcrypt.hash(senha, 6);
    const admin = await app.prisma.usuario.create({
      data: { nome: "Admin Sprint 15", email: `admin-${randomUUID()}@test.local`, telefone: "19999990001", senhaHash, tipo: TipoUsuario.ADMIN },
    });
    const cliente = await app.prisma.usuario.create({
      data: { nome: "Cliente Sprint 15", email: `cliente-${randomUUID()}@test.local`, telefone: "19999990002", senhaHash, tipo: TipoUsuario.CLIENTE },
    });
    const [loginAdmin, loginCliente] = await Promise.all([
      app.inject({ method: "POST", url: "/auth/login", payload: { email: admin.email, senha } }),
      app.inject({ method: "POST", url: "/auth/login", payload: { email: cliente.email, senha } }),
    ]);
    return { app, admin, cliente, cookieAdmin: cookie(loginAdmin), cookieCliente: cookie(loginCliente) };
  }

  async function pedido(
    app: ReturnType<typeof criarAplicacao>,
    overrides: Partial<{
      status: StatusPedido;
      tipoEntrega: TipoEntrega;
      metodoPagamento: MetodoPagamento;
      usuarioId: string;
      tokenAcompanhamentoHash: string;
      statusFinanceiro: "PENDENTE" | "PAGO" | "REEMBOLSO_PENDENTE" | "REEMBOLSADO";
    }> = {},
  ) {
    const tipoEntrega = overrides.tipoEntrega ?? TipoEntrega.RETIRADA;
    return app.prisma.pedido.create({
      data: {
        tipoEntrega,
        metodoPagamento: MetodoPagamento.PIX,
        nomeClienteHistorico: "Cliente histórico",
        telefoneClienteHistorico: "19999990002",
        subtotal: new Prisma.Decimal("25.00"),
        desconto: 0,
        taxaEntrega: 0,
        total: new Prisma.Decimal("25.00"),
        ...(tipoEntrega === TipoEntrega.ENTREGA
          ? {
              cepHistorico: "13000000",
              logradouroHistorico: "Rua de teste",
              numeroHistorico: "10",
              bairroHistorico: "Centro",
              cidadeHistorico: "Campinas",
              estadoHistorico: "SP",
              distanciaKm: new Prisma.Decimal("1.00"),
            }
          : {}),
        ...overrides,
      },
    });
  }

  async function tentativaPaga(
    app: ReturnType<typeof criarAplicacao>,
    pedidoId: string,
    numeroTentativa = 1,
    metodo: MetodoPagamento = MetodoPagamento.PIX,
    valor = "25.00",
  ) {
    const agora = new Date();
    return app.prisma.tentativaPagamento.create({
      data: {
        pedidoId,
        metodo,
        numeroTentativa,
        status: "PAGO",
        valor: new Prisma.Decimal(valor),
        chaveIdempotencia: `admin-test:${randomUUID()}`,
        identificadorExterno: `charge-${randomUUID()}`,
        transacaoExterna: `txn-${randomUUID()}`,
        confirmadaEm: metodo === MetodoPagamento.PIX ? agora : null,
        expiraEm: metodo === MetodoPagamento.PIX ? new Date(agora.getTime() + 5 * 60_000) : null,
        encerradoEm: agora,
      },
    });
  }

  it("protege consultas administrativas, filtra e retorna snapshots sem hash do token", async () => {
    const { app, admin, cliente, cookieAdmin, cookieCliente } = await ambiente();
    const token = randomUUID().repeat(2).slice(0, 43);
    const own = await pedido(app, { tokenAcompanhamentoHash: hashToken(token) });
    try {
      expect((await app.inject({ method: "GET", url: "/admin/pedidos" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/admin/pedidos", headers: { cookie: cookieCliente } })).statusCode).toBe(403);
      const lista = await app.inject({ method: "GET", url: "/admin/pedidos?status=PENDENTE&pagina=1&limite=10", headers: { cookie: cookieAdmin } });
      expect(lista.statusCode).toBe(200);
      expect(lista.json().pedidos.some((row: { id: string }) => row.id === own.id)).toBe(true);
      const detalhe = await app.inject({ method: "GET", url: `/admin/pedidos/${own.id}`, headers: { cookie: cookieAdmin } });
      expect(detalhe.statusCode).toBe(200);
      expect(detalhe.json()).toMatchObject({ id: own.id, subtotal: "25.00", statusFinanceiro: "PENDENTE" });
      expect(JSON.stringify(detalhe.json())).not.toContain("tokenAcompanhamentoHash");
      expect(JSON.stringify(detalhe.json())).not.toContain(hashToken(token));
    } finally {
      await app.prisma.pedido.delete({ where: { id: own.id } });
      await app.prisma.usuario.deleteMany({ where: { id: { in: [cliente.id] } } });
      await app.prisma.usuario.delete({ where: { id: admin.id } });
    }
  });

  it("aplica a matriz de transições e bloqueia a conclusão incompatível com a modalidade", { timeout: 20000 }, async () => {
    const { app, admin, cliente, cookieAdmin } = await ambiente();
    const casos: [StatusPedido, StatusPedido, TipoEntrega][] = [
      [StatusPedido.PENDENTE, StatusPedido.CONFIRMADO, TipoEntrega.RETIRADA],
      [StatusPedido.PENDENTE, StatusPedido.CANCELADO, TipoEntrega.RETIRADA],
      [StatusPedido.CONFIRMADO, StatusPedido.PREPARANDO, TipoEntrega.RETIRADA],
      [StatusPedido.CONFIRMADO, StatusPedido.CANCELADO, TipoEntrega.RETIRADA],
      [StatusPedido.PREPARANDO, StatusPedido.PRONTO, TipoEntrega.RETIRADA],
      [StatusPedido.PREPARANDO, StatusPedido.CANCELADO, TipoEntrega.RETIRADA],
      [StatusPedido.PRONTO, StatusPedido.SAIU_PARA_ENTREGA, TipoEntrega.ENTREGA],
      [StatusPedido.PRONTO, StatusPedido.CONCLUIDO, TipoEntrega.RETIRADA],
      [StatusPedido.PRONTO, StatusPedido.CANCELADO, TipoEntrega.ENTREGA],
      [StatusPedido.SAIU_PARA_ENTREGA, StatusPedido.CONCLUIDO, TipoEntrega.ENTREGA],
      [StatusPedido.SAIU_PARA_ENTREGA, StatusPedido.CANCELADO, TipoEntrega.ENTREGA],
    ];
    const criados: string[] = [];
    try {
      for (const [statusAtual, status, tipoEntrega] of casos) {
        const row = await pedido(app, { status: statusAtual, tipoEntrega });
        criados.push(row.id);
        const resposta = await app.inject({
          method: "PATCH",
          url: `/admin/pedidos/${row.id}/status`,
          headers: { cookie: cookieAdmin },
          payload: { statusAtualEsperado: statusAtual, status, ...(status === StatusPedido.CANCELADO ? { motivo: "Cancelamento administrativo." } : {}) },
        });
        expect(resposta.statusCode).toBe(200);
        expect(resposta.json().status).toBe(status);
        const salvo = await app.prisma.pedido.findUniqueOrThrow({ where: { id: row.id } });
        expect(salvo.historicoStatus).toMatchObject([{ tipo: "TRANSICAO_STATUS_ADMINISTRATIVA", statusAnterior: statusAtual, status }]);
      }

      for (const [statusAtual, proximo, tipoEntrega] of [
        [StatusPedido.PRONTO, StatusPedido.CONCLUIDO, TipoEntrega.ENTREGA],
        [StatusPedido.PRONTO, StatusPedido.SAIU_PARA_ENTREGA, TipoEntrega.RETIRADA],
        [StatusPedido.PENDENTE, StatusPedido.PREPARANDO, TipoEntrega.RETIRADA],
        [StatusPedido.CONCLUIDO, StatusPedido.CANCELADO, TipoEntrega.RETIRADA],
        [StatusPedido.CANCELADO, StatusPedido.PENDENTE, TipoEntrega.RETIRADA],
      ] as const) {
        const row = await pedido(app, { status: statusAtual, tipoEntrega });
        criados.push(row.id);
        const resposta = await app.inject({
          method: "PATCH",
          url: `/admin/pedidos/${row.id}/status`,
          headers: { cookie: cookieAdmin },
          payload: { statusAtualEsperado: statusAtual, status: proximo, ...(proximo === StatusPedido.CANCELADO ? { motivo: "Cancelamento administrativo." } : {}) },
        });
        expect(resposta.statusCode).toBe(409);
      }

      const race = await pedido(app);
      criados.push(race.id);
      const decisoes = await Promise.all([
        app.inject({ method: "PATCH", url: `/admin/pedidos/${race.id}/status`, headers: { cookie: cookieAdmin }, payload: { statusAtualEsperado: "PENDENTE", status: "CONFIRMADO" } }),
        app.inject({ method: "PATCH", url: `/admin/pedidos/${race.id}/status`, headers: { cookie: cookieAdmin }, payload: { statusAtualEsperado: "PENDENTE", status: "CANCELADO", motivo: "Cancelamento concorrente." } }),
      ]);
      expect(decisoes.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    } finally {
      await app.prisma.pedido.deleteMany({ where: { id: { in: criados } } });
      await app.prisma.usuario.deleteMany({ where: { id: { in: [admin.id, cliente.id] } } });
    }
  });

  it("registra solicitação, decide cancelamento sem reembolso automático e finaliza PIX manualmente", async () => {
    const { app, admin, cliente, cookieAdmin, cookieCliente } = await ambiente();
    const row = await pedido(app, { usuarioId: cliente.id, status: StatusPedido.PREPARANDO, statusFinanceiro: "PAGO" });
    const pagamento = await tentativaPaga(app, row.id);
      const pagamentoOriginal = await app.prisma.tentativaPagamento.findUniqueOrThrow({ where: { id: pagamento.id } });
    try {
      const solicitacao = await app.inject({
        method: "POST",
        url: `/pedidos/${row.id}/solicitacoes-cancelamento`,
        headers: { cookie: cookieCliente },
        payload: { motivo: "Não conseguirei receber o pedido agora." },
      });
      expect(solicitacao.statusCode).toBe(200);
      expect(solicitacao.json().solicitacaoId).toBeTruthy();
      expect((await app.prisma.pedido.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PREPARANDO");

      const decisao = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/solicitacoes-cancelamento/${solicitacao.json().solicitacaoId}`,
        headers: { cookie: cookieAdmin },
        payload: { decisao: "APROVADA", justificativa: "Solicitação confirmada." },
      });
      expect(decisao.statusCode).toBe(200);
      expect(decisao.json()).toMatchObject({ decisao: "APROVADA", status: "CANCELADO", statusFinanceiro: "REEMBOLSO_PENDENTE" });
      const decisaoRepetida = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/solicitacoes-cancelamento/${solicitacao.json().solicitacaoId}`,
        headers: { cookie: cookieAdmin },
        payload: { decisao: "APROVADA", justificativa: "Solicitação confirmada." },
      });
      expect(decisaoRepetida.statusCode).toBe(200);
      expect(decisaoRepetida.json().repetida).toBe(true);
      const decisaoIncompativel = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/solicitacoes-cancelamento/${solicitacao.json().solicitacaoId}`,
        headers: { cookie: cookieAdmin },
        payload: { decisao: "REJEITADA" },
      });
      expect(decisaoIncompativel.statusCode).toBe(409);
      expect(await app.prisma.reembolso.count({ where: { pedidoId: row.id } })).toBe(0);
      const confirmacaoSemInicio = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/reembolsos/${randomUUID()}`,
        headers: { cookie: cookieAdmin, "idempotency-key": randomUUID() },
        payload: { valorConfirmado: "25.00" },
      });
      expect(confirmacaoSemInicio.statusCode).toBe(404);
      const aposCancelamento = await app.prisma.tentativaPagamento.findUniqueOrThrow({ where: { id: pagamento.id } });
      expect(aposCancelamento).toMatchObject({ status: pagamentoOriginal.status, transacaoExterna: pagamentoOriginal.transacaoExterna });
      expect(aposCancelamento.auditoria).toEqual(pagamentoOriginal.auditoria);
      expect((await app.prisma.pedido.findUniqueOrThrow({ where: { id: row.id } })).historicoStatus).toContainEqual(
        expect.objectContaining({ tipo: "REEMBOLSO_NECESSARIO", tentativaId: pagamento.id, adminId: admin.id }),
      );

      const chave = randomUUID();
      const inicio = await app.inject({
        method: "POST",
        url: `/admin/pedidos/${row.id}/reembolsos`,
        headers: { cookie: cookieAdmin, "idempotency-key": chave },
        payload: { tentativaId: pagamento.id, motivo: "Devolução após cancelamento." },
      });
      expect(inicio.statusCode).toBe(201);
      expect(inicio.json()).toMatchObject({ status: "PENDENTE", metodo: "PIX", valor: "25.00" });
      const replay = await app.inject({
        method: "POST",
        url: `/admin/pedidos/${row.id}/reembolsos`,
        headers: { cookie: cookieAdmin, "idempotency-key": chave },
        payload: { tentativaId: pagamento.id, motivo: "Devolução após cancelamento." },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().id).toBe(inicio.json().id);

      const parcial = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/reembolsos/${inicio.json().id}`,
        headers: { cookie: cookieAdmin, "idempotency-key": randomUUID() },
        payload: { valorConfirmado: "12.50" },
      });
      expect(parcial.statusCode).toBe(400);

      const confirmacaoKey = randomUUID();
      const confirmacao = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/reembolsos/${inicio.json().id}`,
        headers: { cookie: cookieAdmin, "idempotency-key": confirmacaoKey },
        payload: { valorConfirmado: "25.00", identificadorExterno: "DEVOLUCAO-001" },
      });
      expect(confirmacao.statusCode).toBe(200);
      expect(confirmacao.json()).toMatchObject({ status: "CONFIRMADO", valorConfirmado: "25.00", confirmadoPorAdminId: admin.id });
      const [confirmacaoConcorrente, repeticaoConfirmacao] = await Promise.all([
        app.inject({
          method: "PATCH",
          url: `/admin/pedidos/${row.id}/reembolsos/${inicio.json().id}`,
          headers: { cookie: cookieAdmin, "idempotency-key": confirmacaoKey },
          payload: { valorConfirmado: "25.00", identificadorExterno: "DEVOLUCAO-001" },
        }),
        app.inject({
          method: "PATCH",
          url: `/admin/pedidos/${row.id}/reembolsos/${inicio.json().id}`,
          headers: { cookie: cookieAdmin, "idempotency-key": confirmacaoKey },
          payload: { valorConfirmado: "25.00", identificadorExterno: "DEVOLUCAO-001" },
        }),
      ]);
      expect(confirmacaoConcorrente.statusCode).toBe(200);
      expect(repeticaoConfirmacao.statusCode).toBe(200);
      expect((await app.prisma.pedido.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("CANCELADO");
      expect((await app.prisma.pedido.findUniqueOrThrow({ where: { id: row.id } })).statusFinanceiro).toBe("REEMBOLSADO");

      const duplicado = await app.inject({
        method: "POST",
        url: `/admin/pedidos/${row.id}/reembolsos`,
        headers: { cookie: cookieAdmin, "idempotency-key": randomUUID() },
        payload: { tentativaId: pagamento.id, motivo: "Segunda devolução." },
      });
      expect(duplicado.statusCode).toBe(409);
    } finally {
      await app.prisma.pedido.delete({ where: { id: row.id } });
      await app.prisma.usuario.delete({ where: { id: cliente.id } });
      await app.prisma.usuario.delete({ where: { id: admin.id } });
    }
  });

  it("cancela PIX não pago sem reembolso e sem alterar a tentativa original", async () => {
    const { app, admin, cliente, cookieAdmin } = await ambiente();
    const row = await pedido(app);
    const confirmadaEm = new Date();
    const tentativa = await app.prisma.tentativaPagamento.create({
      data: {
        pedidoId: row.id,
        metodo: MetodoPagamento.PIX,
        numeroTentativa: 1,
        status: "PENDENTE",
        valor: new Prisma.Decimal("25.00"),
        chaveIdempotencia: `admin-test:${randomUUID()}`,
        identificadorExterno: `charge:${randomUUID()}`,
        confirmadaEm,
        expiraEm: new Date(confirmadaEm.getTime() + 300_000),
      },
    });
    try {
      const antes = await app.prisma.tentativaPagamento.findUniqueOrThrow({ where: { id: tentativa.id } });
      const reembolsoSemPagamento = await app.inject({
        method: "POST",
        url: `/admin/pedidos/${row.id}/reembolsos`,
        headers: { cookie: cookieAdmin, "idempotency-key": randomUUID() },
        payload: { tentativaId: tentativa.id, motivo: "Tentativa ainda pendente." },
      });
      expect(reembolsoSemPagamento.statusCode).toBe(409);
      const resposta = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/status`,
        headers: { cookie: cookieAdmin },
        payload: { statusAtualEsperado: "PENDENTE", status: "CANCELADO", motivo: "Cliente não pagou." },
      });
      expect(resposta.statusCode).toBe(200);
      const pedidoCancelado = await app.prisma.pedido.findUniqueOrThrow({ where: { id: row.id } });
      const depois = await app.prisma.tentativaPagamento.findUniqueOrThrow({ where: { id: tentativa.id } });
      expect(pedidoCancelado.status).toBe("CANCELADO");
      expect(pedidoCancelado.statusFinanceiro).toBe("PENDENTE");
      expect(depois).toMatchObject({ status: antes.status, transacaoExterna: antes.transacaoExterna, expiraEm: antes.expiraEm });
      expect(depois.auditoria).toEqual(antes.auditoria);
      expect(await app.prisma.reembolso.count({ where: { pedidoId: row.id } })).toBe(0);
    } finally {
      await app.prisma.pedido.delete({ where: { id: row.id } });
      await app.prisma.usuario.deleteMany({ where: { id: { in: [admin.id, cliente.id] } } });
    }
  });

  it("confirma pagamento presencial só por ADMIN, valida vínculo e permite replay idempotente", async () => {
    const { app, admin, cliente, cookieAdmin, cookieCliente } = await ambiente();
    const row = await pedido(app, { usuarioId: cliente.id, metodoPagamento: MetodoPagamento.CREDITO });
    const tentativa = await app.prisma.tentativaPagamento.create({
      data: {
        pedidoId: row.id,
        metodo: MetodoPagamento.CREDITO,
        numeroTentativa: 1,
        valor: 25,
        chaveIdempotencia: `admin-test:${randomUUID()}`,
      },
    });
    const outro = await pedido(app);
    try {
      const clienteBloqueado = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/tentativas-pagamento/${tentativa.id}`,
        headers: { cookie: cookieCliente },
        payload: { resultado: "PAGO" },
      });
      expect(clienteBloqueado.statusCode).toBe(403);

      const divergente = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${outro.id}/tentativas-pagamento/${tentativa.id}`,
        headers: { cookie: cookieAdmin },
        payload: { resultado: "PAGO" },
      });
      expect(divergente.statusCode).toBe(404);

      const confirmacao = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/tentativas-pagamento/${tentativa.id}`,
        headers: { cookie: cookieAdmin },
        payload: { resultado: "PAGO" },
      });
      const replay = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/tentativas-pagamento/${tentativa.id}`,
        headers: { cookie: cookieAdmin },
        payload: { resultado: "PAGO" },
      });
      expect(confirmacao.statusCode).toBe(200);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().id).toBe(confirmacao.json().id);
      expect((await app.prisma.pedido.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(StatusPedido.PENDENTE);

      const conflito = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/tentativas-pagamento/${tentativa.id}`,
        headers: { cookie: cookieAdmin },
        payload: { resultado: "RECUSADO" },
      });
      expect(conflito.statusCode).toBe(409);
    } finally {
      await app.prisma.pedido.deleteMany({ where: { id: { in: [row.id, outro.id] } } });
      await app.prisma.usuario.deleteMany({ where: { id: { in: [admin.id, cliente.id] } } });
    }
  });

  it("rejeita solicitação de cancelamento de visitante sem alterar o pedido", async () => {
    const { app, admin, cookieAdmin } = await ambiente();
    const token = randomBytes(32).toString("base64url");
    const row = await pedido(app, { tokenAcompanhamentoHash: hashToken(token) });
    try {
      const solicitacao = await app.inject({
        method: "POST",
        url: `/pedidos/${row.id}/solicitacoes-cancelamento`,
        headers: { "x-pedido-token": token },
        payload: { motivo: "O cliente não estará no endereço." },
      });
      expect(solicitacao.statusCode).toBe(200);
      const resposta = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${row.id}/solicitacoes-cancelamento/${solicitacao.json().solicitacaoId}`,
        headers: { cookie: cookieAdmin },
        payload: { decisao: "REJEITADA", justificativa: "O pedido já está sendo preparado." },
      });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toMatchObject({ decisao: "REJEITADA", status: "PENDENTE" });
      const salvo = await app.prisma.pedido.findUniqueOrThrow({ where: { id: row.id } });
      expect(salvo.status).toBe("PENDENTE");
      expect(salvo.historicoStatus).toMatchObject([
        { tipo: "SOLICITACAO_CANCELAMENTO", solicitante: "VISITANTE", estado: "PENDENTE" },
        { tipo: "DECISAO_SOLICITACAO_CANCELAMENTO", decisao: "REJEITADA", adminId: admin.id },
      ]);
    } finally {
      await app.prisma.pedido.delete({ where: { id: row.id } });
      await app.prisma.usuario.delete({ where: { id: admin.id } });
    }
  });

  it("permite vários reembolsos distintos no mesmo pedido e registra devolução presencial", async () => {
    const { app, admin, cliente, cookieAdmin } = await ambiente();
    const row = await pedido(app, { status: StatusPedido.CANCELADO, statusFinanceiro: "REEMBOLSO_PENDENTE" });
    const primeira = await tentativaPaga(app, row.id, 1, MetodoPagamento.PIX);
    const segunda = await tentativaPaga(app, row.id, 2, MetodoPagamento.PIX);
    const dinheiroPedido = await pedido(app, { metodoPagamento: MetodoPagamento.DINHEIRO, statusFinanceiro: "PAGO" });
    const dinheiro = await tentativaPaga(app, dinheiroPedido.id, 1, MetodoPagamento.DINHEIRO);
    try {
      const [r1, r1Concorrente, r2] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/admin/pedidos/${row.id}/reembolsos`,
          headers: { cookie: cookieAdmin, "idempotency-key": randomUUID() },
          payload: { tentativaId: primeira.id, motivo: "Reembolso PIX." },
        }),
        app.inject({
          method: "POST",
          url: `/admin/pedidos/${row.id}/reembolsos`,
          headers: { cookie: cookieAdmin, "idempotency-key": randomUUID() },
          payload: { tentativaId: primeira.id, motivo: "Reembolso PIX concorrente." },
        }),
        app.inject({
          method: "POST",
          url: `/admin/pedidos/${row.id}/reembolsos`,
          headers: { cookie: cookieAdmin, "idempotency-key": randomUUID() },
          payload: { tentativaId: segunda.id, motivo: "Segundo reembolso PIX." },
        }),
      ]);
      expect([r1.statusCode, r1Concorrente.statusCode, r2.statusCode].sort()).toEqual([201, 201, 409]);
      expect(await app.prisma.reembolso.count({ where: { pedidoId: row.id } })).toBe(2);

      const devolucao = await app.inject({
        method: "POST",
        url: `/admin/pedidos/${dinheiroPedido.id}/devolucoes-presenciais`,
        headers: { cookie: cookieAdmin, "idempotency-key": randomUUID() },
        payload: { tentativaId: dinheiro.id, motivo: "Dinheiro devolvido ao cliente." },
      });
      expect(devolucao.statusCode).toBe(201);
      expect(devolucao.json()).toMatchObject({ metodo: "DINHEIRO", status: "CONFIRMADO", valorConfirmado: "25.00", iniciadoPorAdminId: admin.id, confirmadoPorAdminId: admin.id });

      const pixEmDevolucaoPresencial = await app.inject({
        method: "POST",
        url: `/admin/pedidos/${row.id}/devolucoes-presenciais`,
        headers: { cookie: cookieAdmin, "idempotency-key": randomUUID() },
        payload: { tentativaId: primeira.id, motivo: "Não deve aceitar PIX nesta operação." },
      });
      expect(pixEmDevolucaoPresencial.statusCode).toBe(409);
    } finally {
      await app.prisma.pedido.deleteMany({ where: { id: { in: [row.id, dinheiroPedido.id] } } });
      await app.prisma.usuario.deleteMany({ where: { id: { in: [admin.id, cliente.id] } } });
    }
  });
});
