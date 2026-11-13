import { createHash, randomUUID } from "node:crypto";
import { Prisma, TipoDescontoCupom, TipoUsuario } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";
import { ReferenciaEnderecoService, hashTokenReferenciaEndereco } from "../../src/services/referencias-endereco.js";
import { obterDataCivilSaoPaulo } from "../../src/services/cupons.js";
import { withTestDatabaseLock } from "../helpers/database-lock.js";

const hashToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

function cookieDaResposta(cabecalho: unknown) {
  const valor =
    typeof cabecalho === "string"
      ? cabecalho
      : Array.isArray(cabecalho) && typeof cabecalho[0] === "string"
        ? cabecalho[0]
        : undefined;
  if (!valor) {
    throw new Error("Resposta de login sem cookie.");
  }
  return valor.split(";")[0] ?? "";
}

describe("POST /pedidos", () => {
  const apps: ReturnType<typeof criarAplicacao>[] = [];

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  it("cria snapshots de visitante, guarda somente o hash e responde idempotentemente", async () => {
    const app = criarAplicacao();
    apps.push(app);
    await app.ready();

    const categoria = await app.prisma.categoria.create({
      data: { nome: `Pedido ${randomUUID()}` },
      select: { id: true },
    });
    const adicionalId = randomUUID();
    const item = await app.prisma.item.create({
      data: {
        categoriaId: categoria.id,
        nome: "Hambúrguer histórico",
        preco: new Prisma.Decimal("12.50"),
        adicionais: [
          {
            id: adicionalId,
            nome: "Queijo",
            preco: 2,
            ativo: true,
            quantidadeMaxima: 2,
          },
        ],
      },
      select: { id: true },
    });
    const payload = {
      tipoEntrega: "RETIRADA",
      metodoPagamento: "PIX",
      nomeCliente: "Visitante de teste",
      telefoneCliente: "19 99999-1234",
      itens: [
        {
          itemId: item.id,
          quantidade: 2,
          adicionais: [{ id: adicionalId, quantidade: 2 }],
        },
      ],
    };
    const idempotencyKey = randomUUID();

    try {
      const resposta = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": idempotencyKey },
        payload,
      });

      expect(resposta.statusCode).toBe(201);
      expect(resposta.json()).toMatchObject({
        pedido: {
          status: "PENDENTE",
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          subtotal: "33.00",
          total: "33.00",
          itens: [
            {
              itemId: item.id,
              precoUnitario: "12.50",
              quantidade: 2,
              subtotal: "33.00",
              adicionais: [
                {
                  id: adicionalId,
                  nome: "Queijo",
                  preco: "2.00",
                  quantidade: 2,
                },
              ],
            },
          ],
        },
        repetido: false,
      });

      const token = resposta.json().tokenAcompanhamento as string;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const pedido = await app.prisma.pedido.findUniqueOrThrow({
        where: { idempotencyKey },
        include: { itensPedido: true },
      });
      expect(pedido.tokenAcompanhamentoHash).toBe(hashToken(token));
      expect(pedido.tokenAcompanhamentoHash).not.toBe(token);
      expect(JSON.stringify(pedido)).not.toContain(token);
      expect(pedido.historicoStatus).toMatchObject([
        { status: "PENDENTE", motivo: "PEDIDO_CRIADO" },
      ]);

      const repeticao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": idempotencyKey },
        payload,
      });
      expect(repeticao.statusCode).toBe(200);
      expect(repeticao.json().pedido.id).toBe(pedido.id);
      expect(repeticao.json().tokenAcompanhamento).toBeNull();
      expect(
        await app.prisma.pedido.count({ where: { idempotencyKey } }),
      ).toBe(1);

      const divergente = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": idempotencyKey },
        payload: { ...payload, itens: [{ itemId: item.id, quantidade: 1 }] },
      });
      expect(divergente.statusCode).toBe(409);
      expect(
        await app.prisma.pedido.count({ where: { idempotencyKey } }),
      ).toBe(1);
    } finally {
      await app.prisma.pedido.deleteMany({ where: { idempotencyKey } });
      await app.prisma.item.delete({ where: { id: item.id } });
      await app.prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("serializa requisições concorrentes com a mesma chave e conteúdo", async () => {
    const app = criarAplicacao();
    apps.push(app);
    await app.ready();

    const categoria = await app.prisma.categoria.create({
      data: { nome: `Idempotência ${randomUUID()}` },
      select: { id: true },
    });
    const item = await app.prisma.item.create({
      data: {
        categoriaId: categoria.id,
        nome: "Item concorrente",
        preco: new Prisma.Decimal("8.00"),
      },
      select: { id: true },
    });
    const idempotencyKey = randomUUID();
    const payload = {
      tipoEntrega: "RETIRADA",
      metodoPagamento: "PIX",
      nomeCliente: "Visitante concorrente",
      telefoneCliente: "19999991234",
      itens: [{ itemId: item.id, quantidade: 1 }],
    };

    try {
      const respostas = await Promise.all([
        app.inject({
          method: "POST",
          url: "/pedidos",
          headers: { "idempotency-key": idempotencyKey },
          payload,
        }),
        app.inject({
          method: "POST",
          url: "/pedidos",
          headers: { "idempotency-key": idempotencyKey },
          payload,
        }),
      ]);
      expect(respostas.map(({ statusCode }) => statusCode).sort()).toEqual([200, 201]);
      expect(respostas[0]!.json().pedido.id).toBe(respostas[1]!.json().pedido.id);
      expect(
        await app.prisma.pedido.count({ where: { idempotencyKey } }),
      ).toBe(1);
    } finally {
      await app.prisma.pedido.deleteMany({ where: { idempotencyKey } });
      await app.prisma.item.delete({ where: { id: item.id } });
      await app.prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("salva composição de combo, regras do cupom e uso no mesmo pedido", async () => {
    const app = criarAplicacao();
    apps.push(app);
    await app.ready();

    const categoria = await app.prisma.categoria.create({
      data: { nome: `Cupom pedido ${randomUUID()}` },
      select: { id: true },
    });
    const item = await app.prisma.item.create({
      data: {
        categoriaId: categoria.id,
        nome: "Componente histórico",
        preco: new Prisma.Decimal("8.00"),
      },
      select: { id: true },
    });
    const combo = await app.prisma.combo.create({
      data: {
        nome: `Combo histórico ${randomUUID()}`,
        preco: new Prisma.Decimal("35.00"),
        itensCombo: { create: [{ itemId: item.id, quantidade: 2 }] },
      },
      select: { id: true },
    });
    const hoje = obterDataCivilSaoPaulo();
    const cupom = await app.prisma.cupom.create({
      data: {
        codigo: `PROMO-${randomUUID().slice(0, 8).toUpperCase()}`,
        tipoDesconto: TipoDescontoCupom.PERCENTUAL,
        valor: new Prisma.Decimal("10.00"),
        validadeInicio: new Date(`${hoje}T00:00:00.000Z`),
        validadeFim: new Date(`${hoje}T00:00:00.000Z`),
        limiteUsos: 1,
        combosElegiveis: { create: [{ comboId: combo.id }] },
      },
      select: { id: true, codigo: true },
    });
    const idempotencyKey = randomUUID();
    const payload = {
      tipoEntrega: "RETIRADA",
      metodoPagamento: "PIX",
      nomeCliente: "Visitante cupom",
      telefoneCliente: "19999991236",
      codigoCupom: cupom.codigo,
      itens: [{ comboId: combo.id, quantidade: 1 }],
    };
    try {
      const resposta = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": idempotencyKey },
        payload,
      });
      expect(resposta.statusCode).toBe(201);
      expect(resposta.json().pedido).toMatchObject({
        subtotal: "35.00",
        desconto: "3.50",
        total: "31.50",
        codigoCupom: cupom.codigo,
        itens: [
          {
            comboId: combo.id,
            composicao: [
              {
                itemId: item.id,
                nome: "Componente histórico",
                precoUnitario: "8.00",
                quantidade: 2,
              },
            ],
          },
        ],
      });
      const pedido = await app.prisma.pedido.findUniqueOrThrow({
        where: { idempotencyKey },
      });
      expect(pedido.cupomHistorico).toMatchObject({
        id: cupom.id,
        codigo: cupom.codigo,
        tipoDesconto: "PERCENTUAL",
        valor: "10.00",
        combosElegiveis: [combo.id],
      });
      expect(
        await app.prisma.cupomUtilizacao.count({
          where: { cupomId: cupom.id },
        }),
      ).toBe(1);

      const repeticao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": idempotencyKey },
        payload,
      });
      expect(repeticao.statusCode).toBe(200);
      expect(
        await app.prisma.cupomUtilizacao.count({
          where: { cupomId: cupom.id },
        }),
      ).toBe(1);

      const cupomEsgotado = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload,
      });
      expect(cupomEsgotado.statusCode).toBe(400);
      expect(
        await app.prisma.pedido.count({ where: { idempotencyKey } }),
      ).toBe(1);
    } finally {
      await app.prisma.cupomUtilizacao.deleteMany({ where: { cupomId: cupom.id } });
      await app.prisma.pedido.deleteMany({ where: { idempotencyKey } });
      await app.prisma.cupom.delete({ where: { id: cupom.id } });
      await app.prisma.combo.delete({ where: { id: combo.id } });
      await app.prisma.item.delete({ where: { id: item.id } });
      await app.prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("permite métodos presenciais ao CLIENTE e bloqueia ADMIN e método de visitante", async () => {
    const app = criarAplicacao();
    apps.push(app);
    await app.ready();

    const categoria = await app.prisma.categoria.create({
      data: { nome: `Perfis pedido ${randomUUID()}` },
      select: { id: true },
    });
    const item = await app.prisma.item.create({
      data: {
        categoriaId: categoria.id,
        nome: "Pedido autenticado",
        preco: new Prisma.Decimal("11.00"),
      },
      select: { id: true },
    });
    const senha = "Senha-forte-123";
    const senhaHash = await bcrypt.hash(senha, 10);
    const cliente = await app.prisma.usuario.create({
      data: {
        nome: "Cliente autenticado",
        email: `cliente-pedido-${randomUUID()}@example.test`,
        telefone: "19999991237",
        senhaHash,
        tipo: TipoUsuario.CLIENTE,
      },
      select: { id: true, email: true },
    });
    const admin = await app.prisma.usuario.create({
      data: {
        nome: "Admin bloqueado",
        email: `admin-pedido-${randomUUID()}@example.test`,
        telefone: "19999991238",
        senhaHash,
        tipo: TipoUsuario.ADMIN,
      },
      select: { email: true },
    });
    let pedidoId: string | undefined;

    try {
      const loginCliente = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: cliente.email, senha },
      });
      const cookieCliente = cookieDaResposta(loginCliente.headers["set-cookie"]);
      const payloadCliente = {
        tipoEntrega: "RETIRADA",
        metodoPagamento: "CREDITO",
        itens: [{ itemId: item.id, quantidade: 1 }],
      };
      const criado = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: {
          cookie: cookieCliente,
          "idempotency-key": randomUUID(),
        },
        payload: payloadCliente,
      });
      expect(criado.statusCode).toBe(201);
      const criadoId = criado.json().pedido.id as string;
      pedidoId = criadoId;
      const registro = await app.prisma.pedido.findUniqueOrThrow({
        where: { id: criadoId },
      });
      expect(registro.usuarioId).toBe(cliente.id);
      expect(registro.nomeClienteHistorico).toBe("Cliente autenticado");
      expect(registro.telefoneClienteHistorico).toBe("19999991237");
      expect(registro.metodoPagamento).toBe("CREDITO");
      expect(registro.tokenAcompanhamentoHash).toBeNull();

      const loginAdmin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: admin.email, senha },
      });
      const cookieAdmin = cookieDaResposta(loginAdmin.headers["set-cookie"]);
      const bloqueado = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: {
          cookie: cookieAdmin,
          "idempotency-key": randomUUID(),
        },
        payload: payloadCliente,
      });
      expect(bloqueado.statusCode).toBe(403);

      const visitanteSemContato = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const visitanteComMetodoPresencial = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          ...payloadCliente,
          metodoPagamento: "CREDITO",
          nomeCliente: "Visitante",
          telefoneCliente: "19999991239",
        },
      });
      expect(visitanteSemContato.statusCode).toBe(400);
      expect(visitanteComMetodoPresencial.statusCode).toBe(400);
    } finally {
      if (pedidoId) {
        await app.prisma.pedido.deleteMany({ where: { id: pedidoId } });
      }
      await app.prisma.usuario.deleteMany({
        where: { id: { in: [cliente.id] }, },
      });
      await app.prisma.usuario.deleteMany({
        where: { email: admin.email },
      });
      await app.prisma.item.delete({ where: { id: item.id } });
      await app.prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("persiste endereço e faixa de frete como snapshots da entrega", async () => {
    const app = criarAplicacao();
    apps.push(app);
    await app.ready();

    await withTestDatabaseLock(
      app.prisma,
      "leosburger-test-faixas-frete",
      async () => {
        const latitudeAnterior = process.env.RESTAURANTE_LATITUDE;
        const longitudeAnterior = process.env.RESTAURANTE_LONGITUDE;
        const faixasOriginais = await app.prisma.faixaFrete.findMany();
        const categoria = await app.prisma.categoria.create({
          data: { nome: `Entrega pedido ${randomUUID()}` },
          select: { id: true },
        });
        const item = await app.prisma.item.create({
          data: {
            categoriaId: categoria.id,
            nome: "Pedido de entrega",
            preco: new Prisma.Decimal("15.00"),
          },
          select: { id: true },
        });
        let faixaId: string | undefined;
        let pedidoId: string | undefined;
        let tokenEnderecoHash: string | undefined;

        try {
          await app.prisma.faixaFrete.updateMany({
            where: { ativa: true },
            data: { ativa: false },
          });
          const faixa = await app.prisma.faixaFrete.create({
            data: {
              distanciaMinima: new Prisma.Decimal("0.00"),
              distanciaMaxima: new Prisma.Decimal("6.00"),
              valor: new Prisma.Decimal("4.75"),
            },
            select: { id: true },
          });
          faixaId = faixa.id;
          process.env.RESTAURANTE_LATITUDE = "-22.900000";
          process.env.RESTAURANTE_LONGITUDE = "-47.060000";

          const referencia = await new ReferenciaEnderecoService(
            app.prisma,
          ).emitir({
            cep: "13010000",
            logradouro: "Rua Snapshot",
            numero: "25",
            bairro: "Centro",
            cidade: "Campinas",
            estado: "SP",
            situacao: "CONFIRMADO",
            motivoPendencia: null,
            latitude: -22.91,
            longitude: -47.06,
          });
          tokenEnderecoHash = hashTokenReferenciaEndereco(referencia.token);
          const idempotencyKey = randomUUID();
          const resposta = await app.inject({
            method: "POST",
            url: "/pedidos",
            headers: { "idempotency-key": idempotencyKey },
            payload: {
              tipoEntrega: "ENTREGA",
              metodoPagamento: "PIX",
              nomeCliente: "Entrega visitante",
              telefoneCliente: "19999991235",
              referenciaEndereco: referencia.token,
              itens: [{ itemId: item.id, quantidade: 1 }],
            },
          });

          expect(resposta.statusCode).toBe(201);
          expect(resposta.json().pedido).toMatchObject({
            taxaEntrega: "4.75",
            faixaFrete: {
              id: faixa.id,
              distanciaMinima: "0.00",
              distanciaMaxima: "6.00",
            },
            endereco: {
              cep: "13010000",
              logradouro: "Rua Snapshot",
              numero: "25",
              cidade: "Campinas",
              estado: "SP",
            },
          });
          const criadoPedidoId = resposta.json().pedido.id as string;
          pedidoId = criadoPedidoId;
          const salvo = await app.prisma.pedido.findUniqueOrThrow({
            where: { id: criadoPedidoId },
          });
          expect(salvo.faixaFreteIdHistorico).toBe(faixa.id);
          expect(salvo.distanciaKm).not.toBeNull();
          expect(salvo.taxaEntrega.toFixed(2)).toBe("4.75");
        } finally {
          if (pedidoId) {
            await app.prisma.pedido.deleteMany({ where: { id: pedidoId } });
          }
          if (tokenEnderecoHash) {
            await app.prisma.referenciaEndereco.deleteMany({
              where: { tokenHash: tokenEnderecoHash },
            });
          }
          if (faixaId) {
            await app.prisma.faixaFrete.deleteMany({ where: { id: faixaId } });
          }
          await app.prisma.faixaFrete.updateMany({
            where: { ativa: true },
            data: { ativa: false },
          });
          const idsFaixasAtivas = faixasOriginais
            .filter((faixa) => faixa.ativa)
            .map((faixa) => faixa.id);
          if (idsFaixasAtivas.length > 0) {
            await app.prisma.faixaFrete.updateMany({
              where: { id: { in: idsFaixasAtivas } },
              data: { ativa: true },
            });
          }
          await app.prisma.item.delete({ where: { id: item.id } });
          await app.prisma.categoria.delete({ where: { id: categoria.id } });
          if (latitudeAnterior === undefined) {
            delete process.env.RESTAURANTE_LATITUDE;
          } else {
            process.env.RESTAURANTE_LATITUDE = latitudeAnterior;
          }
          if (longitudeAnterior === undefined) {
            delete process.env.RESTAURANTE_LONGITUDE;
          } else {
            process.env.RESTAURANTE_LONGITUDE = longitudeAnterior;
          }
        }
      },
    );
  });

  it("recupera e rotaciona token por número e telefone sem expor pedidos inválidos", async () => {
    const app = criarAplicacao();
    apps.push(app);
    await app.ready();

    const categoria = await app.prisma.categoria.create({
      data: { nome: `Tracking ${randomUUID()}` },
      select: { id: true },
    });
    const item = await app.prisma.item.create({
      data: {
        categoriaId: categoria.id,
        nome: "Item tracking",
        preco: new Prisma.Decimal("9.00"),
      },
      select: { id: true },
    });
    const idempotencyKey = randomUUID();

    try {
      const criacao = await app.inject({
        method: "POST",
        url: "/pedidos",
        headers: { "idempotency-key": idempotencyKey },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          nomeCliente: "Cliente tracking",
          telefoneCliente: "(19) 99999-5678",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      expect(criacao.statusCode).toBe(201);

      const pedidoId = criacao.json().pedido.id as string;
      const numero = criacao.json().pedido.numero as number;
      const hashOriginal = hashToken(criacao.json().tokenAcompanhamento);

      const invalida = await app.inject({
        method: "POST",
        url: "/pedidos/acompanhamento/recuperar",
        payload: { numero, telefone: "19999990000" },
      });
      expect(invalida.statusCode).toBe(404);

      const recuperacao = await app.inject({
        method: "POST",
        url: "/pedidos/acompanhamento/recuperar",
        payload: { numero, telefone: "19 99999-5678" },
      });
      expect(recuperacao.statusCode).toBe(200);
      const novoToken = recuperacao.json().tokenAcompanhamento as string;
      expect(novoToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(novoToken).not.toBe(criacao.json().tokenAcompanhamento);

      const atualizado = await app.prisma.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
      });
      expect(atualizado.tokenAcompanhamentoHash).toBe(hashToken(novoToken));
      expect(atualizado.tokenAcompanhamentoHash).not.toBe(hashOriginal);
      expect(atualizado.tokenAcompanhamentoRevogadoEm).toBeNull();

      await app.prisma.pedido.update({
        where: { id: pedidoId },
        data: {
          status: "CONCLUIDO",
          tokenAcompanhamentoExpiraEm: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
        },
      });
      const permitidoAposConclusao = await app.inject({
        method: "POST",
        url: "/pedidos/acompanhamento/recuperar",
        payload: { numero, telefone: "19 99999-5678" },
      });
      expect(permitidoAposConclusao.statusCode).toBe(200);

      await app.prisma.pedido.update({
        where: { id: pedidoId },
        data: {
          tokenAcompanhamentoExpiraEm: new Date(Date.now() - 1),
        },
      });
      const expirado = await app.inject({
        method: "POST",
        url: "/pedidos/acompanhamento/recuperar",
        payload: { numero, telefone: "19 99999-5678" },
      });
      expect(expirado.statusCode).toBe(404);
    } finally {
      await app.prisma.pedido.deleteMany({ where: { idempotencyKey } });
      await app.prisma.item.delete({ where: { id: item.id } });
      await app.prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });
});
