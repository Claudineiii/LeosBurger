import { MetodoPagamento, Prisma, StatusPedido, TipoEntrega, type MetodoReembolso } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const periodoSchema = z.enum(["dia", "mes", "semestre", "ano"]);
const referenciaSchema = z.string().trim().min(4).max(10);
const querySchema = z.object({ periodo: periodoSchema, referencia: referenciaSchema }).strict();
const erroSchema = z.object({ status: z.number(), error: z.string(), message: z.string() });

type Periodo = z.infer<typeof periodoSchema>;

function dataCivil(valor: string) {
  const partes = valor.split("-").map(Number);
  const [ano, mes, dia] = partes;
  if (!ano || mes === undefined || dia === undefined) throw new Error("REFERENCIA_INVALIDA");
  const data = new Date(0);
  data.setUTCHours(0, 0, 0, 0);
  data.setUTCFullYear(ano, mes - 1, dia);
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
    throw new Error("REFERENCIA_INVALIDA");
  }
  return { ano, mes, dia };
}

function instanteLocalSaoPaulo(ano: number, mes: number, dia: number): Date {
  const utc = new Date(0);
  utc.setUTCHours(0, 0, 0, 0);
  utc.setUTCFullYear(ano, mes - 1, dia);
  const formatador = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let candidato = utc.getTime();
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const campos = Object.fromEntries(formatador.formatToParts(new Date(candidato)).map((parte) => [parte.type, Number(parte.value)]));
    const representado = new Date(0);
    representado.setUTCHours(campos.hour!, campos.minute!, campos.second!, 0);
    representado.setUTCFullYear(campos.year!, campos.month! - 1, campos.day!);
    const desejado = new Date(0);
    desejado.setUTCHours(0, 0, 0, 0);
    desejado.setUTCFullYear(ano, mes - 1, dia);
    const diferenca = desejado.getTime() - representado.getTime();
    if (diferenca === 0) break;
    candidato += diferenca;
  }
  return new Date(candidato);
}

export function obterIntervaloDashboard(periodo: Periodo, referencia: string) {
  let ano: number;
  let mes = 1;
  let dia = 1;
  let proximoAno: number;
  let proximoMes: number;
  let proximoDia = 1;

  if (periodo === "dia") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(referencia)) throw new Error("REFERENCIA_INVALIDA");
    ({ ano, mes, dia } = dataCivil(referencia));
    const proxima = new Date(0);
    proxima.setUTCHours(0, 0, 0, 0);
    proxima.setUTCFullYear(ano, mes - 1, dia + 1);
    proximoAno = proxima.getUTCFullYear(); proximoMes = proxima.getUTCMonth() + 1; proximoDia = proxima.getUTCDate();
  } else if (periodo === "mes") {
    if (!/^\d{4}-\d{2}$/.test(referencia)) throw new Error("REFERENCIA_INVALIDA");
    ({ ano, mes } = dataCivil(`${referencia}-01`));
    proximoAno = mes === 12 ? ano + 1 : ano; proximoMes = mes === 12 ? 1 : mes + 1;
  } else if (periodo === "semestre") {
    const match = /^(\d{4})-S([12])$/.exec(referencia);
    if (!match) throw new Error("REFERENCIA_INVALIDA");
    ano = Number(match[1]); mes = match[2] === "1" ? 1 : 7;
    proximoAno = ano; proximoMes = mes === 1 ? 7 : 1;
    if (mes === 7) proximoAno++;
  } else {
    if (!/^\d{4}$/.test(referencia)) throw new Error("REFERENCIA_INVALIDA");
    ano = Number(referencia); proximoAno = ano + 1; proximoMes = 1;
  }
  if (ano < 1 || ano > 9998) throw new Error("REFERENCIA_INVALIDA");
  return {
    inicio: instanteLocalSaoPaulo(ano, mes, dia),
    fim: instanteLocalSaoPaulo(proximoAno, proximoMes, proximoDia),
  };
}

