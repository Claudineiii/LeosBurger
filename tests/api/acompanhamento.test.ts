import { createHash, randomUUID } from "node:crypto";
import { Prisma, StatusFinanceiroPedido, StatusPedido, TipoUsuario } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it, vi } from "vitest";
import { criarAplicacao } from "../../src/app.js";
import { limparLimitesPagamentoParaTeste, limitarCobranca } from "../../src/services/pagamentos/limites.js";

function cookieDaResposta(cabecalho: unknown) {
  const valor =
    typeof cabecalho === "string"
      ? cabecalho
      : Array.isArray(cabecalho) && typeof cabecalho[0] === "string"
        ? cabecalho[0]
        : undefined;
  if (!valor) {
    throw new Error("Resposta sem cookie.");
  }
  return valor.split(";")[0] ?? "";
}

describe("Sprint 14 — Histórico de cliente e acompanhamento de visitante", () => {
  const apps: ReturnType<typeof criarAplicacao>[] = [];

  afterAll(async () => {
    limparLimitesPagamentoParaTeste();
    await Promise.all(apps.map((app) => app.close()));
  });

  async function criarAmbiente() {
    const app = criarAplicacao();
    apps.push(app);
    await app.ready();

    const senha = "SenhaSegura123!";
    const senhaHash = await bcrypt.hash(senha, 6);

    const cliente1 = await app.prisma.usuario.create({
      data: {
        nome: "Cliente Um",
        email: `cliente1-${randomUUID()}@example.test`,
        telefone: "19999991111",
        senhaHash,
        tipo: TipoUsuario.CLIENTE,
      },
    });

    const cliente2 = await app.prisma.usuario.create({
      data: {
        nome: "Cliente Dois",
        email: `cliente2-${randomUUID()}@example.test`,
        telefone: "19999992222",
        senhaHash,
        tipo: TipoUsuario.CLIENTE,
      },
    });

    const admin = await app.prisma.usuario.create({
      data: {
        nome: "Admin Teste",
        email: `admin-${randomUUID()}@example.test`,
        telefone: "19999993333",
        senhaHash,
        tipo: TipoUsuario.ADMIN,
      },
    });

    const categoria = await app.prisma.categoria.create({
      data: { nome: `Cat ${randomUUID()}` },
    });

    const item = await app.prisma.item.create({
      data: {
        categoriaId: categoria.id,
        nome: "Hambúrguer Clássico",
        preco: new Prisma.Decimal("25.00"),
      },
    });

    const loginCliente1 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: cliente1.email, senha },
    });
    const cookieCliente1 = cookieDaResposta(loginCliente1.headers["set-cookie"]);

    const loginCliente2 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: cliente2.email, senha },
    });
    const cookieCliente2 = cookieDaResposta(loginCliente2.headers["set-cookie"]);

    const loginAdmin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: admin.email, senha },
    });
    const cookieAdmin = cookieDaResposta(loginAdmin.headers["set-cookie"]);

    return {
      app,
      cliente1,
      cliente2,
      admin,
      cookieCliente1,
      cookieCliente2,
      cookieAdmin,
      categoria,
      item,
    };
  }

  describe("1. Histórico de cliente autenticado (GET /pedidos e GET /pedidos/:id)", () => {
    it("exige autenticação por cookie JWT e rejeita requisições anônimas ou de ADMIN", async () => {
      const { app, cookieAdmin } = await criarAmbiente();

      const respostaAnonima = await app.inject({
        method: "GET",
        url: "/pedidos",
      });
      expect(respostaAnonima.statusCode).toBe(401);
      expect(respostaAnonima.json().error).toBe("UNAUTHORIZED");

      const respostaAdmin = await app.inject({
        method: "GET",
        url: "/pedidos",
        headers: { cookie: cookieAdmin },
      });
      expect(respostaAdmin.statusCode).toBe(403);
      expect(respostaAdmin.json().error).toBe("FORBIDDEN");
    });

    it("retorna lista vazia quando o cliente não possui pedidos", async () => {
      const { app, cookieCliente1 } = await criarAmbiente();

      const resposta = await app.inject({
        method: "GET",
        url: "/pedidos",
        headers: { cookie: cookieCliente1 },
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({
        pagina: 1,
        limite: 20,
        total: 0,
        totalPaginas: 0,
        pedidos: [],
      });
    });

    it("lista somente os próprios pedidos ordenados decrescente por data com desempate estável", async () => {
      const { app, cookieCliente1, item } = await criarAmbiente();

      // Criar 2 pedidos para o cliente 1
      const res1 = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: {
          cookie: cookieCliente1,
          "idempotency-key": randomUUID(),
        },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "CREDITO",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: {
          cookie: cookieCliente1,
          "idempotency-key": randomUUID(),
        },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "DEBITO",
          itens: [{ itemId: item.id, quantidade: 2 }],
        },
      });
      expect(res2.statusCode).toBe(201);

      const lista = await app.inject({
        method: "GET",
        url: "/pedidos",
        headers: { cookie: cookieCliente1 },
      });

      expect(lista.statusCode).toBe(200);
      const corpo = lista.json();
      expect(corpo.total).toBe(2);
      expect(corpo.pedidos).toHaveLength(2);
      // Mais recente primeiro
      expect(corpo.pedidos[0].numero).toBe(res2.json().pedido.numero);
      expect(corpo.pedidos[1].numero).toBe(res1.json().pedido.numero);
      expect(corpo.pedidos[0].statusFinanceiro).toBeDefined();
      expect(corpo.pedidos[0].status).toBeDefined();
    });

    it("consulta detalhe de pedido próprio e rejeita pedido de terceiro ou inexistente com 404 indistinguível", async () => {
      const { app, cookieCliente1, cookieCliente2, item } = await criarAmbiente();

      // Cliente 1 cria pedido
      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: {
          cookie: cookieCliente1,
          "idempotency-key": randomUUID(),
        },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const pedidoId = criacao.json().pedido.id;

      // Cliente 1 consulta próprio pedido: 200
      const detalheProprio = await app.inject({
        method: "GET",
        url: `/pedidos/${pedidoId}`,
        headers: { cookie: cookieCliente1 },
      });
      expect(detalheProprio.statusCode).toBe(200);
      expect(detalheProprio.json().id).toBe(pedidoId);
      expect(detalheProprio.json().statusFinanceiro).toBe("PENDENTE");
      expect(detalheProprio.json().status).toBe("PENDENTE");
      expect(Array.isArray(detalheProprio.json().historicoStatus)).toBe(true);
      expect(Array.isArray(detalheProprio.json().tentativasPagamento)).toBe(true);

      // Cliente 2 tenta consultar pedido de Cliente 1: 404
      const detalheTerceiro = await app.inject({
        method: "GET",
        url: `/pedidos/${pedidoId}`,
        headers: { cookie: cookieCliente2 },
      });
      expect(detalheTerceiro.statusCode).toBe(404);
      expect(detalheTerceiro.json().error).toBe("NOT_FOUND");

      // Consulta UUID aleatório inexistente: 404 idêntico
      const detalheInexistente = await app.inject({
        method: "GET",
        url: `/pedidos/${randomUUID()}`,
        headers: { cookie: cookieCliente1 },
      });
      expect(detalheInexistente.statusCode).toBe(404);
      expect(detalheInexistente.json()).toEqual(detalheTerceiro.json());
    });

    it("preserva snapshots históricos mesmo se preço ou nome do item mudarem no catálogo", async () => {
      const { app, cookieCliente1, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: {
          cookie: cookieCliente1,
          "idempotency-key": randomUUID(),
        },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "CREDITO",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const pedidoId = criacao.json().pedido.id;

      // Altera item no catálogo
      await app.prisma.item.update({
        where: { id: item.id },
        data: { nome: "Hambúrguer Modificado", preco: new Prisma.Decimal("99.90") },
      });

      // Detalhe do pedido continua com valores originais
      const detalhe = await app.inject({
        method: "GET",
        url: `/pedidos/${pedidoId}`,
        headers: { cookie: cookieCliente1 },
      });
      expect(detalhe.statusCode).toBe(200);
      expect(detalhe.json().itens[0].nome).toBe("Hambúrguer Clássico");
      expect(detalhe.json().itens[0].precoUnitario).toBe("25.00");
      expect(detalhe.json().total).toBe("25.00");
    });
  });

  describe("2. Acompanhamento de visitante (GET /pedidos/acompanhamento)", () => {
    it("retorna 400 se o token for enviado na query string ou URL", async () => {
      const { app } = await criarAmbiente();

      const resposta = await app.inject({
        method: "GET",
        url: "/pedidos/acompanhamento?token=algum-token",
        headers: { "x-pedido-token": "algum-token" },
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.json().error).toBe("BAD_REQUEST");
    });

    it("retorna 404 se header x-pedido-token for ausente ou inválido", async () => {
      const { app } = await criarAmbiente();

      const respostaSemToken = await app.inject({
        method: "GET",
        url: "/pedidos/acompanhamento",
      });
      expect(respostaSemToken.statusCode).toBe(404);

      const respostaTokenInvalido = await app.inject({
        method: "GET",
        url: "/pedidos/acompanhamento",
        headers: { "x-pedido-token": "token-totalmente-inexistente-12345678901234" },
      });
      expect(respostaTokenInvalido.statusCode).toBe(404);
      expect(respostaTokenInvalido.json().error).toBe("NOT_FOUND");
    });

    it("com token válido, retorna DTO enxuto sem dados sensíveis ou endereço completo", async () => {
      const { app, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Visitante da Silva",
          telefoneCliente: "19999994444",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });

      expect(criacao.statusCode).toBe(201);
      const token = criacao.json().tokenAcompanhamento;
      expect(token).toBeDefined();

      // Verifica que no banco está apenas o hash e NÃO o token plaintext
      const pedidoNoBanco = await app.prisma.pedido.findUnique({
        where: { id: criacao.json().pedido.id },
      });
      expect(pedidoNoBanco?.tokenAcompanhamentoHash).toBe(
        createHash("sha256").update(token, "utf8").digest("hex"),
      );

      // Consulta acompanhamento via header
      const acompanhamento = await app.inject({
        method: "GET",
        url: "/pedidos/acompanhamento",
        headers: { "x-pedido-token": token },
      });

      expect(acompanhamento.statusCode).toBe(200);
      const corpo = acompanhamento.json();
      expect(corpo.id).toBe(criacao.json().pedido.id);
      expect(corpo.status).toBe("PENDENTE");
      expect(corpo.statusFinanceiro).toBe("PENDENTE");
      expect(corpo.itens).toHaveLength(1);
      expect(corpo.pagamento).toHaveLength(1);

      // DTO enxuto: NÃO deve vazar telefone, endereço ou dados do cliente
      expect(corpo.telefone).toBeUndefined();
      expect(corpo.telefoneCliente).toBeUndefined();
      expect(corpo.nomeCliente).toBeUndefined();
      expect(corpo.endereco).toBeUndefined();
      expect(corpo.logradouroHistorico).toBeUndefined();
    });

    it("mantém token válido durante pedido ativo e respeita TTL de 30 dias após cancelamento ou conclusão", async () => {
      const { app, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Visitante TTL",
          telefoneCliente: "19999995555",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const token = criacao.json().tokenAcompanhamento;
      const pedidoId = criacao.json().pedido.id;

      // Pedido ativo: token válido
      const consultaAtivo = await app.inject({
        method: "GET",
        url: "/pedidos/acompanhamento",
        headers: { "x-pedido-token": token },
      });
      expect(consultaAtivo.statusCode).toBe(200);

      // Conclui pedido e define expiração para 30 dias no futuro
      await app.prisma.pedido.update({
        where: { id: pedidoId },
        data: {
          status: StatusPedido.CONCLUIDO,
          tokenAcompanhamentoExpiraEm: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
        },
      });

      // Ainda dentro dos 30 dias: token continua válido
      const consultaConcluidoValido = await app.inject({
        method: "GET",
        url: "/pedidos/acompanhamento",
        headers: { "x-pedido-token": token },
      });
      expect(consultaConcluidoValido.statusCode).toBe(200);
      expect(consultaConcluidoValido.json().status).toBe("CONCLUIDO");

      // Simula passagem de mais de 30 dias
      await app.prisma.pedido.update({
        where: { id: pedidoId },
        data: {
          tokenAcompanhamentoExpiraEm: new Date(Date.now() - 1_000),
        },
      });

      // Expirado: retorna 404
      const consultaExpirado = await app.inject({
        method: "GET",
        url: "/pedidos/acompanhamento",
        headers: { "x-pedido-token": token },
      });
      expect(consultaExpirado.statusCode).toBe(404);
      expect(consultaExpirado.json().error).toBe("NOT_FOUND");
    });
  });

  describe("3. Revogação administrativa (PATCH /admin/pedidos/:id/token-acompanhamento/revogar)", () => {
    it("exige ADMIN e revoga imediatamente o token de acompanhamento de visitante", async () => {
      const { app, cookieCliente1, cookieAdmin, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Visitante Revogavel",
          telefoneCliente: "19999996666",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const token = criacao.json().tokenAcompanhamento;
      const pedidoId = criacao.json().pedido.id;

      // Anônimo ou Cliente não podem revogar
      const tentaAnonimo = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${pedidoId}/token-acompanhamento/revogar`,
      });
      expect(tentaAnonimo.statusCode).toBe(401);

      const tentaCliente = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${pedidoId}/token-acompanhamento/revogar`,
        headers: { cookie: cookieCliente1 },
      });
      expect(tentaCliente.statusCode).toBe(403);

      // ADMIN revoga com sucesso
      const revogacao = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${pedidoId}/token-acompanhamento/revogar`,
        headers: { cookie: cookieAdmin },
      });
      expect(revogacao.statusCode).toBe(200);
      expect(revogacao.json().sucesso).toBe(true);
      expect(revogacao.json().revogadoEm).toBeDefined();

      // Após revogação, o visitante recebe 404 ao consultar acompanhamento
      const consultaAposRevogacao = await app.inject({
        method: "GET",
        url: "/pedidos/acompanhamento",
        headers: { "x-pedido-token": token },
      });
      expect(consultaAposRevogacao.statusCode).toBe(404);

      // Chamada repetida do admin é idempotente
      const revogacaoRepetida = await app.inject({
        method: "PATCH",
        url: `/admin/pedidos/${pedidoId}/token-acompanhamento/revogar`,
        headers: { cookie: cookieAdmin },
      });
      expect(revogacaoRepetida.statusCode).toBe(200);
      expect(revogacaoRepetida.json().sucesso).toBe(true);
    });
  });

  describe("4. Solicitação de cancelamento (POST /pedidos/:id/solicitacoes-cancelamento)", () => {
    it("permite solicitação por cliente autenticado proprietário e registra sem alterar status operacional", async () => {
      const { app, cookieCliente1, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: {
          cookie: cookieCliente1,
          "idempotency-key": randomUUID(),
        },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "CREDITO",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const pedidoId = criacao.json().pedido.id;

      const solicitacao = await app.inject({
        method: "POST",
        url: `/pedidos/${pedidoId}/solicitacoes-cancelamento`,
        headers: { cookie: cookieCliente1 },
        payload: { motivo: "Precisei sair para uma emergência familiar." },
      });

      expect(solicitacao.statusCode).toBe(200);
      expect(solicitacao.json().sucesso).toBe(true);
      expect(solicitacao.json().status).toBe("PENDENTE");

      // Status do pedido NÃO foi alterado no banco (Sprint 15 é ADMIN)
      const pedidoNoBanco = await app.prisma.pedido.findUnique({ where: { id: pedidoId } });
      expect(pedidoNoBanco?.status).toBe(StatusPedido.PENDENTE);

      // Histórico contém a solicitação
      const historico = pedidoNoBanco?.historicoStatus as Array<Record<string, unknown>>;
      expect(historico.some((h) => h.tipo === "SOLICITACAO_CANCELAMENTO")).toBe(true);
    });

    it("permite solicitação por visitante com token válido", async () => {
      const { app, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Visitante Cancelador",
          telefoneCliente: "19999997777",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const token = criacao.json().tokenAcompanhamento;
      const pedidoId = criacao.json().pedido.id;

      const solicitacao = await app.inject({
        method: "POST",
        url: `/pedidos/${pedidoId}/solicitacoes-cancelamento`,
        headers: { "x-pedido-token": token },
        payload: { motivo: "Demora excessiva para confirmação." },
      });

      expect(solicitacao.statusCode).toBe(200);
      expect(solicitacao.json().sucesso).toBe(true);
    });

    it("rejeita solicitação duplicada com 409 Conflict", async () => {
      const { app, cookieCliente1, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: {
          cookie: cookieCliente1,
          "idempotency-key": randomUUID(),
        },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "CREDITO",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const pedidoId = criacao.json().pedido.id;

      // Primeira solicitação
      await app.inject({
        method: "POST",
        url: `/pedidos/${pedidoId}/solicitacoes-cancelamento`,
        headers: { cookie: cookieCliente1 },
        payload: { motivo: "Primeiro motivo." },
      });

      // Segunda solicitação no mesmo pedido
      const segunda = await app.inject({
        method: "POST",
        url: `/pedidos/${pedidoId}/solicitacoes-cancelamento`,
        headers: { cookie: cookieCliente1 },
        payload: { motivo: "Outro motivo qualquer." },
      });

      expect(segunda.statusCode).toBe(409);
      expect(segunda.json().error).toBe("CONFLICT");
      expect(segunda.json().message).toContain("Já existe uma solicitação de cancelamento registrada");
    });

    it("rejeita solicitação em pedido já CONCLUIDO ou CANCELADO com 409 Conflict", async () => {
      const { app, cookieCliente1, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: {
          cookie: cookieCliente1,
          "idempotency-key": randomUUID(),
        },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "CREDITO",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const pedidoId = criacao.json().pedido.id;

      // Altera pedido para CONCLUIDO
      await app.prisma.pedido.update({
        where: { id: pedidoId },
        data: { status: StatusPedido.CONCLUIDO },
      });

      const resposta = await app.inject({
        method: "POST",
        url: `/pedidos/${pedidoId}/solicitacoes-cancelamento`,
        headers: { cookie: cookieCliente1 },
        payload: { motivo: "Tentando cancelar concluído." },
      });

      expect(resposta.statusCode).toBe(409);
      expect(resposta.json().error).toBe("CONFLICT");
      expect(resposta.json().message).toContain("Este pedido não pode mais ser cancelado");
    });
  });

  describe("5. Recuperação e rotação de token (POST /pedidos/acompanhamento/recuperar)", () => {
    it("rotaciona o token e invalida imediatamente o token anterior", async () => {
      const { app, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Visitante Recuperacao",
          telefoneCliente: "19999998888",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const tokenAntigo = criacao.json().tokenAcompanhamento;
      const numero = criacao.json().pedido.numero;

      // Recupera novo token informando numero e telefone corretos
      const recuperacao = await app.inject({
        method: "POST",
        url: "/pedidos/acompanhamento/recuperar",
        payload: {
          numero,
          telefone: "19999998888",
        },
      });

      expect(recuperacao.statusCode).toBe(200);
      const novoToken = recuperacao.json().tokenAcompanhamento;
      expect(novoToken).toBeDefined();
      expect(novoToken).not.toBe(tokenAntigo);

      // Token antigo agora é inválido (404)
      const consultaAntigo = await app.inject({
        method: "GET",
        url: "/pedidos/acompanhamento",
        headers: { "x-pedido-token": tokenAntigo },
      });
      expect(consultaAntigo.statusCode).toBe(404);

      // Novo token funciona perfeitamente
      const consultaNovo = await app.inject({
        method: "GET",
        url: "/pedidos/acompanhamento",
        headers: { "x-pedido-token": novoToken },
      });
      expect(consultaNovo.statusCode).toBe(200);
      expect(consultaNovo.json().numero).toBe(numero);
    });
  });

  describe("6. Rate limiting e degradação em indisponibilidade do Redis", () => {
    it("GET /pedidos/acompanhamento permanece disponível em produção sem Redis via fallback degradado", async () => {
      const { app, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Visitante Resiliência",
          telefoneCliente: "19999999999",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const token = criacao.json().tokenAcompanhamento;

      // Simula NODE_ENV=production sem Redis configurado
      vi.stubEnv("NODE_ENV", "production");
      try {
        // A consulta GET não falha com 503 nem lança erro de rate limiter distribuído
        const consulta = await app.inject({
          method: "GET",
          url: "/pedidos/acompanhamento",
          headers: { "x-pedido-token": token },
        });
        expect(consulta.statusCode).toBe(200);

        // Já operações de escrita ou mutação falham fechadas sem Redis em produção
        expect(() =>
          limitarCobranca({
            operacao: "SOLICITACAO_CANCELAMENTO",
            identificador: "teste-ip",
          }),
        ).toThrow("RATE_LIMITER_DISTRIBUIDO_INDISPONIVEL");
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe("7. Redaction de cabeçalhos sensíveis em logs", () => {
    it("processa requisições contendo headers sensíveis com logger configurado para redação", async () => {
      const { app } = await criarAmbiente();
      const resposta = await app.inject({
        method: "GET",
        url: "/health",
        headers: {
          "x-pedido-token": "token-secreto-acompanhamento",
          authorization: "Bearer token-secreto-jwt",
          cookie: "leosburger_session=sessao-ultra-secreta",
        },
      });
      expect(resposta.statusCode).toBe(200);
    });
  });

  describe("8. Segunda tentativa PIX com token de acompanhamento e isolamento de propriedade", () => {
    it("permite ao visitante com token válido solicitar segunda tentativa PIX no próprio pedido", async () => {
      const { app, item } = await criarAmbiente();

      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Visitante Retry",
          telefoneCliente: "19999990001",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      expect(criacao.statusCode).toBe(201);
      const token = criacao.json().tokenAcompanhamento;
      const pedidoId = criacao.json().pedido.id;
      const tentativa1Id = criacao.json().pagamento.id;

      // Falha a primeira tentativa para liberar a segunda
      await app.prisma.tentativaPagamento.update({
        where: { id: tentativa1Id },
        data: { status: "FALHOU", encerradoEm: new Date() },
      });

      // Solicita a segunda tentativa com o token no header
      const resposta = await app.inject({
        method: "POST",
        url: `/pedidos/${pedidoId}/tentativas-pagamento`,
        headers: {
          "x-pedido-token": token,
          "idempotency-key": randomUUID(),
        },
      });

      expect(resposta.statusCode).toBe(201);
      expect(resposta.json().numeroTentativa).toBe(2);
      expect(resposta.json().status).toBe("PENDENTE");
    });

    it("rejeita solicitação de segunda tentativa PIX com token de outro pedido com 404", async () => {
      const { app, item } = await criarAmbiente();

      // Pedido A
      const criacaoA = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Visitante A",
          telefoneCliente: "19999990002",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const tokenA = criacaoA.json().tokenAcompanhamento;
      const pedidoAId = criacaoA.json().pedido.id;

      // Pedido B
      const criacaoB = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Visitante B",
          telefoneCliente: "19999990003",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const pedidoBId = criacaoB.json().pedido.id;

      // Falha primeira tentativa de B
      await app.prisma.tentativaPagamento.update({
        where: { id: criacaoB.json().pagamento.id },
        data: { status: "FALHOU", encerradoEm: new Date() },
      });

      // Tenta usar token de A no pedido B: retorna 404
      const resposta = await app.inject({
        method: "POST",
        url: `/pedidos/${pedidoBId}/tentativas-pagamento`,
        headers: {
          "x-pedido-token": tokenA,
          "idempotency-key": randomUUID(),
        },
      });
      expect(resposta.statusCode).toBe(404);
      expect(resposta.json().error).toBe("NOT_FOUND");
    });

    it("permite ao cliente autenticado solicitar segunda tentativa em pedido próprio e bloqueia em pedido de terceiro", async () => {
      const { app, cookieCliente1, cookieCliente2, item } = await criarAmbiente();

      // Cliente 1 cria pedido PIX
      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: {
          cookie: cookieCliente1,
          "idempotency-key": randomUUID(),
        },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const pedidoId = criacao.json().pedido.id;
      const tentativa1Id = criacao.json().pagamento.id;

      // Falha tentativa 1
      await app.prisma.tentativaPagamento.update({
        where: { id: tentativa1Id },
        data: { status: "FALHOU", encerradoEm: new Date() },
      });

      // Cliente 2 tenta solicitar segunda tentativa no pedido do Cliente 1: 404
      const tentaCliente2 = await app.inject({
        method: "POST",
        url: `/pedidos/${pedidoId}/tentativas-pagamento`,
        headers: {
          cookie: cookieCliente2,
          "idempotency-key": randomUUID(),
        },
      });
      expect(tentaCliente2.statusCode).toBe(404);

      // Cliente 1 solicita no próprio pedido: 201
      const sucessoCliente1 = await app.inject({
        method: "POST",
        url: `/pedidos/${pedidoId}/tentativas-pagamento`,
        headers: {
          cookie: cookieCliente1,
          "idempotency-key": randomUUID(),
        },
      });
      expect(sucessoCliente1.statusCode).toBe(201);
      expect(sucessoCliente1.json().numeroTentativa).toBe(2);
    });
  });

  describe("9. Rate limiting da primeira cobrança e segunda tentativa PIX", () => {
    it("aplica rate limit na primeira cobrança PIX e responde 429 sem quebrar replay idempotente", async () => {
      const { app, item } = await criarAmbiente();

      limparLimitesPagamentoParaTeste();
      vi.stubEnv("PAGAMENTOS_RATE_LIMIT_COBRANCA_INICIAL", "1");
      vi.stubEnv("PAGAMENTOS_RATE_LIMIT_JANELA_SEGUNDOS", "60");

      try {
        const idempotencyKey1 = randomUUID();
        const payload = {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Rate Limit PIX",
          telefoneCliente: "19999990004",
          itens: [{ itemId: item.id, quantidade: 1 }],
        };

        // 1ª chamada: 201
        const res1 = await app.inject({
          method: "POST",
          url: "/pedidos",
          headers: { "idempotency-key": idempotencyKey1 },
          payload,
        });
        expect(res1.statusCode).toBe(201);

        // Replay idempotente com a mesma chave: permitido (200)
        const replay = await app.inject({
          method: "POST",
          url: "/pedidos",
          headers: { "idempotency-key": idempotencyKey1 },
          payload,
        });
        expect(replay.statusCode).toBe(200);

        // 2ª chamada com chave diferente: estoura o limite (429)
        const res2 = await app.inject({
          method: "POST",
          url: "/pedidos",
          headers: { "idempotency-key": randomUUID() },
          payload,
        });
        expect(res2.statusCode).toBe(429);
        expect(res2.json().error).toBe("RATE_LIMIT_EXCEEDED");
      } finally {
        vi.unstubAllEnvs();
        limparLimitesPagamentoParaTeste();
      }
    });

    it("falha fechada (503) em produção para criação de PIX sem Redis", async () => {
      const { app, item } = await criarAmbiente();

      vi.stubEnv("NODE_ENV", "production");
      try {
        const resposta = await app.inject({
          method: "POST",
          url: "/pedidos",
          headers: { "idempotency-key": randomUUID() },
          payload: {
            tipoEntrega: "RETIRADA",
            metodoPagamento: "PIX",
            nomeCliente: "Prod Sem Redis",
            telefoneCliente: "19999990005",
            itens: [{ itemId: item.id, quantidade: 1 }],
          },
        });
        expect(resposta.statusCode).toBe(503);
        expect(resposta.json().error).toBe("SERVICE_UNAVAILABLE");
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
