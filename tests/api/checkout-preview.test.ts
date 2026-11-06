import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  MetodoPagamento,
  MotivoPendenciaEndereco,
  Prisma,
  StatusReferenciaEndereco,
  TipoUsuario,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";
import { obterDataCivilSaoPaulo } from "../../src/services/cupons.js";
import { ReferenciaEnderecoService } from "../../src/services/referencias-endereco.js";
import { withTestDatabaseLock } from "../helpers/database-lock.js";

const senhaTeste = "Senha-forte-123";

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

describe("POST /checkout/preview", () => {
  it("valida adicionais e cupom no servidor e não consome cupom nem cria pedido", async () => {
    const app = criarAplicacao();
    const categoriaIds: string[] = [];
    const itemIds: string[] = [];
    const cupomIds: string[] = [];
    const usuarioIds: string[] = [];

    try {
      await app.ready();
      const categoria = await app.prisma.categoria.create({
        data: { nome: `Preview ${randomUUID()}` },
        select: { id: true },
      });
      categoriaIds.push(categoria.id);
      const adicionalId = randomUUID();
      const elegivel = await app.prisma.item.create({
        data: {
          categoriaId: categoria.id,
          nome: `Item elegível ${randomUUID()}`,
          preco: new Prisma.Decimal("10.10"),
          adicionais: [
            {
              id: adicionalId,
              nome: "Cheddar",
              preco: 1.25,
              ativo: true,
              quantidadeMaxima: 2,
            },
          ],
        },
        select: { id: true },
      });
      const naoElegivel = await app.prisma.item.create({
        data: {
          categoriaId: categoria.id,
          nome: `Item não elegível ${randomUUID()}`,
          preco: new Prisma.Decimal("4.00"),
        },
        select: { id: true },
      });
      itemIds.push(elegivel.id, naoElegivel.id);

      const senhaHash = await bcrypt.hash(senhaTeste, 10);
      const admin = await app.prisma.usuario.create({
        data: {
          nome: "Admin preview",
          email: `admin-preview-${randomUUID()}@example.test`,
          telefone: "19999990001",
          senhaHash,
          tipo: TipoUsuario.ADMIN,
        },
        select: { id: true, email: true },
      });
      usuarioIds.push(admin.id);
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: admin.email, senha: senhaTeste },
      });
      const adminCookie = cookieDaResposta(login.headers["set-cookie"]);

      const inicio = obterDataCivilSaoPaulo();
      const cupom = await app.inject({
        method: "POST",
        url: "/admin/cupons",
        headers: { cookie: adminCookie },
        payload: {
          codigo: `PROMO-${randomUUID().slice(0, 8)}`,
          tipoDesconto: "PERCENTUAL",
          valor: 10,
          ativo: true,
          validadeInicio: inicio,
          validadeFim: inicio,
          limiteUsos: 1,
          itemIds: [elegivel.id],
          comboIds: [],
        },
      });
      expect(cupom.statusCode).toBe(201);
      cupomIds.push(cupom.json().id);

      const payload = {
        tipoEntrega: "RETIRADA",
        metodoPagamento: "PIX",
        codigoCupom: cupom.json().codigo,
        itens: [
          {
            itemId: elegivel.id,
            quantidade: 2,
            adicionais: [{ id: adicionalId, quantidade: 1 }],
          },
          { itemId: naoElegivel.id, quantidade: 1, adicionais: [] },
        ],
      };
      const pedidosAntes = await app.prisma.pedido.count();
      const primeira = await app.inject({
        method: "POST",
        url: "/checkout/preview",
        payload,
      });
      const segunda = await app.inject({
        method: "POST",
        url: "/checkout/preview",
        payload,
      });

      expect(primeira.statusCode).toBe(200);
      expect(primeira.json()).toMatchObject({
        subtotal: "26.70",
        cupom: {
          codigo: cupom.json().codigo,
          desconto: "2.27",
          subtotalElegivel: "22.70",
        },
        frete: "0.00",
        situacaoEntrega: "RETIRADA",
        total: "24.43",
      });
      expect(primeira.json().itens[0].adicionais).toEqual([
        {
          id: adicionalId,
          nome: "Cheddar",
          preco: "1.25",
          quantidade: 1,
        },
      ]);
      expect(segunda.statusCode).toBe(200);
      expect(
        await app.prisma.cupomUtilizacao.count({
          where: { cupomId: cupom.json().id },
        }),
      ).toBe(0);
      expect(await app.prisma.pedido.count()).toBe(pedidosAntes);

      const precoAdulterado = await app.inject({
        method: "POST",
        url: "/checkout/preview",
        payload: {
          ...payload,
          itens: [{ itemId: elegivel.id, quantidade: 1, preco: 0.01 }],
        },
      });
      const adicionalDeOutroItem = await app.inject({
        method: "POST",
        url: "/checkout/preview",
        payload: {
          ...payload,
          codigoCupom: undefined,
          itens: [
            {
              itemId: elegivel.id,
              quantidade: 1,
              adicionais: [{ id: randomUUID(), quantidade: 1 }],
            },
          ],
        },
      });
      expect(precoAdulterado.statusCode).toBe(400);
      expect(adicionalDeOutroItem.statusCode).toBe(400);
    } finally {
      if (cupomIds.length > 0) {
        await app.prisma.cupom.deleteMany({ where: { id: { in: cupomIds } } });
      }
      if (itemIds.length > 0) {
        await app.prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      }
      if (categoriaIds.length > 0) {
        await app.prisma.categoria.deleteMany({ where: { id: { in: categoriaIds } } });
      }
      if (usuarioIds.length > 0) {
        await app.prisma.usuario.deleteMany({ where: { id: { in: usuarioIds } } });
      }
      await app.close();
    }
  });

  it("mantém entrega pendente sem frete/total e trata referência expirada em modo somente leitura", async () => {
    const app = criarAplicacao();
    const tokenHashes: string[] = [];
    let categoriaId: string | undefined;
    let itemId: string | undefined;

    try {
      await app.ready();
      const categoria = await app.prisma.categoria.create({
        data: { nome: `Entrega pendente ${randomUUID()}` },
        select: { id: true },
      });
      categoriaId = categoria.id;
      const item = await app.prisma.item.create({
        data: {
          categoriaId,
          nome: `Item entrega ${randomUUID()}`,
          preco: new Prisma.Decimal("8.50"),
        },
        select: { id: true },
      });
      itemId = item.id;

      const servico = new ReferenciaEnderecoService(app.prisma);
      const referencia = await servico.emitir({
        cep: "13010000",
        logradouro: "Rua de teste",
        numero: "10",
        complemento: "Casa 2",
        bairro: "Centro",
        cidade: "Campinas",
        estado: "SP",
        referencia: "Portão azul",
        situacao: StatusReferenciaEndereco.PENDENTE,
        motivoPendencia: MotivoPendenciaEndereco.SEM_RESULTADO,
        latitude: null,
        longitude: null,
      });
      const tokenHash = createHash("sha256")
        .update(referencia.token, "utf8")
        .digest("hex");
      tokenHashes.push(tokenHash);

      const preview = await app.inject({
        method: "POST",
        url: "/checkout/preview",
        payload: {
          tipoEntrega: "ENTREGA",
          metodoPagamento: MetodoPagamento.PIX,
          referenciaEndereco: referencia.token,
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({
        subtotal: "8.50",
        frete: null,
        distanciaKm: null,
        situacaoEntrega: "PENDENTE",
        total: null,
        endereco: {
          complemento: "Casa 2",
          referencia: "Portão azul",
          situacao: "PENDENTE",
        },
      });
      expect(preview.body).not.toContain("latitude");
      expect(preview.body).not.toContain("longitude");

      const tokenExpirado = randomBytes(32).toString("base64url");
      const hashExpirado = createHash("sha256")
        .update(tokenExpirado, "utf8")
        .digest("hex");
      tokenHashes.push(hashExpirado);
      const agora = Date.now();
      await app.prisma.referenciaEndereco.create({
        data: {
          tokenHash: hashExpirado,
          cep: "13010000",
          logradouro: "Rua expirada",
          numero: "10",
          bairro: "Centro",
          cidade: "Campinas",
          estado: "SP",
          situacao: StatusReferenciaEndereco.PENDENTE,
          motivoPendencia: MotivoPendenciaEndereco.SEM_RESULTADO,
          expiraEm: new Date(agora - 60 * 60_000),
          criadoEm: new Date(agora - 2 * 60 * 60_000),
        },
      });
      const expirado = await app.inject({
        method: "POST",
        url: "/checkout/preview",
        payload: {
          tipoEntrega: "ENTREGA",
          metodoPagamento: "PIX",
          referenciaEndereco: tokenExpirado,
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      expect(expirado.statusCode).toBe(400);
      expect(
        await app.prisma.referenciaEndereco.findUnique({
          where: { tokenHash: hashExpirado },
        }),
      ).not.toBeNull();
    } finally {
      if (tokenHashes.length > 0) {
        await app.prisma.referenciaEndereco.deleteMany({
          where: { tokenHash: { in: tokenHashes } },
        });
      }
      if (itemId) {
        await app.prisma.item.deleteMany({ where: { id: itemId } });
      }
      if (categoriaId) {
        await app.prisma.categoria.deleteMany({ where: { id: categoriaId } });
      }
      await app.close();
    }
  });

  it("permite CLIENTE, bloqueia ADMIN e trata cookie inválido como erro de autenticação", async () => {
    const app = criarAplicacao();
    const usuarioIds: string[] = [];
    const categoriaIds: string[] = [];
    const itemIds: string[] = [];

    try {
      await app.ready();
      const categoria = await app.prisma.categoria.create({
        data: { nome: `Auth preview ${randomUUID()}` },
        select: { id: true },
      });
      categoriaIds.push(categoria.id);
      const item = await app.prisma.item.create({
        data: {
          categoriaId: categoria.id,
          nome: `Item auth ${randomUUID()}`,
          preco: new Prisma.Decimal("4.20"),
        },
        select: { id: true },
      });
      itemIds.push(item.id);
      const senhaHash = await bcrypt.hash(senhaTeste, 10);
      const usuarioCliente = await app.prisma.usuario.create({
        data: {
          nome: "Cliente preview",
          email: `cliente-preview-${randomUUID()}@example.test`,
          telefone: "19999990002",
          senhaHash,
          tipo: TipoUsuario.CLIENTE,
        },
        select: { id: true, email: true },
      });
      const usuarioAdmin = await app.prisma.usuario.create({
        data: {
          nome: "Admin preview",
          email: `admin-preview-${randomUUID()}@example.test`,
          telefone: "19999990003",
          senhaHash,
          tipo: TipoUsuario.ADMIN,
        },
        select: { id: true, email: true },
      });
      usuarioIds.push(usuarioCliente.id, usuarioAdmin.id);

      const [loginCliente, loginAdmin] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: usuarioCliente.email, senha: senhaTeste },
        }),
        app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: usuarioAdmin.email, senha: senhaTeste },
        }),
      ]);
      const cliente = await app.inject({
        method: "POST",
        url: "/checkout/preview",
        headers: { cookie: cookieDaResposta(loginCliente.headers["set-cookie"]) },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "DINHEIRO",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const admin = await app.inject({
        method: "POST",
        url: "/checkout/preview",
        headers: { cookie: cookieDaResposta(loginAdmin.headers["set-cookie"]) },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      const cookieInvalido = await app.inject({
        method: "POST",
        url: "/checkout/preview",
        headers: { cookie: "leosburger_session=inválido" },
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });

      expect(cliente.statusCode).toBe(200);
      expect(cliente.json().total).toBe("4.20");
      expect(admin.statusCode).toBe(403);
      expect(cookieInvalido.statusCode).toBe(401);
    } finally {
      if (itemIds.length > 0) {
        await app.prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      }
      if (categoriaIds.length > 0) {
        await app.prisma.categoria.deleteMany({
          where: { id: { in: categoriaIds } },
        });
      }
      if (usuarioIds.length > 0) {
        await app.prisma.usuario.deleteMany({ where: { id: { in: usuarioIds } } });
      }
      await app.close();
    }
  });

  it("rejeita cupons inativos, expirados, esgotados e sem itens elegíveis", async () => {
    const app = criarAplicacao();
    const categoriaIds: string[] = [];
    const itemIds: string[] = [];
    const cupomIds: string[] = [];
    let usuarioId: string | undefined;
    let pedidoId: string | undefined;

    try {
      await app.ready();
      const categoria = await app.prisma.categoria.create({
        data: { nome: `Cupons inválidos ${randomUUID()}` },
        select: { id: true },
      });
      categoriaIds.push(categoria.id);
      const item = await app.prisma.item.create({
        data: {
          categoriaId: categoria.id,
          nome: `Item cupom ${randomUUID()}`,
          preco: new Prisma.Decimal("4.00"),
        },
        select: { id: true },
      });
      itemIds.push(item.id);

      const senhaHash = await bcrypt.hash(senhaTeste, 10);
      const admin = await app.prisma.usuario.create({
        data: {
          nome: "Admin cupons",
          email: `admin-cupons-${randomUUID()}@example.test`,
          telefone: "19999990004",
          senhaHash,
          tipo: TipoUsuario.ADMIN,
        },
        select: { id: true, email: true },
      });
      usuarioId = admin.id;
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: admin.email, senha: senhaTeste },
      });
      const cookie = cookieDaResposta(login.headers["set-cookie"]);

      const hoje = obterDataCivilSaoPaulo();
      const ontem = new Date(`${hoje}T00:00:00.000Z`);
      ontem.setUTCDate(ontem.getUTCDate() - 1);
      const dataOntem = ontem.toISOString().slice(0, 10);
      const criarCupom = async (
        nome: string,
        opcoes: {
          ativo?: boolean;
          validadeInicio?: string;
          validadeFim?: string;
          limiteUsos?: number;
          compraMinima?: number;
          itemIds?: string[];
        } = {},
      ) => {
        const resposta = await app.inject({
          method: "POST",
          url: "/admin/cupons",
          headers: { cookie },
          payload: {
            codigo: `${nome}-${randomUUID().slice(0, 8)}`,
            tipoDesconto: "FIXO",
            valor: 1,
            ativo: opcoes.ativo ?? true,
            validadeInicio: opcoes.validadeInicio ?? hoje,
            validadeFim: opcoes.validadeFim ?? hoje,
            limiteUsos: opcoes.limiteUsos,
            compraMinima: opcoes.compraMinima,
            itemIds: opcoes.itemIds ?? [item.id],
            comboIds: [],
          },
        });
        expect(resposta.statusCode).toBe(201);
        cupomIds.push(resposta.json().id);
        return resposta.json();
      };

      const inativo = await criarCupom("INATIVO", { ativo: false });
      const expirado = await criarCupom("EXPIRADO", {
        validadeInicio: dataOntem,
        validadeFim: dataOntem,
      });
      const esgotado = await criarCupom("ESGOTADO", { limiteUsos: 1 });
      const inelegivel = await criarCupom("INELEGIVEL", { itemIds: [] });
      const compraMinima = await criarCupom("MINIMO", { compraMinima: 10 });

      const pedido = await app.prisma.pedido.create({
        data: {
          tipoEntrega: "RETIRADA",
          nomeClienteHistorico: "Cliente de teste",
          telefoneClienteHistorico: "19999999999",
          subtotal: new Prisma.Decimal("4.00"),
          desconto: 0,
          taxaEntrega: 0,
          total: new Prisma.Decimal("4.00"),
          metodoPagamento: "PIX",
        },
        select: { id: true },
      });
      pedidoId = pedido.id;
      await app.prisma.cupomUtilizacao.create({
        data: { cupomId: esgotado.id, pedidoId: pedido.id },
      });

      const resultados = await Promise.all(
        [inativo, expirado, esgotado, inelegivel, compraMinima].map((cupom) =>
          app.inject({
            method: "POST",
            url: "/checkout/preview",
            payload: {
              tipoEntrega: "RETIRADA",
              metodoPagamento: "PIX",
              codigoCupom: cupom.codigo,
              itens: [{ itemId: item.id, quantidade: 1 }],
            },
          }),
        ),
      );
      expect(resultados.map(({ statusCode }) => statusCode)).toEqual([
        400, 400, 400, 200, 400,
      ]);
      expect(resultados[3]?.json()).toMatchObject({
        cupom: {
          codigo: inelegivel.codigo,
          desconto: "0.00",
          subtotalElegivel: "0.00",
        },
        total: "4.00",
      });

      const valorFixoMaiorQueSubtotal = await criarCupom("FIXO", {});
      await app.prisma.cupom.update({
        where: { id: valorFixoMaiorQueSubtotal.id },
        data: { valor: new Prisma.Decimal("99.00") },
      });
      const descontoLimitado = await app.inject({
        method: "POST",
        url: "/checkout/preview",
        payload: {
          tipoEntrega: "RETIRADA",
          metodoPagamento: "PIX",
          codigoCupom: valorFixoMaiorQueSubtotal.codigo,
          itens: [{ itemId: item.id, quantidade: 1 }],
        },
      });
      expect(descontoLimitado.statusCode).toBe(200);
      expect(descontoLimitado.json()).toMatchObject({
        subtotal: "4.00",
        cupom: { desconto: "4.00" },
        total: "0.00",
      });
    } finally {
      if (cupomIds.length > 0) {
        await app.prisma.cupomUtilizacao.deleteMany({
          where: { cupomId: { in: cupomIds } },
        });
      }
      if (pedidoId) {
        await app.prisma.pedido.deleteMany({ where: { id: pedidoId } });
      }
      if (cupomIds.length > 0) {
        await app.prisma.cupom.deleteMany({ where: { id: { in: cupomIds } } });
      }
      if (itemIds.length > 0) {
        await app.prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      }
      if (categoriaIds.length > 0) {
        await app.prisma.categoria.deleteMany({ where: { id: { in: categoriaIds } } });
      }
      if (usuarioId) {
        await app.prisma.usuario.deleteMany({ where: { id: usuarioId } });
      }
      await app.close();
    }
  });

  it("usa o endereço salvo do CLIENTE e calcula frete com origem/faixa de teste", async () => {
    const app = criarAplicacao();
    const categoriaIds: string[] = [];
    const itemIds: string[] = [];
    const faixaIds: string[] = [];
    let usuarioId: string | undefined;
    let faixasOriginais: Awaited<ReturnType<typeof app.prisma.faixaFrete.findMany>> = [];
    const latitudeAnterior = process.env.RESTAURANTE_LATITUDE;
    const longitudeAnterior = process.env.RESTAURANTE_LONGITUDE;

    try {
      await app.ready();
      await withTestDatabaseLock(
        app.prisma,
        "leosburger-test-faixas-frete",
        async () => {
          try {
            faixasOriginais = await app.prisma.faixaFrete.findMany();
            await app.prisma.faixaFrete.updateMany({
              where: { ativa: true },
              data: { ativa: false },
            });
            const faixa = await app.prisma.faixaFrete.create({
              data: {
                distanciaMinima: new Prisma.Decimal("0.00"),
                distanciaMaxima: new Prisma.Decimal("6.00"),
                valor: new Prisma.Decimal("7.25"),
              },
              select: { id: true },
            });
            faixaIds.push(faixa.id);
            process.env.RESTAURANTE_LATITUDE = "-22.900000";
            process.env.RESTAURANTE_LONGITUDE = "-47.060000";

            const categoria = await app.prisma.categoria.create({
              data: { nome: `Frete preview ${randomUUID()}` },
              select: { id: true },
            });
            categoriaIds.push(categoria.id);
            const item = await app.prisma.item.create({
              data: {
                categoriaId: categoria.id,
                nome: `Item frete ${randomUUID()}`,
                preco: new Prisma.Decimal("8.50"),
              },
              select: { id: true },
            });
            itemIds.push(item.id);

            const usuario = await app.prisma.usuario.create({
              data: {
                nome: "Cliente frete",
                email: `cliente-frete-${randomUUID()}@example.test`,
                telefone: "19999990005",
                senhaHash: await bcrypt.hash(senhaTeste, 10),
                tipo: TipoUsuario.CLIENTE,
              },
              select: { id: true, email: true },
            });
            usuarioId = usuario.id;
            await app.prisma.endereco.create({
              data: {
                usuarioId,
                cep: "13010000",
                logradouro: "Rua de teste",
                numero: "10",
                bairro: "Centro",
                cidade: "Campinas",
                estado: "SP",
                latitude: new Prisma.Decimal("-22.900000"),
                longitude: new Prisma.Decimal("-47.060000"),
              },
            });
            const login = await app.inject({
              method: "POST",
              url: "/auth/login",
              payload: { email: usuario.email, senha: senhaTeste },
            });
            const resposta = await app.inject({
              method: "POST",
              url: "/checkout/preview",
              headers: { cookie: cookieDaResposta(login.headers["set-cookie"]) },
              payload: {
                tipoEntrega: "ENTREGA",
                metodoPagamento: "CREDITO",
                itens: [{ itemId: item.id, quantidade: 1 }],
              },
            });

            expect(resposta.statusCode).toBe(200);
            expect(resposta.json()).toMatchObject({
              subtotal: "8.50",
              frete: "7.25",
              distanciaKm: "0.000000",
              situacaoEntrega: "DISPONIVEL",
              total: "15.75",
            });
            expect(resposta.json().endereco.situacao).toBe("CONFIRMADO");
          } finally {
            if (faixaIds.length > 0) {
              await app.prisma.faixaFrete.deleteMany({
                where: { id: { in: faixaIds } },
              });
            }
            for (const faixa of faixasOriginais) {
              await app.prisma.faixaFrete.update({
                where: { id: faixa.id },
                data: { ativa: faixa.ativa },
              });
            }
            if (itemIds.length > 0) {
              await app.prisma.item.deleteMany({
                where: { id: { in: itemIds } },
              });
            }
            if (categoriaIds.length > 0) {
              await app.prisma.categoria.deleteMany({
                where: { id: { in: categoriaIds } },
              });
            }
            if (usuarioId) {
              await app.prisma.usuario.deleteMany({ where: { id: usuarioId } });
            }
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
    } finally {
      await app.close();
    }
  });
});