function decimal(valor: Prisma.Decimal | null | undefined) { return (valor ?? new Prisma.Decimal(0)).toFixed(2); }
type Origem = "reais" | "simulados" | "nao_classificados";
type EstadoReembolso = "confirmados" | "pendentes";
type Metrica = { quantidade: number; valor: Prisma.Decimal };
type LinhaMetodoReembolso = {
  metodo: MetodoReembolso;
  confirmados_reais_quantidade: number; confirmados_reais_valor: Prisma.Decimal;
  confirmados_simulados_quantidade: number; confirmados_simulados_valor: Prisma.Decimal;
  confirmados_nao_classificados_quantidade: number; confirmados_nao_classificados_valor: Prisma.Decimal;
  pendentes_reais_quantidade: number; pendentes_reais_valor: Prisma.Decimal;
  pendentes_simulados_quantidade: number; pendentes_simulados_valor: Prisma.Decimal;
  pendentes_nao_classificados_quantidade: number; pendentes_nao_classificados_valor: Prisma.Decimal;
};
type MetricasPagamento = {
  recebidos_simulados_quantidade: number; recebidos_simulados_valor: Prisma.Decimal;
  recebidos_reais_quantidade: number; recebidos_reais_valor: Prisma.Decimal;
  recebidos_nao_classificados_quantidade: number; recebidos_nao_classificados_valor: Prisma.Decimal;
  pendentes_quantidade: number; pendentes_valor: Prisma.Decimal;
};

function metrica(quantidade: number, valor: Prisma.Decimal | null | undefined): Metrica {
  return { quantidade, valor: valor ?? new Prisma.Decimal(0) };
}

function totalizarReembolsos(linhas: LinhaMetodoReembolso[], estado: EstadoReembolso, origem: Origem): Metrica {
  const chaves = estado === "confirmados"
    ? origem === "reais" ? ["confirmados_reais_quantidade", "confirmados_reais_valor"] as const
      : origem === "simulados" ? ["confirmados_simulados_quantidade", "confirmados_simulados_valor"] as const
        : ["confirmados_nao_classificados_quantidade", "confirmados_nao_classificados_valor"] as const
    : origem === "reais" ? ["pendentes_reais_quantidade", "pendentes_reais_valor"] as const
      : origem === "simulados" ? ["pendentes_simulados_quantidade", "pendentes_simulados_valor"] as const
        : ["pendentes_nao_classificados_quantidade", "pendentes_nao_classificados_valor"] as const;
  return linhas.reduce((total, linha) => ({ quantidade: total.quantidade + linha[chaves[0]], valor: total.valor.add(linha[chaves[1]]) }), metrica(0, new Prisma.Decimal(0)));
}

