import { randomUUID } from "node:crypto";
import { TipoUsuario } from "@prisma/client";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";
import { obterDataCivilSaoPaulo } from "../../src/services/cupons.js";

const senhaTeste = "Senha-forte-123";

function cookieDaResposta(cabecalho: unknown): string {
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

describe("administração de cupons", () => {
  it("protege rotas, persiste elegibilidade e valida criação e atualização", async () => {
    const app = criarAplicacao();
    const usuarioIds: string[] = [];
    const cupomIds: string[] = [];
    let categoriaId: string | undefined;
    let itemId: string | undefined;

    try {
      await app.ready();
      const semSessao = await app.inject({
        method: "GET",
        url: "/admin/cupons",
      });
      expect(semSessao.statusCode).toBe(401);

      const senhaHash = await bcrypt.hash(senhaTeste, 10);
      const [admin, cliente] = await Promise.all([
        app.prisma.usuario.create({
          data: {
            nome: "Admin cupons",
            email: `admin-cupons-${randomUUID()}@example.test`,
            telefone: "19999990001",
            senhaHash,
            tipo: TipoUsuario.ADMIN,
          },
          select: { id: true, email: true },
        }),
        app.prisma.usuario.create({
          data: {
            nome: "Cliente cupons",
            email: `cliente-cupons-${randomUUID()}@example.test`,
            telefone: "19999990002",
            senhaHash,
            tipo: TipoUsuario.CLIENTE,
          },
          select: { id: true, email: true },
        }),
      ]);
      usuarioIds.push(admin.id, cliente.id);

      const [loginAdmin, loginCliente] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: admin.email, senha: senhaTeste },
        }),
        app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: cliente.email, senha: senhaTeste },
        }),
      ]);
      const cookieAdmin = cookieDaResposta(loginAdmin.headers["set-cookie"]);
      const cookieCliente = cookieDaResposta(loginCliente.headers["set-cookie"]);

      const clienteSemPermissao = await app.inject({
        method: "GET",
        url: "/admin/cupons",
        headers: { cookie: cookieCliente },
      });
      expect(clienteSemPermissao.statusCode).toBe(403);

      const categoria = await app.prisma.categoria.create({
        data: { nome: `Cupom teste ${randomUUID()}` },
        select: { id: true },
      });
      categoriaId = categoria.id;
      const item = await app.prisma.item.create({
        data: {
          categoriaId,
          nome: `Item cupom ${randomUUID()}`,
          preco: "10.00",
        },
        select: { id: true },
      });
      itemId = item.id;

      const dadosCupom = {
        codigo: `PROMO-${randomUUID().slice(0, 8)}`,
        tipoDesconto: "PERCENTUAL",
        valor: 15,
        ativo: true,
        validadeInicio: obterDataCivilSaoPaulo(),
        validadeFim: obterDataCivilSaoPaulo(),
        itemIds: [itemId],
        comboIds: [],
      };
      const escritaCliente = await app.inject({
        method: "POST",
        url: "/admin/cupons",
        headers: { cookie: cookieCliente },
        payload: dadosCupom,
      });
      const origemInvalida = await app.inject({
        method: "POST",
        url: "/admin/cupons",
        headers: {
          cookie: cookieAdmin,
          origin: "https://origem-invalida.example",
        },
        payload: dadosCupom,
      });
      expect(escritaCliente.statusCode).toBe(403);
      expect(origemInvalida.statusCode).toBe(403);

      const criado = await app.inject({
        method: "POST",
        url: "/admin/cupons",
        headers: {
          cookie: cookieAdmin,
          origin: "http://localhost:5173",
        },
        payload: dadosCupom,
      });
      expect(criado.statusCode).toBe(201);
      cupomIds.push(criado.json().id);
      expect(criado.json()).toMatchObject({
        codigo: dadosCupom.codigo.toUpperCase(),
        tipoDesconto: "PERCENTUAL",
        valor: "15.00",
        ativo: true,
        itemIds: [itemId],
        comboIds: [],
      });

      const atualizado = await app.inject({
        method: "PUT",
        url: `/admin/cupons/${criado.json().id}`,
        headers: {
          cookie: cookieAdmin,
          origin: "http://localhost:5173",
        },
        payload: {
          ...dadosCupom,
          tipoDesconto: "FIXO",
          valor: 2.5,
          ativo: false,
          itemIds: [],
        },
      });
      expect(atualizado.statusCode).toBe(200);
      expect(atualizado.json()).toMatchObject({
        id: criado.json().id,
        tipoDesconto: "FIXO",
        valor: "2.50",
        ativo: false,
        itemIds: [],
      });

      const listados = await app.inject({
        method: "GET",
        url: "/admin/cupons",
        headers: { cookie: cookieAdmin },
      });
      expect(listados.statusCode).toBe(200);
      expect(listados.json()).toContainEqual(atualizado.json());

      const percentualAcimaDoLimite = await app.inject({
        method: "POST",
        url: "/admin/cupons",
        headers: { cookie: cookieAdmin },
        payload: {
          ...dadosCupom,
          codigo: `LIMITE-${randomUUID().slice(0, 8)}`,
          valor: 30.01,
        },
      });
      expect(percentualAcimaDoLimite.statusCode).toBe(400);

      const cupomSemRecursoElegivel = await app.inject({
        method: "POST",
        url: "/admin/cupons",
        headers: { cookie: cookieAdmin },
        payload: {
          ...dadosCupom,
          codigo: `INVALIDO-${randomUUID().slice(0, 8)}`,
          itemIds: [randomUUID()],
        },
      });
      expect(cupomSemRecursoElegivel.statusCode).toBe(400);

      const atualizarInexistente = await app.inject({
        method: "PUT",
        url: `/admin/cupons/${randomUUID()}`,
        headers: { cookie: cookieAdmin },
        payload: dadosCupom,
      });
      expect(atualizarInexistente.statusCode).toBe(404);
    } finally {
      if (cupomIds.length > 0) {
        await app.prisma.cupom.deleteMany({
          where: { id: { in: cupomIds } },
        });
      }
      if (itemId) {
        await app.prisma.item.deleteMany({ where: { id: itemId } });
      }
      if (categoriaId) {
        await app.prisma.categoria.deleteMany({ where: { id: categoriaId } });
      }
      if (usuarioIds.length > 0) {
        await app.prisma.usuario.deleteMany({
          where: { id: { in: usuarioIds } },
        });
      }
      await app.close();
    }
  });
});
