import {
  MetodoPagamento,
  MetodoReembolso,
  Prisma,
  StatusFinanceiroPedido,
  StatusPedido,
  StatusReembolso,
  StatusTentativaPagamento,
  TipoEntrega,
  type PrismaClient,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

type Tx = Prisma.TransactionClient;
type Banco = PrismaClient | Tx;
const diasTokenTerminal = 30;

function jsonArray(value: Prisma.JsonValue | Prisma.InputJsonValue): Prisma.InputJsonArray {
  return (Array.isArray(value) ? [...value] : []) as Prisma.InputJsonArray;
}

function adicionarEvento(
  history: Prisma.JsonValue | Prisma.InputJsonValue,
  event: Prisma.InputJsonObject,
) {
  return [...jsonArray(history), event] as Prisma.InputJsonArray;
}

function codeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const item = error as { code?: unknown; meta?: { code?: unknown }; cause?: unknown };
  if (typeof item.code === "string") return item.code;
  if (typeof item.meta?.code === "string") return item.meta.code;
  return item.cause ? codeOf(item.cause) : null;
}

async function serializable<T>(prisma: PrismaClient, run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const code = codeOf(error);
      const retryable = code === "P2034" || code === "40001" || (code === "P2010" && codeOf((error as { meta?: unknown }).meta) === "40001");
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error("TRANSACAO_PEDIDO_ADMIN_NAO_CONCLUIDA");
}