function serializarMetrica(valor: Metrica) { return { quantidade: valor.quantidade, valor: decimal(valor.valor) }; }

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/admin/dashboard", {
    preHandler: [app.autorizarAdmin],
    schema: {
      description: "Resumo administrativo agregado no PostgreSQL por período civil de São Paulo.",
      tags: ["Admin - Dashboard"],
      querystring: querySchema,
      response: { 200: z.object({
        periodo: periodoSchema, referencia: z.string(), fuso: z.literal("America/Sao_Paulo"),
        intervalo: z.object({ inicio: z.string().datetime(), fimExclusivo: z.string().datetime() }),
        pedidos: z.object({ quantidade: z.number().int(), bruto: z.string(), porStatus: z.array(z.object({ status: z.nativeEnum(StatusPedido), quantidade: z.number().int(), bruto: z.string() })), cancelados: z.object({ quantidade: z.number().int(), bruto: z.string() }), porModalidade: z.array(z.object({ tipoEntrega: z.nativeEnum(TipoEntrega), quantidade: z.number().int(), bruto: z.string() })), porMetodoEscolhido: z.array(z.object({ metodoPagamento: z.nativeEnum(MetodoPagamento), quantidade: z.number().int(), bruto: z.string() })) }),
        pagamentos: z.object({ recebidos: z.object({ quantidade: z.number().int(), valor: z.string() }), simulados: z.object({ quantidade: z.number().int(), valor: z.string() }), naoClassificados: z.object({ quantidade: z.number().int(), valor: z.string() }), pendentes: z.object({ quantidade: z.number().int(), valor: z.string() }) }),
        reembolsos: z.object({
          confirmados: z.object({ reais: z.object({ quantidade: z.number().int(), valor: z.string() }), simulados: z.object({ quantidade: z.number().int(), valor: z.string() }), naoClassificados: z.object({ quantidade: z.number().int(), valor: z.string() }), porMetodo: z.array(z.object({ metodo: z.enum(["PIX", "DINHEIRO", "CREDITO", "DEBITO"]), reais: z.object({ quantidade: z.number().int(), valor: z.string() }), simulados: z.object({ quantidade: z.number().int(), valor: z.string() }), naoClassificados: z.object({ quantidade: z.number().int(), valor: z.string() }) })) }),
          pendentes: z.object({ reais: z.object({ quantidade: z.number().int(), valor: z.string() }), simulados: z.object({ quantidade: z.number().int(), valor: z.string() }), naoClassificados: z.object({ quantidade: z.number().int(), valor: z.string() }), porMetodo: z.array(z.object({ metodo: z.enum(["PIX", "DINHEIRO", "CREDITO", "DEBITO"]), reais: z.object({ quantidade: z.number().int(), valor: z.string() }), simulados: z.object({ quantidade: z.number().int(), valor: z.string() }), naoClassificados: z.object({ quantidade: z.number().int(), valor: z.string() }) })) }),
        }),
        resultadoLiquido: z.string(),
      }), 400: erroSchema, 401: erroSchema, 403: erroSchema },
    },
  }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ status: 400, error: "VALIDATION_ERROR", message: "Período ou referência inválida." });
    let intervalo: ReturnType<typeof obterIntervaloDashboard>;
    try { intervalo = obterIntervaloDashboard(parsed.data.periodo, parsed.data.referencia); }
    catch { return reply.code(400).send({ status: 400, error: "VALIDATION_ERROR", message: "Referência inválida para o período informado." }); }
    const range = { gte: intervalo.inicio, lt: intervalo.fim };
    const [pedidos, pagamentosRows, reembolsosPorMetodo] = await Promise.all([
      app.prisma.pedido.groupBy({ by: ["status"], where: { criadoEm: range }, _count: { _all: true }, _sum: { total: true } }),
      app.prisma.$queryRaw<MetricasPagamento[]>`
        WITH base AS (
          SELECT status, valor, metodo, transacao_externa, auditoria, CASE
            WHEN transacao_externa LIKE 'sim-%' THEN 'SIMULADO'
            WHEN metodo <> 'PIX' AND auditoria @> '[{"tipo":"CONFIRMACAO_PRESENCIAL_ADMIN"}]'::jsonb THEN 'REAL'
            ELSE 'NAO_CLASSIFICADO'
          END AS origem
          FROM tentativas_pagamento
          WHERE
            (status = 'PAGO' AND encerrado_em >= ${intervalo.inicio} AND encerrado_em < ${intervalo.fim})
            OR
            (status = 'PENDENTE' AND criado_em >= ${intervalo.inicio} AND criado_em < ${intervalo.fim}
              AND (metodo <> 'PIX' OR (confirmada_em IS NOT NULL AND expira_em > CURRENT_TIMESTAMP)))
        )
        SELECT
          COUNT(*) FILTER (WHERE status = 'PAGO' AND origem = 'SIMULADO')::int AS recebidos_simulados_quantidade,
          COALESCE(SUM(valor) FILTER (WHERE status = 'PAGO' AND origem = 'SIMULADO'), 0)::numeric AS recebidos_simulados_valor,
          COUNT(*) FILTER (WHERE status = 'PAGO' AND origem = 'REAL')::int AS recebidos_reais_quantidade,
          COALESCE(SUM(valor) FILTER (WHERE status = 'PAGO' AND origem = 'REAL'), 0)::numeric AS recebidos_reais_valor,
          COUNT(*) FILTER (WHERE status = 'PAGO' AND origem = 'NAO_CLASSIFICADO')::int AS recebidos_nao_classificados_quantidade,
          COALESCE(SUM(valor) FILTER (WHERE status = 'PAGO' AND origem = 'NAO_CLASSIFICADO'), 0)::numeric AS recebidos_nao_classificados_valor,
          COUNT(*) FILTER (WHERE status = 'PENDENTE')::int AS pendentes_quantidade,
          COALESCE(SUM(valor) FILTER (WHERE status = 'PENDENTE'), 0)::numeric AS pendentes_valor
        FROM base
      `,
      app.prisma.$queryRaw<LinhaMetodoReembolso[]>`
        WITH base AS (
          SELECT r.metodo, r.status, r.valor, r.valor_confirmado,
            CASE
              WHEN t.transacao_externa LIKE 'sim-%' THEN 'SIMULADO'
              WHEN t.metodo <> 'PIX' AND t.status = 'PAGO' AND t.auditoria @> '[{"tipo":"CONFIRMACAO_PRESENCIAL_ADMIN"}]'::jsonb THEN 'REAL'
              ELSE 'NAO_CLASSIFICADO'
            END AS origem
          FROM reembolsos r
          LEFT JOIN tentativas_pagamento t ON t.id = r.tentativa_pagamento_id
          WHERE
            (r.status = 'CONFIRMADO' AND r.confirmado_em >= ${intervalo.inicio} AND r.confirmado_em < ${intervalo.fim})
            OR
            (r.status = 'PENDENTE' AND r.iniciado_em >= ${intervalo.inicio} AND r.iniciado_em < ${intervalo.fim})
        )
        SELECT metodo,
          COUNT(*) FILTER (WHERE status = 'CONFIRMADO' AND origem = 'REAL')::int AS confirmados_reais_quantidade,
          COALESCE(SUM(valor_confirmado) FILTER (WHERE status = 'CONFIRMADO' AND origem = 'REAL'), 0)::numeric AS confirmados_reais_valor,
          COUNT(*) FILTER (WHERE status = 'CONFIRMADO' AND origem = 'SIMULADO')::int AS confirmados_simulados_quantidade,
          COALESCE(SUM(valor_confirmado) FILTER (WHERE status = 'CONFIRMADO' AND origem = 'SIMULADO'), 0)::numeric AS confirmados_simulados_valor,
          COUNT(*) FILTER (WHERE status = 'CONFIRMADO' AND origem = 'NAO_CLASSIFICADO')::int AS confirmados_nao_classificados_quantidade,
          COALESCE(SUM(valor_confirmado) FILTER (WHERE status = 'CONFIRMADO' AND origem = 'NAO_CLASSIFICADO'), 0)::numeric AS confirmados_nao_classificados_valor,
          COUNT(*) FILTER (WHERE status = 'PENDENTE' AND origem = 'REAL')::int AS pendentes_reais_quantidade,
          COALESCE(SUM(valor) FILTER (WHERE status = 'PENDENTE' AND origem = 'REAL'), 0)::numeric AS pendentes_reais_valor,
          COUNT(*) FILTER (WHERE status = 'PENDENTE' AND origem = 'SIMULADO')::int AS pendentes_simulados_quantidade,
          COALESCE(SUM(valor) FILTER (WHERE status = 'PENDENTE' AND origem = 'SIMULADO'), 0)::numeric AS pendentes_simulados_valor,
          COUNT(*) FILTER (WHERE status = 'PENDENTE' AND origem = 'NAO_CLASSIFICADO')::int AS pendentes_nao_classificados_quantidade,
          COALESCE(SUM(valor) FILTER (WHERE status = 'PENDENTE' AND origem = 'NAO_CLASSIFICADO'), 0)::numeric AS pendentes_nao_classificados_valor
        FROM base GROUP BY metodo
      `,
    ]);
    const basePedido = { criadoEm: range };
    const [totalPedidos, porModalidade, porMetodo, cancelados] = await Promise.all([
      app.prisma.pedido.aggregate({ where: basePedido, _count: { _all: true }, _sum: { total: true } }),
      app.prisma.pedido.groupBy({ by: ["tipoEntrega"], where: basePedido, _count: { _all: true }, _sum: { total: true } }),
      app.prisma.pedido.groupBy({ by: ["metodoPagamento"], where: basePedido, _count: { _all: true }, _sum: { total: true } }),
      app.prisma.pedido.aggregate({ where: { ...basePedido, status: StatusPedido.CANCELADO }, _count: { _all: true }, _sum: { total: true } }),
    ]);
    const pagamentos = pagamentosRows[0]!;
    const respostaReembolsos = (estado: EstadoReembolso) => ({
      reais: serializarMetrica(totalizarReembolsos(reembolsosPorMetodo, estado, "reais")),
      simulados: serializarMetrica(totalizarReembolsos(reembolsosPorMetodo, estado, "simulados")),
      naoClassificados: serializarMetrica(totalizarReembolsos(reembolsosPorMetodo, estado, "nao_classificados")),
      porMetodo: reembolsosPorMetodo.map((linha) => ({
        metodo: linha.metodo,
        reais: serializarMetrica(metrica(linha[`${estado}_reais_quantidade`], linha[`${estado}_reais_valor`])),
        simulados: serializarMetrica(metrica(linha[`${estado}_simulados_quantidade`], linha[`${estado}_simulados_valor`])),
        naoClassificados: serializarMetrica(metrica(linha[`${estado}_nao_classificados_quantidade`], linha[`${estado}_nao_classificados_valor`])),
      })),
    });
    return reply.send({
      periodo: parsed.data.periodo, referencia: parsed.data.referencia, fuso: "America/Sao_Paulo",
      intervalo: { inicio: intervalo.inicio.toISOString(), fimExclusivo: intervalo.fim.toISOString() },
      pedidos: {
        quantidade: totalPedidos._count._all, bruto: decimal(totalPedidos._sum.total),
        porStatus: pedidos.map((linha) => ({ status: linha.status, quantidade: linha._count._all, bruto: decimal(linha._sum.total) })),
        cancelados: { quantidade: cancelados._count._all, bruto: decimal(cancelados._sum.total) },
        porModalidade: porModalidade.map((linha) => ({ tipoEntrega: linha.tipoEntrega, quantidade: linha._count._all, bruto: decimal(linha._sum.total) })),
        porMetodoEscolhido: porMetodo.map((linha) => ({ metodoPagamento: linha.metodoPagamento, quantidade: linha._count._all, bruto: decimal(linha._sum.total) })),
      },
      pagamentos: {
        recebidos: serializarMetrica(metrica(pagamentos.recebidos_reais_quantidade, pagamentos.recebidos_reais_valor)),
        simulados: serializarMetrica(metrica(pagamentos.recebidos_simulados_quantidade, pagamentos.recebidos_simulados_valor)),
        naoClassificados: serializarMetrica(metrica(pagamentos.recebidos_nao_classificados_quantidade, pagamentos.recebidos_nao_classificados_valor)),
        pendentes: serializarMetrica(metrica(pagamentos.pendentes_quantidade, pagamentos.pendentes_valor)),
      },
      reembolsos: { confirmados: respostaReembolsos("confirmados"), pendentes: respostaReembolsos("pendentes") },
      resultadoLiquido: decimal(pagamentos.recebidos_reais_valor.sub(totalizarReembolsos(reembolsosPorMetodo, "confirmados", "reais").valor)),
    });
  });
}
