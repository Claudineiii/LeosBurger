import { randomUUID } from "node:crypto";
import { TipoUsuario } from "@prisma/client";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { criarAplicacao } from "../../src/app.js";
import { withTestDatabaseLock } from "../helpers/database-lock.js";

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

describe("administração de faixas de frete", () => {
  it("protege endpoints, valida intervalos e substitui o conjunto atomicamente", async () => {
    const app = criarAplicacao();
    const idsNovos: string[] = [];
    let usuarioId: string | undefined;
    let originais: Awaited<ReturnType<typeof app.prisma.faixaFrete.findMany>> = [];

    try {
      await app.ready();
      await withTestDatabaseLock(app.prisma, "leosburger-test-faixas-frete", async () => {
        try {
          originais = await app.prisma.faixaFrete.findMany();
          const semSessao = await app.inject({
            method: "GET",
            url: "/admin/faixas-frete",
          });
          expect(semSessao.statusCode).toBe(401);

          const usuario = await app.prisma.usuario.create({
            data: {
              nome: "Admin faixas",
              email: `admin-faixas-${randomUUID()}@example.test`,
              telefone: "19999990001",
              senhaHash: await bcrypt.hash("Senha-forte-123", 10),
              tipo: TipoUsuario.ADMIN,
            },
            select: { id: true, email: true },
          });
          usuarioId = usuario.id;
          const login = await app.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: usuario.email, senha: "Senha-forte-123" },
          });
          const cookie = cookieDaResposta(login.headers["set-cookie"]);

          const invalida = await app.inject({
            method: "PUT",
            url: "/admin/faixas-frete",
            headers: { cookie },
            payload: [
              { distanciaMinima: 0, distanciaMaxima: 2, valor: 3 },
              { distanciaMinima: 2.01, distanciaMaxima: 6, valor: 5 },
            ],
          });
          expect(invalida.statusCode).toBe(400);

          const substituida = await app.inject({
            method: "PUT",
            url: "/admin/faixas-frete",
            headers: { cookie },
            payload: [
              { distanciaMinima: 0, distanciaMaxima: 2, valor: 3 },
              { distanciaMinima: 2, distanciaMaxima: 6, valor: 5 },
            ],
          });
          expect(substituida.statusCode).toBe(200);
          idsNovos.push(...substituida.json().map((faixa: { id: string }) => faixa.id));
          expect(substituida.json()).toMatchObject([
            {
              distanciaMinima: 0,
              distanciaMaxima: 2,
              valor: "3.00",
              ativa: true,
            },
            {
              distanciaMinima: 2,
              distanciaMaxima: 6,
              valor: "5.00",
              ativa: true,
            },
          ]);

          const desativadas = await app.inject({
            method: "PUT",
            url: "/admin/faixas-frete",
            headers: { cookie },
            payload: [],
          });
          expect(desativadas.statusCode).toBe(200);
          expect(desativadas.json()).toEqual([]);

          const configuracoes = [
            [
              { distanciaMinima: 0, distanciaMaxima: 3, valor: 5 },
              { distanciaMinima: 3, distanciaMaxima: 6, valor: 9 },
            ],
            [
              { distanciaMinima: 0, distanciaMaxima: 1, valor: 2 },
              { distanciaMinima: 1, distanciaMaxima: 6, valor: 4 },
            ],
          ];
          const concorrentes = await Promise.all(
            configuracoes.map((payload) =>
              app.inject({
                method: "PUT",
                url: "/admin/faixas-frete",
                headers: { cookie },
                payload,
              }),
            ),
          );
          expect(concorrentes.map(({ statusCode }) => statusCode)).toEqual([
            200, 200,
          ]);

          const finaisAtivas = await app.prisma.faixaFrete.findMany({
            where: { ativa: true },
            orderBy: { distanciaMinima: "asc" },
            select: {
              distanciaMinima: true,
              distanciaMaxima: true,
              valor: true,
            },
          });
          const faixasFinais = finaisAtivas.map((faixa) => ({
            distanciaMinima: faixa.distanciaMinima.toNumber(),
            distanciaMaxima: faixa.distanciaMaxima.toNumber(),
            valor: faixa.valor.toNumber(),
          }));
          const faixasConcorrentes = configuracoes.map((faixas) =>
            JSON.stringify(faixas),
          );
          expect(faixasConcorrentes).toContain(JSON.stringify(faixasFinais));
        } finally {
          const idsOriginais = new Set(originais.map(({ id }) => id));
          const atuais = await app.prisma.faixaFrete.findMany({
            select: { id: true },
          });
          const idsCriados = atuais
            .filter(({ id }) => !idsOriginais.has(id))
            .map(({ id }) => id);
          if (idsNovos.length > 0 || idsCriados.length > 0) {
            await app.prisma.faixaFrete.deleteMany({
              where: { id: { in: [...idsNovos, ...idsCriados] } },
            });
          }
          for (const faixa of originais) {
            await app.prisma.faixaFrete.update({
              where: { id: faixa.id },
              data: {
                distanciaMinima: faixa.distanciaMinima,
                distanciaMaxima: faixa.distanciaMaxima,
                valor: faixa.valor,
                ativa: faixa.ativa,
              },
            });
          }
          if (usuarioId) {
            await app.prisma.usuario.deleteMany({ where: { id: usuarioId } });
          }
        }
      });
    } finally {
      await app.close();
    }
  });
});
