import { randomUUID } from "node:crypto";
import {
  MetodoPagamento,
  Prisma,
  TipoEntrega,
  TipoUsuario,
} from "@prisma/client";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";

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

async function comCombosAdmin(
  teste: (
    app: FastifyInstance,
    adminCookie: string,
    clienteCookie: string,
    rastrearCategoria: (id: string) => void,
    rastrearItem: (id: string) => void,
    rastrearCombo: (id: string) => void,
    rastrearPedido: (id: string) => void,
  ) => Promise<void>,
) {
  const app = criarAplicacao();
  const categoriaIds: string[] = [];
  const itemIds: string[] = [];
  const comboIds: string[] = [];
  const pedidoIds: string[] = [];
  const usuarioIds: string[] = [];

  try {
    await app.ready();

    const senhaHash = await bcrypt.hash(senhaTeste, 10);
    const admin = await app.prisma.usuario.create({
      data: {
        nome: "Administrador de teste",
        email: `combos-admin-${randomUUID()}@example.test`,
        telefone: "19999990001",
        senhaHash,
        tipo: TipoUsuario.ADMIN,
      },
      select: { id: true, email: true },
    });
    const cliente = await app.prisma.usuario.create({
      data: {
        nome: "Cliente de teste",
        email: `combos-cliente-${randomUUID()}@example.test`,
        telefone: "19999990002",
        senhaHash,
        tipo: TipoUsuario.CLIENTE,
      },
      select: { id: true, email: true },
    });
    usuarioIds.push(admin.id, cliente.id);

    const loginAdmin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: admin.email, senha: senhaTeste },
    });
    const loginCliente = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: cliente.email, senha: senhaTeste },
    });

    expect(loginAdmin.statusCode).toBe(200);
    expect(loginCliente.statusCode).toBe(200);

    await teste(
      app,
      cookieDaResposta(loginAdmin.headers["set-cookie"]),
      cookieDaResposta(loginCliente.headers["set-cookie"]),
      (id) => categoriaIds.push(id),
      (id) => itemIds.push(id),
      (id) => comboIds.push(id),
      (id) => pedidoIds.push(id),
    );
  } finally {
    if (pedidoIds.length > 0) {
      await app.prisma.pedido.deleteMany({
        where: { id: { in: pedidoIds } },
      });
    }
    if (comboIds.length > 0) {
      await app.prisma.combo.deleteMany({
        where: { id: { in: comboIds } },
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
    if (usuarioIds.length > 0) {
      await app.prisma.usuario.deleteMany({
        where: { id: { in: usuarioIds } },
      });
    }
    const [pedidosRestantes, combosRestantes, itensRestantes, categoriasRestantes, usuariosRestantes] =
      await Promise.all([
        pedidoIds.length > 0
          ? app.prisma.pedido.count({ where: { id: { in: pedidoIds } } })
          : 0,
        comboIds.length > 0
          ? app.prisma.combo.count({ where: { id: { in: comboIds } } })
          : 0,
        itemIds.length > 0
          ? app.prisma.item.count({ where: { id: { in: itemIds } } })
          : 0,
        categoriaIds.length > 0
          ? app.prisma.categoria.count({ where: { id: { in: categoriaIds } } })
          : 0,
        usuarioIds.length > 0
          ? app.prisma.usuario.count({ where: { id: { in: usuarioIds } } })
          : 0,
      ]);
    if (
      pedidosRestantes +
        combosRestantes +
        itensRestantes +
        categoriasRestantes +
        usuariosRestantes >
      0
    ) {
      throw new Error("A limpeza deixou fixtures da administração de combos no banco.");
    }
    await app.close();
  }
}

async function criarCategoria(app: FastifyInstance) {
  return app.prisma.categoria.create({
    data: { nome: `Categoria combo ${randomUUID()}` },
    select: { id: true },
  });
}

async function criarItem(
  app: FastifyInstance,
  categoriaId: string,
  ativo = true,
) {
  return app.prisma.item.create({
    data: {
      categoriaId,
      nome: `Item combo ${randomUUID()}`,
      preco: 12.5,
      ativo,
    },
    select: { id: true, nome: true },
  });
}

const origemValida = { origin: "http://localhost:5173" };

describe("administração de combos", () => {
  it("exige sessão e papel ADMIN", async () => {
    await comCombosAdmin(async (app, adminCookie, clienteCookie) => {
      const semSessao = await app.inject({
        method: "GET",
        url: "/admin/combos",
      });
      const cliente = await app.inject({
        method: "GET",
        url: "/admin/combos",
        headers: { cookie: clienteCookie },
      });
      const clienteEscrita = await app.inject({
        method: "POST",
        url: "/admin/combos",
        headers: { cookie: clienteCookie, ...origemValida },
        payload: {
          nome: `Não autorizado ${randomUUID()}`,
          preco: 25,
          itens: [{ itemId: randomUUID(), quantidade: 1 }],
        },
      });
      const origemNaoPermitida = await app.inject({
        method: "POST",
        url: "/admin/combos",
        headers: {
          cookie: adminCookie,
          origin: "https://origem-nao-permitida.example",
        },
        payload: {
          nome: `Origem bloqueada ${randomUUID()}`,
          preco: 25,
          itens: [{ itemId: randomUUID(), quantidade: 1 }],
        },
      });
      const patchOrigemNaoPermitida = await app.inject({
        method: "PATCH",
        url: `/admin/combos/${randomUUID()}`,
        headers: {
          cookie: adminCookie,
          origin: "https://origem-nao-permitida.example",
        },
        payload: { ativo: false },
      });
      const admin = await app.inject({
        method: "GET",
        url: "/admin/combos",
        headers: { cookie: adminCookie },
      });

      expect(semSessao.statusCode).toBe(401);
      expect(cliente.statusCode).toBe(403);
      expect(clienteEscrita.statusCode).toBe(403);
      expect(origemNaoPermitida.statusCode).toBe(403);
      expect(patchOrigemNaoPermitida.statusCode).toBe(403);
      expect(admin.statusCode).toBe(200);
    });
  });

  it("lista e consulta combos inativos, expondo componentes inativos sem campos internos", async () => {
    await comCombosAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria, trackItem, trackCombo) => {
        const categoria = await criarCategoria(app);
        trackCategoria(categoria.id);
        const itemInativo = await criarItem(app, categoria.id, false);
        trackItem(itemInativo.id);
        const combo = await app.prisma.combo.create({
          data: {
            nome: `Combo inativo ${randomUUID()}`,
            preco: 31.25,
            ativo: false,
            itensCombo: {
              create: {
                itemId: itemInativo.id,
                quantidade: 2,
              },
            },
          },
          select: { id: true },
        });
        trackCombo(combo.id);

        const lista = await app.inject({
          method: "GET",
          url: "/admin/combos",
          headers: { cookie: adminCookie },
        });
        const detalhe = await app.inject({
          method: "GET",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie },
        });
        const resposta = detalhe.json();
        const combos = lista.json();

        expect(lista.statusCode).toBe(200);
        expect(combos.map((item: { id: string }) => item.id)).toContain(combo.id);
        expect(detalhe.statusCode).toBe(200);
        expect(resposta).toMatchObject({
          id: combo.id,
          ativo: false,
          preco: 31.25,
          possuiItensInativos: true,
          itens: [
            {
              id: itemInativo.id,
              nome: itemInativo.nome,
              quantidade: 2,
              ativo: false,
            },
          ],
        });
        expect(detalhe.body).not.toContain("itensCombo");
        expect(detalhe.body).not.toContain("criadoEm");
        expect(detalhe.body).not.toContain("atualizadoEm");
        expect(resposta.itensRemovidos).toEqual([]);

        const ativado = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: { ativo: true },
        });
        const indisponivelPublico = await app.inject({
          method: "GET",
          url: `/combos/${combo.id}`,
        });
        expect(ativado.statusCode).toBe(200);
        expect(ativado.json().ativo).toBe(true);
        expect(indisponivelPublico.statusCode).toBe(404);
      },
    );
  });

  it("retorna 400 para UUID inválido e 404 para combo inexistente", async () => {
    await comCombosAdmin(async (app, adminCookie) => {
      const invalido = await app.inject({
        method: "GET",
        url: "/admin/combos/invalido",
        headers: { cookie: adminCookie },
      });
      const inexistente = await app.inject({
        method: "GET",
        url: `/admin/combos/${randomUUID()}`,
        headers: { cookie: adminCookie },
      });
      const patchInexistente = await app.inject({
        method: "PATCH",
        url: `/admin/combos/${randomUUID()}`,
        headers: { cookie: adminCookie, ...origemValida },
        payload: { nome: "Combo inexistente" },
      });

      expect(invalido.statusCode).toBe(400);
      expect(inexistente.statusCode).toBe(404);
      expect(patchInexistente.statusCode).toBe(404);
      expect(inexistente.json()).toEqual({
        status: 404,
        error: "NOT_FOUND",
        message: "Recurso não encontrado.",
      });
    });
  });

  it("cria combo e composição atomicamente com preço manual", async () => {
    await comCombosAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria, trackItem, trackCombo) => {
        const categoria = await criarCategoria(app);
        trackCategoria(categoria.id);
        const item = await criarItem(app, categoria.id);
        trackItem(item.id);
        const nome = `Combo criado ${randomUUID()}`;
        const resposta = await app.inject({
          method: "POST",
          url: "/admin/combos",
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            nome,
            preco: 47.35,
            itens: [{ itemId: item.id, quantidade: 3 }],
          },
        });
        const criado = resposta.json();
        if (typeof criado.id === "string") {
          trackCombo(criado.id);
        }

        const persistido =
          typeof criado.id === "string"
            ? await app.prisma.combo.findUnique({
                where: { id: criado.id },
                select: {
                  preco: true,
                  itensCombo: {
                    select: { itemId: true, quantidade: true },
                  },
                },
              })
            : null;

        expect(resposta.statusCode).toBe(201);
        expect(criado).toMatchObject({
          nome,
          preco: 47.35,
          ativo: true,
          possuiItensInativos: false,
          itens: [{ id: item.id, quantidade: 3, ativo: true }],
        });
        expect(persistido?.preco.toNumber()).toBe(47.35);
        expect(persistido?.itensCombo).toEqual([
          { itemId: item.id, quantidade: 3 },
        ]);
      },
    );
  });

  it("rejeita entrada inválida, duplicidades e campos não permitidos sem criação parcial", async () => {
    await comCombosAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria, trackItem, trackCombo) => {
        const categoria = await criarCategoria(app);
        trackCategoria(categoria.id);
        const item = await criarItem(app, categoria.id);
        trackItem(item.id);
        const nome = `Combo validação ${randomUUID()}`;
        const payloadValido = {
          nome,
          preco: 25,
          itens: [{ itemId: item.id, quantidade: 1 }],
        };
        const criado = await app.inject({
          method: "POST",
          url: "/admin/combos",
          headers: { cookie: adminCookie, ...origemValida },
          payload: payloadValido,
        });
        trackCombo(criado.json().id);

        const duplicado = await app.inject({
          method: "POST",
          url: "/admin/combos",
          headers: { cookie: adminCookie, ...origemValida },
          payload: payloadValido,
        });
        const nomeItemInexistente = `Item inexistente ${randomUUID()}`;
        const nomeQuantidadeInvalida = `Quantidade inválida ${randomUUID()}`;
        const itemInexistente = await app.inject({
          method: "POST",
          url: "/admin/combos",
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            ...payloadValido,
            nome: nomeItemInexistente,
            itens: [{ itemId: randomUUID(), quantidade: 1 }],
          },
        });
        const quantidadeInvalida = await app.inject({
          method: "POST",
          url: "/admin/combos",
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            ...payloadValido,
            nome: nomeQuantidadeInvalida,
            itens: [{ itemId: item.id, quantidade: 0 }],
          },
        });
        const duplicadoNaComposicao = await app.inject({
          method: "POST",
          url: "/admin/combos",
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            ...payloadValido,
            nome: `Composição duplicada ${randomUUID()}`,
            itens: [
              { itemId: item.id, quantidade: 1 },
              { itemId: item.id, quantidade: 2 },
            ],
          },
        });
        const precoInvalido = await app.inject({
          method: "POST",
          url: "/admin/combos",
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            ...payloadValido,
            nome: `Preço inválido ${randomUUID()}`,
            preco: 10.001,
          },
        });
        const precoNegativo = await app.inject({
          method: "POST",
          url: "/admin/combos",
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            ...payloadValido,
            nome: `Preço negativo ${randomUUID()}`,
            preco: -0.01,
          },
        });
        const campoDesconhecido = await app.inject({
          method: "POST",
          url: "/admin/combos",
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            ...payloadValido,
            nome: `Campo desconhecido ${randomUUID()}`,
            ativo: false,
          },
        });

        expect(duplicado.statusCode).toBe(409);
        expect(itemInexistente.statusCode).toBe(400);
        expect(quantidadeInvalida.statusCode).toBe(400);
        expect(duplicadoNaComposicao.statusCode).toBe(400);
        expect(precoInvalido.statusCode).toBe(400);
        expect(precoNegativo.statusCode).toBe(400);
        expect(campoDesconhecido.statusCode).toBe(400);
        expect(
          await app.prisma.combo.count({
            where: { nome: { in: [nomeItemInexistente, nomeQuantidadeInvalida] } },
          }),
        ).toBe(0);
      },
    );
  });

  it("atualiza campos e acrescenta ou altera itens sem recalcular preço ou remover omissões", async () => {
    await comCombosAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria, trackItem, trackCombo) => {
        const categoria = await criarCategoria(app);
        trackCategoria(categoria.id);
        const itemExistente = await criarItem(app, categoria.id);
        const itemNovoInativo = await criarItem(app, categoria.id, false);
        trackItem(itemExistente.id);
        trackItem(itemNovoInativo.id);
        const combo = await app.prisma.combo.create({
          data: {
            nome: `Combo para editar ${randomUUID()}`,
            preco: 30,
            ativo: false,
            itensCombo: {
              create: { itemId: itemExistente.id, quantidade: 1 },
            },
          },
          select: { id: true },
        });
        trackCombo(combo.id);

        const resposta = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            preco: 58.9,
            descricao: "Preço comercial definido pelo proprietário.",
            itens: [
              { itemId: itemExistente.id, quantidade: 4 },
              { itemId: itemNovoInativo.id, quantidade: 2 },
            ],
          },
        });
        const corpo = resposta.json();
        const persistido = await app.prisma.combo.findUnique({
          where: { id: combo.id },
          select: {
            preco: true,
            ativo: true,
            itensCombo: {
              orderBy: { itemId: "asc" },
              select: { itemId: true, quantidade: true },
            },
          },
        });

        expect(resposta.statusCode).toBe(200);
        expect(corpo).toMatchObject({
          preco: 58.9,
          ativo: false,
          descricao: "Preço comercial definido pelo proprietário.",
          possuiItensInativos: true,
        });
        expect(persistido?.preco.toNumber()).toBe(58.9);
        expect(persistido?.ativo).toBe(false);
        expect(persistido?.itensCombo).toHaveLength(2);
        expect(persistido?.itensCombo).toEqual(
          expect.arrayContaining([
            { itemId: itemExistente.id, quantidade: 4 },
            { itemId: itemNovoInativo.id, quantidade: 2 },
          ]),
        );
      },
    );
  });

  it("rejeita referências inexistentes sem persistir campos ou partes da composição", async () => {
    await comCombosAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria, trackItem, trackCombo) => {
        const categoria = await criarCategoria(app);
        trackCategoria(categoria.id);
        const item = await criarItem(app, categoria.id);
        trackItem(item.id);
        const combo = await app.prisma.combo.create({
          data: {
            nome: `Combo transação ${randomUUID()}`,
            preco: 33,
            itensCombo: {
              create: { itemId: item.id, quantidade: 1 },
            },
          },
          select: { id: true, nome: true },
        });
        trackCombo(combo.id);
        const novoNome = `Não deve persistir ${randomUUID()}`;

        const resposta = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            nome: novoNome,
            preco: 99,
            itens: [
              { itemId: item.id, quantidade: 5 },
              { itemId: randomUUID(), quantidade: 2 },
            ],
          },
        });
        const persistido = await app.prisma.combo.findUnique({
          where: { id: combo.id },
          select: {
            nome: true,
            preco: true,
            itensCombo: { select: { quantidade: true } },
          },
        });

        expect(resposta.statusCode).toBe(400);
        expect(persistido?.nome).toBe(combo.nome);
        expect(persistido?.preco.toNumber()).toBe(33);
        expect(persistido?.itensCombo).toEqual([{ quantidade: 1 }]);
      },
    );
  });

  it("mapeia conflito de nome e permite ativar e desativar combos", async () => {
    await comCombosAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria, trackItem, trackCombo) => {
        const categoria = await criarCategoria(app);
        trackCategoria(categoria.id);
        const item = await criarItem(app, categoria.id);
        trackItem(item.id);
        const comboAlvo = await app.prisma.combo.create({
          data: {
            nome: `Combo alvo ${randomUUID()}`,
            preco: 20,
            itensCombo: { create: { itemId: item.id, quantidade: 1 } },
          },
          select: { id: true },
        });
        const comboConflito = await app.prisma.combo.create({
          data: { nome: `Combo conflito ${randomUUID()}`, preco: 20 },
          select: { id: true, nome: true },
        });
        trackCombo(comboAlvo.id);
        trackCombo(comboConflito.id);

        const conflito = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${comboAlvo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: { nome: comboConflito.nome },
        });
        const ativado = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${comboAlvo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: { ativo: true },
        });
        const disponivel = await app.inject({
          method: "GET",
          url: `/combos/${comboAlvo.id}`,
        });
        const desativado = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${comboAlvo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: { ativo: false },
        });
        const indisponivel = await app.inject({
          method: "GET",
          url: `/combos/${comboAlvo.id}`,
        });
        const continuaNaAdministracao = await app.inject({
          method: "GET",
          url: `/admin/combos/${comboAlvo.id}`,
          headers: { cookie: adminCookie },
        });

        expect(conflito.statusCode).toBe(409);
        expect(ativado.statusCode).toBe(200);
        expect(ativado.json().ativo).toBe(true);
        expect(disponivel.statusCode).toBe(200);
        expect(desativado.statusCode).toBe(200);
        expect(desativado.json().ativo).toBe(false);
        expect(indisponivel.statusCode).toBe(404);
        expect(continuaNaAdministracao.statusCode).toBe(200);
        expect(continuaNaAdministracao.json().ativo).toBe(false);
      },
    );
  });

  it("remove logicamente, separa associações removidas e reativa sem duplicar", async () => {
    await comCombosAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria, trackItem, trackCombo) => {
        const categoria = await criarCategoria(app);
        trackCategoria(categoria.id);
        const itemRemovido = await criarItem(app, categoria.id);
        const itemMantido = await criarItem(app, categoria.id);
        trackItem(itemRemovido.id);
        trackItem(itemMantido.id);
        const combo = await app.prisma.combo.create({
          data: {
            nome: `Combo composição ${randomUUID()}`,
            preco: 28,
            itensCombo: {
              create: [
                { itemId: itemRemovido.id, quantidade: 1 },
                { itemId: itemMantido.id, quantidade: 2 },
              ],
            },
          },
          select: { id: true },
        });
        trackCombo(combo.id);

        const removido = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: { removerItemIds: [itemRemovido.id] },
        });
        const consultaPadrao = await app.inject({
          method: "GET",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie },
        });
        const consultaSemRemovidos = await app.inject({
          method: "GET",
          url: `/admin/combos/${combo.id}?incluirRemovidos=false`,
          headers: { cookie: adminCookie },
        });
        const consultaCompleta = await app.inject({
          method: "GET",
          url: `/admin/combos/${combo.id}?incluirRemovidos=true`,
          headers: { cookie: adminCookie },
        });
        const publicoAposRemocao = await app.inject({
          method: "GET",
          url: `/combos/${combo.id}`,
        });
        const estadoRemovido = await app.prisma.itemCombo.findUnique({
          where: {
            comboId_itemId: { comboId: combo.id, itemId: itemRemovido.id },
          },
          select: { removidoEm: true },
        });

        expect(removido.statusCode).toBe(200);
        expect(removido.json().itens.map((item: { id: string }) => item.id)).toEqual([
          itemMantido.id,
        ]);
        expect(consultaPadrao.json().itensRemovidos).toEqual([]);
        expect(consultaSemRemovidos.json().itensRemovidos).toEqual([]);
        expect(consultaCompleta.json().itensRemovidos).toMatchObject([
          {
            id: itemRemovido.id,
            quantidade: 1,
            ativo: true,
          },
        ]);
        expect(consultaCompleta.json().itensRemovidos[0].removidoEm).toEqual(
          expect.any(String),
        );
        expect(consultaCompleta.json().itens.map((item: { id: string }) => item.id)).toEqual([
          itemMantido.id,
        ]);
        expect(publicoAposRemocao.json().itens.map((item: { id: string }) => item.id)).toEqual([
          itemMantido.id,
        ]);
        expect(estadoRemovido?.removidoEm).toBeInstanceOf(Date);

        const reativado = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: { itens: [{ itemId: itemRemovido.id, quantidade: 3 }] },
        });
        const associacoes = await app.prisma.itemCombo.findMany({
          where: { comboId: combo.id, itemId: itemRemovido.id },
          select: { quantidade: true, removidoEm: true },
        });
        const consultaReativada = await app.inject({
          method: "GET",
          url: `/admin/combos/${combo.id}?incluirRemovidos=true`,
          headers: { cookie: adminCookie },
        });

        expect(reativado.statusCode).toBe(200);
        expect(reativado.json().itens).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: itemRemovido.id, quantidade: 3 }),
          ]),
        );
        expect(associacoes).toEqual([{ quantidade: 3, removidoEm: null }]);
        expect(consultaReativada.json().itensRemovidos).toEqual([]);
        expect(
          await app.prisma.itemCombo.count({
            where: { comboId: combo.id, itemId: itemRemovido.id },
          }),
        ).toBe(1);
      },
    );
  });

  it("rejeita remoções duplicadas, ambíguas ou fora da composição ativa", async () => {
    await comCombosAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria, trackItem, trackCombo) => {
        const categoria = await criarCategoria(app);
        trackCategoria(categoria.id);
        const item = await criarItem(app, categoria.id);
        const itemSemAssociacao = await criarItem(app, categoria.id);
        trackItem(item.id);
        trackItem(itemSemAssociacao.id);
        const combo = await app.prisma.combo.create({
          data: {
            nome: `Combo valida remoção ${randomUUID()}`,
            preco: 25,
            itensCombo: { create: { itemId: item.id, quantidade: 1 } },
          },
          select: { id: true },
        });
        trackCombo(combo.id);

        const duplicada = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: { removerItemIds: [item.id, item.id] },
        });
        const ambigua = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            itens: [{ itemId: item.id, quantidade: 2 }],
            removerItemIds: [item.id],
          },
        });
        const naoAssociada = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: { removerItemIds: [itemSemAssociacao.id] },
        });
        const idInexistente = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: { removerItemIds: [randomUUID()] },
        });
        const queryInvalida = await app.inject({
          method: "GET",
          url: `/admin/combos/${combo.id}?incluirRemovidos=sim`,
          headers: { cookie: adminCookie },
        });

        expect(duplicada.statusCode).toBe(400);
        expect(ambigua.statusCode).toBe(400);
        expect(naoAssociada.statusCode).toBe(400);
        expect(idInexistente.statusCode).toBe(400);
        expect(idInexistente.json().details[0].field).toBe("/removerItemIds");
        expect(queryInvalida.statusCode).toBe(400);
        expect(
          await app.prisma.itemCombo.findMany({
            where: { comboId: combo.id },
            select: { itemId: true, removidoEm: true, quantidade: true },
          }),
        ).toEqual([{ itemId: item.id, removidoEm: null, quantidade: 1 }]);
      },
    );
  });

  it("reverte alterações da composição quando outro campo do PATCH conflita", async () => {
    await comCombosAdmin(
      async (app, adminCookie, _clienteCookie, trackCategoria, trackItem, trackCombo) => {
        const categoria = await criarCategoria(app);
        trackCategoria(categoria.id);
        const itemAtual = await criarItem(app, categoria.id);
        const itemNovo = await criarItem(app, categoria.id);
        trackItem(itemAtual.id);
        trackItem(itemNovo.id);
        const comboAlvo = await app.prisma.combo.create({
          data: {
            nome: `Combo para rollback ${randomUUID()}`,
            preco: 20,
            itensCombo: {
              create: { itemId: itemAtual.id, quantidade: 1 },
            },
          },
          select: { id: true, nome: true },
        });
        const comboConflito = await app.prisma.combo.create({
          data: {
            nome: `Nome já usado ${randomUUID()}`,
            preco: 20,
          },
          select: { id: true, nome: true },
        });
        trackCombo(comboAlvo.id);
        trackCombo(comboConflito.id);

        const resposta = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${comboAlvo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            nome: comboConflito.nome,
            itens: [{ itemId: itemNovo.id, quantidade: 3 }],
            removerItemIds: [itemAtual.id],
          },
        });
        const persistido = await app.prisma.combo.findUnique({
          where: { id: comboAlvo.id },
          select: {
            nome: true,
            itensCombo: {
              select: { itemId: true, quantidade: true, removidoEm: true },
            },
          },
        });

        expect(resposta.statusCode).toBe(409);
        expect(persistido?.nome).toBe(comboAlvo.nome);
        expect(persistido?.itensCombo).toEqual([
          { itemId: itemAtual.id, quantidade: 1, removidoEm: null },
        ]);
      },
    );
  });

  it("preserva o snapshot histórico do pedido após alteração da composição atual", async () => {
    await comCombosAdmin(
      async (
        app,
        adminCookie,
        _clienteCookie,
        trackCategoria,
        trackItem,
        trackCombo,
        trackPedido,
      ) => {
        const categoria = await criarCategoria(app);
        trackCategoria(categoria.id);
        const itemAntigo = await criarItem(app, categoria.id);
        const itemNovo = await criarItem(app, categoria.id);
        trackItem(itemAntigo.id);
        trackItem(itemNovo.id);
        const combo = await app.prisma.combo.create({
          data: {
            nome: `Combo histórico ${randomUUID()}`,
            preco: 30,
            itensCombo: {
              create: { itemId: itemAntigo.id, quantidade: 1 },
            },
          },
          select: { id: true },
        });
        trackCombo(combo.id);
        const composicaoHistorica = [
          { itemId: itemAntigo.id, nome: "Nome no momento do pedido", quantidade: 1 },
        ];
        const pedido = await app.prisma.pedido.create({
          data: {
            tipoEntrega: TipoEntrega.RETIRADA,
            nomeClienteHistorico: "Cliente histórico",
            telefoneClienteHistorico: "19999999999",
            subtotal: 30,
            desconto: 0,
            taxaEntrega: 0,
            total: 30,
            metodoPagamento: MetodoPagamento.PIX,
            itensPedido: {
              create: {
                comboId: combo.id,
                nomeHistorico: "Combo histórico",
                precoUnitarioHistorico: 30,
                quantidade: 1,
                subtotal: 30,
                composicaoHistorica:
                  composicaoHistorica satisfies Prisma.InputJsonValue,
              },
            },
          },
          select: { id: true },
        });
        trackPedido(pedido.id);

        const resposta = await app.inject({
          method: "PATCH",
          url: `/admin/combos/${combo.id}`,
          headers: { cookie: adminCookie, ...origemValida },
          payload: {
            preco: 35,
            ativo: false,
            removerItemIds: [itemAntigo.id],
          },
        });
        const itemHistorico = await app.prisma.itemPedido.findFirst({
          where: { pedidoId: pedido.id, comboId: combo.id },
          select: {
            precoUnitarioHistorico: true,
            composicaoHistorica: true,
          },
        });

        expect(resposta.statusCode).toBe(200);
        expect(itemHistorico?.precoUnitarioHistorico.toNumber()).toBe(30);
        expect(itemHistorico?.composicaoHistorica).toEqual(composicaoHistorica);
        expect(
          await app.prisma.combo.findUnique({
            where: { id: combo.id },
            select: { ativo: true },
          }),
        ).toEqual({ ativo: false });
        expect(
          await app.prisma.itemCombo.findUnique({
            where: {
              comboId_itemId: { comboId: combo.id, itemId: itemAntigo.id },
            },
            select: { removidoEm: true },
          }),
        ).toMatchObject({ removidoEm: expect.any(Date) });
      },
    );
  });

  it("documenta endpoints e schemas administrativos no OpenAPI", async () => {
    await comCombosAdmin(async (app) => {
      const documento = app.swagger();
      const serializado = JSON.stringify(documento);
      const consulta = documento.paths?.["/admin/combos"]?.get;

      expect(documento.paths?.["/admin/combos"]?.get?.responses).toHaveProperty("200");
      expect(consulta?.security).toEqual([{ sessionCookie: [] }]);
      expect(documento.paths?.["/admin/combos"]?.post?.responses).toHaveProperty("201");
      expect(documento.paths?.["/admin/combos/{id}"]?.get?.responses).toHaveProperty(
        "404",
      );
      expect(
        documento.paths?.["/admin/combos/{id}"]?.patch?.responses,
      ).toHaveProperty("409");
      expect(serializado).toContain("possuiItensInativos");
      expect(serializado).toContain("itemId");
      expect(serializado).toContain("removerItemIds");
      expect(serializado).toContain("incluirRemovidos");
      expect(serializado).toContain("removidoEm");
    });
  });
});