async function bloquearPedido(tx: Tx, pedidoId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pedidoId}, 0)) IS NULL`;
  await tx.$queryRaw`SELECT "id" FROM "pedidos" WHERE "id" = ${pedidoId} FOR UPDATE`;
}

export function proximoStatusPermitido(
  atual: StatusPedido,
  proximo: StatusPedido,
  tipoEntrega: TipoEntrega,
): boolean {
  const permitidos: Record<StatusPedido, StatusPedido[]> = {
    [StatusPedido.PENDENTE]: [StatusPedido.CONFIRMADO, StatusPedido.CANCELADO],
    [StatusPedido.CONFIRMADO]: [StatusPedido.PREPARANDO, StatusPedido.CANCELADO],
    [StatusPedido.PREPARANDO]: [StatusPedido.PRONTO, StatusPedido.CANCELADO],
    [StatusPedido.PRONTO]: [
      ...(tipoEntrega === TipoEntrega.ENTREGA ? [StatusPedido.SAIU_PARA_ENTREGA] : [StatusPedido.CONCLUIDO]),
      StatusPedido.CANCELADO,
    ],
    [StatusPedido.SAIU_PARA_ENTREGA]: [StatusPedido.CONCLUIDO, StatusPedido.CANCELADO],
    [StatusPedido.CONCLUIDO]: [],
    [StatusPedido.CANCELADO]: [],
  };
  return permitidos[atual].includes(proximo);
}

async function statusFinanceiroAtualizado(tx: Tx, pedidoId: string) {
  const pedido = await tx.pedido.findUniqueOrThrow({
    where: { id: pedidoId },
    select: { status: true, statusFinanceiro: true },
  });
  const pagos = await tx.tentativaPagamento.findMany({
    where: { pedidoId, status: StatusTentativaPagamento.PAGO },
    select: { valor: true },
  });
  if (pagos.length === 0) return pedido.statusFinanceiro;

  const reembolsos = await tx.reembolso.findMany({
    where: { pedidoId },
    select: { status: true, valor: true, valorConfirmado: true },
  });
  const totalPago = pagos.reduce((total, pagamento) => total.add(pagamento.valor), new Prisma.Decimal(0));
  const totalConfirmado = reembolsos
    .filter((item) => item.status === StatusReembolso.CONFIRMADO)
    .reduce((total, item) => total.add(item.valorConfirmado ?? 0), new Prisma.Decimal(0));

  if (totalConfirmado.greaterThanOrEqualTo(totalPago)) return StatusFinanceiroPedido.REEMBOLSADO;
  if (reembolsos.length > 0 || pedido.status === StatusPedido.CANCELADO) {
    return StatusFinanceiroPedido.REEMBOLSO_PENDENTE;
  }
  return StatusFinanceiroPedido.PAGO;
}

async function dataCancelamentoFinanceiro(tx: Tx, pedidoId: string) {
  const pedido = await tx.pedido.findUniqueOrThrow({ where: { id: pedidoId }, select: { statusFinanceiro: true } });
  const pagos = await tx.tentativaPagamento.findMany({
    where: { pedidoId, status: StatusTentativaPagamento.PAGO },
    select: { valor: true },
  });
  if (pagos.length === 0) return pedido.statusFinanceiro;
  const reembolsosConfirmados = await tx.reembolso.findMany({
    where: { pedidoId, status: StatusReembolso.CONFIRMADO },
    select: { valorConfirmado: true },
  });
  const totalPago = pagos.reduce((total, item) => total.add(item.valor), new Prisma.Decimal(0));
  const totalDevolvido = reembolsosConfirmados.reduce((total, item) => total.add(item.valorConfirmado ?? 0), new Prisma.Decimal(0));
  return totalDevolvido.greaterThanOrEqualTo(totalPago)
    ? StatusFinanceiroPedido.REEMBOLSADO
    : StatusFinanceiroPedido.REEMBOLSO_PENDENTE;
}

async function eventosNecessidadeReembolso(
  tx: Tx,
  pedidoId: string,
  origem: string,
  registradoEm: Date,
  adminId?: string,
): Promise<Prisma.InputJsonObject[]> {
  const pagos = await tx.tentativaPagamento.findMany({
    where: { pedidoId, status: StatusTentativaPagamento.PAGO },
    select: { id: true, valor: true, transacaoExterna: true },
    orderBy: { numeroTentativa: "asc" },
  });
  const devolvidos = await tx.reembolso.findMany({
    where: {
      tentativaPagamentoId: { in: pagos.map((tentativa) => tentativa.id) },
      status: StatusReembolso.CONFIRMADO,
    },
    select: { tentativaPagamentoId: true, valorConfirmado: true },
  });
  const totalDevolvidoPorTentativa = new Map<string, Prisma.Decimal>();
  for (const reembolso of devolvidos) {
    if (!reembolso.tentativaPagamentoId) continue;
    const acumulado = totalDevolvidoPorTentativa.get(reembolso.tentativaPagamentoId) ?? new Prisma.Decimal(0);
    totalDevolvidoPorTentativa.set(
      reembolso.tentativaPagamentoId,
      acumulado.add(reembolso.valorConfirmado ?? 0),
    );
  }
  return pagos.filter((tentativa) =>
    (totalDevolvidoPorTentativa.get(tentativa.id) ?? new Prisma.Decimal(0)).lessThan(tentativa.valor),
  ).map((tentativa) => ({
    tipo: "REEMBOLSO_NECESSARIO",
    tentativaId: tentativa.id,
    identificadorTransacao: tentativa.transacaoExterna,
    valor: tentativa.valor.toFixed(2),
    origem,
    ...(adminId ? { adminId } : {}),
    registradoEm: registradoEm.toISOString(),
  }));
}

export async function listarPedidosAdmin(
  prisma: Banco,
  filtro: {
    pagina: number;
    limite: number;
    status?: StatusPedido;
    statusFinanceiro?: StatusFinanceiroPedido;
    tipoEntrega?: TipoEntrega;
    metodoPagamento?: MetodoPagamento;
    numero?: number;
  },
) {
  const where: Prisma.PedidoWhereInput = {
    ...(filtro.status ? { status: filtro.status } : {}),
    ...(filtro.statusFinanceiro ? { statusFinanceiro: filtro.statusFinanceiro } : {}),
    ...(filtro.tipoEntrega ? { tipoEntrega: filtro.tipoEntrega } : {}),
    ...(filtro.metodoPagamento ? { metodoPagamento: filtro.metodoPagamento } : {}),
    ...(filtro.numero ? { numero: filtro.numero } : {}),
  };
  const [total, registros] = await Promise.all([
    prisma.pedido.count({ where }),
    prisma.pedido.findMany({
      where,
      orderBy: [{ criadoEm: "desc" }, { numero: "desc" }],
      skip: (filtro.pagina - 1) * filtro.limite,
      take: filtro.limite,
      select: {
        id: true,
        numero: true,
        status: true,
        statusFinanceiro: true,
        tipoEntrega: true,
        metodoPagamento: true,
        nomeClienteHistorico: true,
        telefoneClienteHistorico: true,
        total: true,
        criadoEm: true,
        _count: { select: { itensPedido: true } },
      },
    }),
  ]);
  return {
    pagina: filtro.pagina,
    limite: filtro.limite,
    total,
    totalPaginas: Math.ceil(total / filtro.limite),
    pedidos: registros.map(({ _count, ...pedido }) => ({
      ...pedido,
      total: pedido.total.toFixed(2),
      criadoEm: pedido.criadoEm.toISOString(),
      itensQuantidade: _count.itensPedido,
    })),
  };
}

export async function obterPedidoAdmin(prisma: PrismaClient, id: string) {
  const pedido = await prisma.pedido.findUnique({
    where: { id },
    select: {
      id: true,
      numero: true,
      status: true,
      statusFinanceiro: true,
      tipoEntrega: true,
      metodoPagamento: true,
      nomeClienteHistorico: true,
      telefoneClienteHistorico: true,
      cepHistorico: true,
      logradouroHistorico: true,
      numeroHistorico: true,
      complementoHistorico: true,
      bairroHistorico: true,
      cidadeHistorico: true,
      estadoHistorico: true,
      referenciaHistorico: true,
      subtotal: true,
      desconto: true,
      taxaEntrega: true,
      total: true,
      codigoCupom: true,
      cupomHistorico: true,
      distanciaKm: true,
      faixaFreteIdHistorico: true,
      faixaFreteDistanciaMinimaHistorica: true,
      faixaFreteDistanciaMaximaHistorica: true,
      historicoStatus: true,
      criadoEm: true,
      itensPedido: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          itemId: true,
          comboId: true,
          nomeHistorico: true,
          precoUnitarioHistorico: true,
          quantidade: true,
          subtotal: true,
          adicionais: true,
          composicaoHistorica: true,
        },
      },
      tentativasPagamento: {
        orderBy: { numeroTentativa: "asc" },
        select: {
          id: true,
          metodo: true,
          numeroTentativa: true,
          status: true,
          valor: true,
          confirmadaEm: true,
          expiraEm: true,
          encerradoEm: true,
          identificadorExterno: true,
          transacaoExterna: true,
          auditoria: true,
          criadoEm: true,
        },
      },
      reembolsos: {
        orderBy: { iniciadoEm: "desc" },
        select: {
          id: true,
          tentativaPagamentoId: true,
          metodo: true,
          status: true,
          valor: true,
          valorConfirmado: true,
          motivo: true,
          identificadorExterno: true,
          identificadorTransacaoOriginal: true,
          iniciadoPorAdminId: true,
          iniciadoEm: true,
          confirmadoPorAdminId: true,
          confirmadoEm: true,
          auditoria: true,
        },
      },
    },
  });
  if (!pedido) return null;
  const { faixaFreteIdHistorico, faixaFreteDistanciaMinimaHistorica, faixaFreteDistanciaMaximaHistorica, ...resto } = pedido;
  return {
    ...resto,
    historicoStatus: Array.isArray(pedido.historicoStatus) ? pedido.historicoStatus : [],
    subtotal: pedido.subtotal.toFixed(2),
    desconto: pedido.desconto.toFixed(2),
    taxaEntrega: pedido.taxaEntrega.toFixed(2),
    total: pedido.total.toFixed(2),
    distanciaKm: pedido.distanciaKm?.toFixed(2) ?? null,
    faixaFrete: faixaFreteIdHistorico ? {
      id: faixaFreteIdHistorico,
      distanciaMinima: faixaFreteDistanciaMinimaHistorica?.toFixed(2) ?? null,
      distanciaMaxima: faixaFreteDistanciaMaximaHistorica?.toFixed(2) ?? null,
    } : null,
    criadoEm: pedido.criadoEm.toISOString(),
    itensPedido: pedido.itensPedido.map((item) => ({
      ...item,
      precoUnitarioHistorico: item.precoUnitarioHistorico.toFixed(2),
      subtotal: item.subtotal.toFixed(2),
    })),
    tentativasPagamento: pedido.tentativasPagamento.map((item) => ({
      ...item,
      valor: item.valor.toFixed(2),
      confirmadaEm: item.confirmadaEm?.toISOString() ?? null,
      expiraEm: item.expiraEm?.toISOString() ?? null,
      encerradoEm: item.encerradoEm?.toISOString() ?? null,
      criadoEm: item.criadoEm.toISOString(),
    })),
    reembolsos: pedido.reembolsos.map((item) => ({
      ...item,
      valor: item.valor.toFixed(2),
      valorConfirmado: item.valorConfirmado?.toFixed(2) ?? null,
      iniciadoEm: item.iniciadoEm.toISOString(),
      confirmadoEm: item.confirmadoEm?.toISOString() ?? null,
    })),
  };
}

export async function transicionarStatusPedido(input: {
  prisma: PrismaClient;
  pedidoId: string;
  adminId: string;
  statusAtualEsperado: StatusPedido;
  proximoStatus: StatusPedido;
  motivo?: string;
  agora?: Date;
}) {
  const agora = input.agora ?? new Date();
  return serializable(input.prisma, async (tx) => {
    await bloquearPedido(tx, input.pedidoId);
    const pedido = await tx.pedido.findUnique({ where: { id: input.pedidoId } });
    if (!pedido) throw new Error("PEDIDO_NAO_ENCONTRADO");
    if (pedido.status !== input.statusAtualEsperado) throw new Error("CONFLITO_STATUS_PEDIDO");
    if (!proximoStatusPermitido(pedido.status, input.proximoStatus, pedido.tipoEntrega)) {
      throw new Error("TRANSICAO_STATUS_INVALIDA");
    }
    if (input.proximoStatus === StatusPedido.CANCELADO && !input.motivo?.trim()) {
      throw new Error("MOTIVO_CANCELAMENTO_OBRIGATORIO");
    }
    const statusFinanceiro = input.proximoStatus === StatusPedido.CANCELADO
      ? await dataCancelamentoFinanceiro(tx, pedido.id)
      : pedido.statusFinanceiro;
    let historico = adicionarEvento(pedido.historicoStatus, {
      tipo: "TRANSICAO_STATUS_ADMINISTRATIVA",
      statusAnterior: pedido.status,
      status: input.proximoStatus,
      adminId: input.adminId,
      ...(input.motivo ? { motivo: input.motivo.trim() } : {}),
      registradoEm: agora.toISOString(),
    });
    if (input.proximoStatus === StatusPedido.CANCELADO) {
      for (const evento of await eventosNecessidadeReembolso(tx, pedido.id, "CANCELAMENTO_ADMINISTRATIVO", agora, input.adminId)) {
        historico = adicionarEvento(historico, evento);
      }
    }
    const result = await tx.pedido.updateMany({
      where: { id: pedido.id, status: pedido.status },
      data: {
        status: input.proximoStatus,
        statusFinanceiro,
        historicoStatus: historico,
        ...((input.proximoStatus === StatusPedido.CONCLUIDO || input.proximoStatus === StatusPedido.CANCELADO) && !pedido.usuarioId
          ? { tokenAcompanhamentoExpiraEm: new Date(agora.getTime() + diasTokenTerminal * 24 * 60 * 60 * 1_000) }
          : {}),
      },
    });
    if (result.count !== 1) throw new Error("CONFLITO_STATUS_PEDIDO");
    return tx.pedido.findUniqueOrThrow({
      where: { id: pedido.id },
      select: { id: true, numero: true, status: true, statusFinanceiro: true, tipoEntrega: true, atualizadoEm: true },
    });
  });
}

type HistoricoEvento = Record<string, unknown>;
function eventosDe(historico: Prisma.JsonValue): HistoricoEvento[] {
  return Array.isArray(historico)
    ? historico.filter((entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) as unknown as HistoricoEvento[]
    : [];
}

export async function decidirSolicitacaoCancelamento(input: {
  prisma: PrismaClient;
  pedidoId: string;
  solicitacaoId: string;
  adminId: string;
  decisao: "APROVADA" | "REJEITADA";
  justificativa?: string;
  agora?: Date;
}) {
  const agora = input.agora ?? new Date();
  return serializable(input.prisma, async (tx) => {
    await bloquearPedido(tx, input.pedidoId);
    const pedido = await tx.pedido.findUnique({ where: { id: input.pedidoId } });
    if (!pedido) throw new Error("PEDIDO_NAO_ENCONTRADO");
    const historico = eventosDe(pedido.historicoStatus);
    const solicitacao = historico.find((event) => event.tipo === "SOLICITACAO_CANCELAMENTO" && event.solicitacaoId === input.solicitacaoId);
    if (!solicitacao) throw new Error("SOLICITACAO_CANCELAMENTO_NAO_ENCONTRADA");
    const decisaoExistente = historico.find((event) => event.tipo === "DECISAO_SOLICITACAO_CANCELAMENTO" && event.solicitacaoId === input.solicitacaoId);
    if (decisaoExistente) {
      if (decisaoExistente.decisao !== input.decisao) throw new Error("SOLICITACAO_CANCELAMENTO_JA_DECIDIDA");
      return {
        sucesso: true,
        repetida: true,
        pedidoId: pedido.id,
        numero: pedido.numero,
        decisao: input.decisao,
        status: pedido.status,
        statusFinanceiro: pedido.statusFinanceiro,
      };
    }
    if (input.decisao === "APROVADA" && !proximoStatusPermitido(pedido.status, StatusPedido.CANCELADO, pedido.tipoEntrega)) {
      throw new Error("PEDIDO_NAO_PODE_SER_CANCELADO");
    }
    const status = input.decisao === "APROVADA" ? StatusPedido.CANCELADO : pedido.status;
    const decisaoEvento: Prisma.InputJsonObject = {
      tipo: "DECISAO_SOLICITACAO_CANCELAMENTO",
      solicitacaoId: input.solicitacaoId,
      decisao: input.decisao,
      adminId: input.adminId,
      ...(input.justificativa ? { justificativa: input.justificativa.trim() } : {}),
      statusAnterior: pedido.status,
      status,
      registradoEm: agora.toISOString(),
    };
    let novoHistorico = adicionarEvento(pedido.historicoStatus, decisaoEvento);
    if (input.decisao === "APROVADA") {
      novoHistorico = adicionarEvento(novoHistorico, {
        tipo: "TRANSICAO_STATUS_ADMINISTRATIVA",
        statusAnterior: pedido.status,
        status: StatusPedido.CANCELADO,
        adminId: input.adminId,
        motivo: "SOLICITACAO_CANCELAMENTO_APROVADA",
        solicitacaoId: input.solicitacaoId,
        registradoEm: agora.toISOString(),
      });
      for (const evento of await eventosNecessidadeReembolso(tx, pedido.id, "CANCELAMENTO_ADMINISTRATIVO", agora, input.adminId)) {
        novoHistorico = adicionarEvento(novoHistorico, evento);
      }
    }
    const statusFinanceiro = input.decisao === "APROVADA"
      ? await dataCancelamentoFinanceiro(tx, pedido.id)
      : pedido.statusFinanceiro;
    const result = await tx.pedido.updateMany({
      where: { id: pedido.id, status: pedido.status },
      data: {
        status,
        statusFinanceiro,
        historicoStatus: novoHistorico,
        ...(input.decisao === "APROVADA" && !pedido.usuarioId
          ? { tokenAcompanhamentoExpiraEm: new Date(agora.getTime() + diasTokenTerminal * 24 * 60 * 60 * 1_000) }
          : {}),
      },
    });
    if (result.count !== 1) throw new Error("CONFLITO_STATUS_PEDIDO");
    return {
      sucesso: true,
      repetida: false,
      pedidoId: pedido.id,
      numero: pedido.numero,
      decisao: input.decisao,
      status,
      statusFinanceiro,
    };
  });
}

async function valorJaDevolvido(tx: Tx, tentativaId: string) {
  const registros = await tx.reembolso.findMany({
    where: { tentativaPagamentoId: tentativaId },
    select: { status: true, valor: true, valorConfirmado: true },
  });
  return registros.reduce((total, item) => total.add(
    item.status === StatusReembolso.PENDENTE ? item.valor : (item.valorConfirmado ?? 0),
  ), new Prisma.Decimal(0));
}

async function reconciliarFinanceiro(tx: Tx, pedidoId: string) {
  const statusFinanceiro = await statusFinanceiroAtualizado(tx, pedidoId);
  await tx.pedido.update({ where: { id: pedidoId }, data: { statusFinanceiro } });
  return statusFinanceiro;
}

async function criarRegistroReembolso(input: {
  prisma: PrismaClient;
  pedidoId: string;
  tentativaId: string;
  adminId: string;
  chaveIdempotencia: string;
  motivo: string;
  metodoEsperado: "PIX" | "PRESENCIAL";
  agora?: Date;
}) {
  const agora = input.agora ?? new Date();
  return serializable(input.prisma, async (tx) => {
    await bloquearPedido(tx, input.pedidoId);
    const repetido = await tx.reembolso.findUnique({ where: { chaveIdempotencia: input.chaveIdempotencia } });
    if (repetido) {
      const metodoCompativel = input.metodoEsperado === "PIX"
        ? repetido.metodo === MetodoReembolso.PIX
        : repetido.metodo !== MetodoReembolso.PIX;
      if (repetido.pedidoId !== input.pedidoId || repetido.tentativaPagamentoId !== input.tentativaId || repetido.motivo !== input.motivo.trim() || !metodoCompativel) {
        throw new Error("IDEMPOTENCIA_CONFLITO");
      }
      return { reembolso: repetido, repetido: true };
    }
    const pedido = await tx.pedido.findUnique({ where: { id: input.pedidoId }, select: { id: true, status: true, statusFinanceiro: true, historicoStatus: true } });
    const tentativa = await tx.tentativaPagamento.findFirst({
      where: { id: input.tentativaId, pedidoId: input.pedidoId },
      select: { id: true, metodo: true, status: true, valor: true, transacaoExterna: true },
    });
    if (!pedido) throw new Error("PEDIDO_NAO_ENCONTRADO");
    if (!tentativa) throw new Error("TENTATIVA_PAGAMENTO_NAO_ENCONTRADA");
    if (tentativa.status !== StatusTentativaPagamento.PAGO) throw new Error("PAGAMENTO_NAO_CONFIRMADO");
    if (input.metodoEsperado === "PIX" && tentativa.metodo !== MetodoPagamento.PIX) throw new Error("METODO_REEMBOLSO_INCOMPATIVEL");
    if (input.metodoEsperado === "PRESENCIAL" && tentativa.metodo === MetodoPagamento.PIX) throw new Error("METODO_REEMBOLSO_INCOMPATIVEL");
    const metodoRegistro = tentativa.metodo as MetodoReembolso;
    const valorDevolvido = await valorJaDevolvido(tx, tentativa.id);
    const disponivel = tentativa.valor.sub(valorDevolvido);
    if (disponivel.lessThanOrEqualTo(0) || !disponivel.equals(tentativa.valor)) throw new Error("VALOR_REEMBOLSO_INDISPONIVEL");
    const id = randomUUID();
    const presencial = input.metodoEsperado === "PRESENCIAL";
    const registro = await tx.reembolso.create({
      data: {
        id,
        pedidoId: pedido.id,
        tentativaPagamentoId: tentativa.id,
        metodo: metodoRegistro,
        status: presencial ? StatusReembolso.CONFIRMADO : StatusReembolso.PENDENTE,
        valor: tentativa.valor,
        ...(presencial ? { valorConfirmado: tentativa.valor, confirmadoEm: agora, confirmadoPorAdminId: input.adminId } : {}),
        motivo: input.motivo.trim(),
        chaveIdempotencia: input.chaveIdempotencia,
        identificadorTransacaoOriginal: tentativa.transacaoExterna,
        iniciadoPorAdminId: input.adminId,
        iniciadoEm: agora,
        auditoria: [{ tipo: presencial ? "DEVOLUCAO_PRESENCIAL_REGISTRADA" : "REEMBOLSO_PIX_INICIADO", adminId: input.adminId, registradoEm: agora.toISOString() }],
      },
    });
    await tx.pedido.update({
      where: { id: pedido.id },
      data: {
        statusFinanceiro: StatusFinanceiroPedido.REEMBOLSO_PENDENTE,
        historicoStatus: adicionarEvento(pedido.historicoStatus, {
          tipo: presencial ? "DEVOLUCAO_PRESENCIAL_REGISTRADA" : "REEMBOLSO_PIX_INICIADO",
          reembolsoId: registro.id,
          tentativaPagamentoId: tentativa.id,
          valor: registro.valor.toFixed(2),
          adminId: input.adminId,
          registradoEm: agora.toISOString(),
        }),
      },
    });
    await reconciliarFinanceiro(tx, pedido.id);
    return { reembolso: registro, repetido: false };
  });
}

type InputIniciarReembolso = Omit<Parameters<typeof criarRegistroReembolso>[0], "metodoEsperado">;

export function iniciarReembolsoPix(input: InputIniciarReembolso) {
  return criarRegistroReembolso({ ...input, metodoEsperado: "PIX" });
}

export function registrarDevolucaoPresencial(input: InputIniciarReembolso) {
  return criarRegistroReembolso({ ...input, metodoEsperado: "PRESENCIAL" });
}

export async function confirmarReembolsoPix(input: {
  prisma: PrismaClient;
  pedidoId: string;
  reembolsoId: string;
  adminId: string;
  chaveIdempotencia: string;
  valorConfirmado: string;
  identificadorExterno?: string;
  agora?: Date;
}) {
  const agora = input.agora ?? new Date();
  const valorConfirmado = new Prisma.Decimal(input.valorConfirmado);
  return serializable(input.prisma, async (tx) => {
    await bloquearPedido(tx, input.pedidoId);
    const registro = await tx.reembolso.findFirst({ where: { id: input.reembolsoId, pedidoId: input.pedidoId } });
    if (!registro) throw new Error("REEMBOLSO_NAO_ENCONTRADO");
    if (registro.metodo !== MetodoReembolso.PIX) throw new Error("METODO_REEMBOLSO_INCOMPATIVEL");
    if (!valorConfirmado.equals(registro.valor)) throw new Error("REEMBOLSO_PARCIAL_NAO_PERMITIDO");
    if (registro.status === StatusReembolso.CONFIRMADO) {
      if (registro.valorConfirmado?.equals(valorConfirmado) && registro.identificadorExterno === (input.identificadorExterno ?? null)) {
        return { reembolso: registro, repetido: true };
      }
      throw new Error("REEMBOLSO_JA_CONFIRMADO");
    }
    const chaveUsada = await tx.reembolso.findUnique({ where: { chaveConfirmacao: input.chaveIdempotencia } });
    if (chaveUsada) {
      if (chaveUsada.id !== registro.id) throw new Error("IDEMPOTENCIA_CONFLITO");
      return { reembolso: chaveUsada, repetido: true };
    }
    const atualizada = await tx.reembolso.updateMany({
      where: { id: registro.id, status: StatusReembolso.PENDENTE },
      data: {
        status: StatusReembolso.CONFIRMADO,
        valorConfirmado,
        chaveConfirmacao: input.chaveIdempotencia,
        identificadorExterno: input.identificadorExterno ?? null,
        confirmadoPorAdminId: input.adminId,
        confirmadoEm: agora,
        auditoria: adicionarEvento(registro.auditoria, { tipo: "REEMBOLSO_PIX_CONFIRMADO", adminId: input.adminId, valor: valorConfirmado.toFixed(2), registradoEm: agora.toISOString() }),
      },
    });
    if (atualizada.count !== 1) throw new Error("REEMBOLSO_JA_CONFIRMADO");
    const pedido = await tx.pedido.findUniqueOrThrow({ where: { id: input.pedidoId }, select: { historicoStatus: true } });
    await tx.pedido.update({
      where: { id: input.pedidoId },
      data: {
        historicoStatus: adicionarEvento(pedido.historicoStatus, {
          tipo: "REEMBOLSO_PIX_CONFIRMADO",
          reembolsoId: registro.id,
          adminId: input.adminId,
          valor: valorConfirmado.toFixed(2),
          registradoEm: agora.toISOString(),
        }),
      },
    });
    await reconciliarFinanceiro(tx, input.pedidoId);
    return {
      reembolso: await tx.reembolso.findUniqueOrThrow({ where: { id: registro.id } }),
      repetido: false,
    };
  });
}
