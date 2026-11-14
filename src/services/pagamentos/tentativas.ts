import { randomUUID } from "node:crypto";
import {
  MetodoPagamento,
  Prisma,
  StatusFinanceiroPedido,
  StatusPedido,
  StatusTentativaPagamento,
  type PrismaClient,
} from "@prisma/client";
import type { ProvedorPagamentos } from "./contrato.js";
import { limitarCobranca } from "./limites.js";

const DURACAO_TENTATIVA_MS = 5 * 60 * 1_000;

type Transacao = Prisma.TransactionClient;
type ClienteBanco = PrismaClient | Transacao;

export function ehConflitoTransacional(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const valor = erro as {
    code?: unknown;
    meta?: { code?: unknown };
    cause?: unknown;
  };
  if (valor.code === "P2034" || valor.code === "40001") {
    return true;
  }
  if (valor.meta?.code === "40001") {
    return true;
  }
  if (valor.cause && typeof valor.cause === "object") {
    const causa = valor.cause as { code?: unknown };
    if (causa.code === "P2034" || causa.code === "40001") {
      return true;
    }
  }
  return false;
}

export async function transacaoSerializavel<T>(
  prisma: PrismaClient,
  operacao: (tx: Transacao) => Promise<T>,
) {
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    try {
      return await prisma.$transaction(operacao, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erro) {
      if (
        !ehConflitoTransacional(erro) ||
        tentativa === 2
      ) {
        throw erro;
      }
    }
  }
  throw new Error("TRANSACAO_PAGAMENTO_NAO_CONCLUIDA");
}

function listaJson(valor: Prisma.JsonValue | Prisma.InputJsonValue): Prisma.InputJsonArray {
  return (Array.isArray(valor) ? [...valor] : []) as Prisma.InputJsonArray;
}

function acrescentar(
  valor: Prisma.JsonValue | Prisma.InputJsonValue,
  entrada: Prisma.InputJsonObject,
): Prisma.InputJsonArray {
  return [...listaJson(valor), entrada];
}

async function bloquearPedido(tx: Transacao, pedidoId: string) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${pedidoId}, 0)) IS NULL
  `;
}

async function expirarNoPedido(tx: Transacao, pedidoId: string, agora: Date) {
  const vencidas = await tx.tentativaPagamento.findMany({
    where: {
      pedidoId,
      metodo: MetodoPagamento.PIX,
      status: StatusTentativaPagamento.PENDENTE,
      expiraEm: { lte: agora },
    },
    orderBy: { numeroTentativa: "asc" },
  });
  for (const tentativa of vencidas) {
    const atualizada = await tx.tentativaPagamento.updateMany({
      where: {
        id: tentativa.id,
        status: StatusTentativaPagamento.PENDENTE,
        expiraEm: { lte: agora },
      },
      data: {
        status: StatusTentativaPagamento.EXPIRADO,
        encerradoEm: agora,
        auditoria: acrescentar(tentativa.auditoria, {
          tipo: "TENTATIVA_EXPIRADA",
          registradaEm: agora.toISOString(),
        }),
      },
    });
    if (atualizada.count === 0 || tentativa.numeroTentativa !== 2) continue;

    const pedido = await tx.pedido.findUnique({ where: { id: pedidoId } });
    if (!pedido || pedido.status === StatusPedido.CANCELADO || pedido.status === StatusPedido.CONCLUIDO) {
      continue;
    }
    const historico = Array.isArray(pedido.historicoStatus)
      ? (pedido.historicoStatus as Prisma.InputJsonArray)
      : [];
    await tx.pedido.update({
      where: { id: pedidoId },
      data: {
        status: StatusPedido.CANCELADO,
        ...(!pedido.usuarioId
          ? { tokenAcompanhamentoExpiraEm: new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1_000) }
          : {}),
        historicoStatus: [
          ...historico,
          {
            status: StatusPedido.CANCELADO,
            alteradoEm: agora.toISOString(),
            motivo: "EXPIRACAO_SEGUNDA_TENTATIVA_PIX",
          },
        ] as Prisma.InputJsonArray,
      },
    });
  }
}

export async function expirarTentativasPixVencidas(
  prisma: PrismaClient,
  agora = new Date(),
) {
  const vencidas = await prisma.tentativaPagamento.findMany({
    where: {
      metodo: MetodoPagamento.PIX,
      status: StatusTentativaPagamento.PENDENTE,
      expiraEm: { lte: agora },
    },
    select: { pedidoId: true },
    distinct: ["pedidoId"],
  });
  for (const { pedidoId } of vencidas) {
    await transacaoSerializavel(prisma, async (tx) => {
      await bloquearPedido(tx, pedidoId);
      await expirarNoPedido(tx, pedidoId, agora);
    });
  }
}

async function inserirTentativa(input: {
  prisma: PrismaClient;
  pedidoId: string;
  chaveIdempotencia: string;
  numero: number;
  agora: Date;
}) {
  try {
    return await transacaoSerializavel(input.prisma, async (tx) => {
    await bloquearPedido(tx, input.pedidoId);
    await expirarNoPedido(tx, input.pedidoId, input.agora);

    const repetida = await tx.tentativaPagamento.findUnique({
      where: { chaveIdempotencia: input.chaveIdempotencia },
    });
    if (repetida) {
      if (repetida.pedidoId !== input.pedidoId) throw new Error("IDEMPOTENCIA_CONFLITO");
      return { tentativa: repetida, criada: false };
    }

    const pedido = await tx.pedido.findUnique({ where: { id: input.pedidoId } });
    if (!pedido) throw new Error("PEDIDO_NAO_ENCONTRADO");
    if (pedido.status === StatusPedido.CANCELADO || pedido.statusFinanceiro !== StatusFinanceiroPedido.PENDENTE) {
      throw new Error("PEDIDO_NAO_ACEITA_PAGAMENTO");
    }
    const tentativas = await tx.tentativaPagamento.findMany({
      where: { pedidoId: pedido.id },
      orderBy: { numeroTentativa: "asc" },
    });
    if (tentativas.length !== input.numero - 1) {
      throw new Error(input.numero === 1 ? "TENTATIVA_INICIAL_JA_EXISTE" : "TENTATIVA_PIX_INDISPONIVEL");
    }
    if (tentativas.some((tentativa) => tentativa.status === StatusTentativaPagamento.PENDENTE)) {
      throw new Error("TENTATIVA_ATIVA_EXISTENTE");
    }
    if (input.numero === 2 && pedido.metodoPagamento !== MetodoPagamento.PIX) {
      throw new Error("SEGUNDA_TENTATIVA_SOMENTE_PIX");
    }

    const tentativa = await tx.tentativaPagamento.create({
      data: {
        id: randomUUID(),
        pedidoId: pedido.id,
        metodo: pedido.metodoPagamento,
        numeroTentativa: input.numero,
        valor: pedido.total,
        chaveIdempotencia: input.chaveIdempotencia,
      },
    });
    return { tentativa, criada: true };
    });
  } catch (erro) {
    const codigo = erro instanceof Prisma.PrismaClientKnownRequestError
      ? erro.code
      : null;
    if (codigo !== "P2002") throw erro;
    const repetida = await input.prisma.tentativaPagamento.findUnique({
      where: { chaveIdempotencia: input.chaveIdempotencia },
    });
    if (repetida) {
      if (repetida.pedidoId !== input.pedidoId) throw new Error("IDEMPOTENCIA_CONFLITO");
      return { tentativa: repetida, criada: false };
    }
    const ativa = await input.prisma.tentativaPagamento.findFirst({
      where: { pedidoId: input.pedidoId, status: StatusTentativaPagamento.PENDENTE },
      select: { id: true },
    });
    if (ativa) throw new Error("TENTATIVA_ATIVA_EXISTENTE");
    if (input.numero === 2) throw new Error("TENTATIVA_PIX_INDISPONIVEL");
    throw erro;
  }
}

export async function iniciarTentativaInicial(input: {
  prisma: PrismaClient;
  provedor: ProvedorPagamentos | null;
  pedidoId: string;
  chavePedido: string;
  identificadorRateLimit: string;
  agora?: Date;
}) {
  const agora = input.agora ?? new Date();
  const chaveIdempotencia = `inicial:${input.chavePedido}`;
  const existente = await input.prisma.tentativaPagamento.findUnique({
    where: { chaveIdempotencia },
  });
  if (existente) {
    if (
      existente.metodo === MetodoPagamento.PIX &&
      existente.status === StatusTentativaPagamento.PENDENTE &&
      existente.confirmadaEm === null
    ) {
      if (!input.provedor) throw new Error("PROVEDOR_PAGAMENTO_INDISPONIVEL");
      return confirmarCriacaoCobranca(input.prisma, input.provedor, existente.id, agora);
    }
    return existente;
  }

  const pedido = await input.prisma.pedido.findUnique({ where: { id: input.pedidoId } });
  if (!pedido) throw new Error("PEDIDO_NAO_ENCONTRADO");
  if (pedido.metodoPagamento === MetodoPagamento.PIX) {
    if (!input.provedor) throw new Error("PROVEDOR_PAGAMENTO_INDISPONIVEL");
    limitarCobranca({
      operacao: "COBRANCA_INICIAL",
      identificador: input.identificadorRateLimit,
      idempotencyKey: chaveIdempotencia,
      agora: agora.getTime(),
    });
  }

  const resultado = await inserirTentativa({
    prisma: input.prisma,
    pedidoId: input.pedidoId,
    chaveIdempotencia,
    numero: 1,
    agora,
  });
  if (resultado.tentativa.metodo !== MetodoPagamento.PIX) {
    return resultado.tentativa;
  }
  if (!input.provedor) throw new Error("PROVEDOR_PAGAMENTO_INDISPONIVEL");
  if (
    !resultado.criada &&
    (resultado.tentativa.confirmadaEm !== null ||
      resultado.tentativa.status !== StatusTentativaPagamento.PENDENTE)
  ) {
    return resultado.tentativa;
  }
  return confirmarCriacaoCobranca(input.prisma, input.provedor, resultado.tentativa.id, agora);
}

export async function solicitarSegundaTentativa(input: {
  prisma: PrismaClient;
  provedor: ProvedorPagamentos;
  pedidoId: string;
  chaveRequisicao: string;
  identificadorRateLimit: string;
  agora?: Date;
}) {
  const agora = input.agora ?? new Date();
  const chaveIdempotencia = `segunda:${input.pedidoId}:${input.chaveRequisicao}`;
  const existente = await input.prisma.tentativaPagamento.findUnique({
    where: { chaveIdempotencia },
  });
  if (existente) {
    if (
      existente.status === StatusTentativaPagamento.PENDENTE &&
      existente.confirmadaEm === null
    ) {
      const tentativa = await confirmarCriacaoCobranca(
        input.prisma,
        input.provedor,
        existente.id,
        agora,
      );
      return { tentativa, repetida: true };
    }
    return { tentativa: existente, repetida: true };
  }
  limitarCobranca({
    operacao: "SEGUNDA_TENTATIVA",
    identificador: input.identificadorRateLimit,
    idempotencyKey: chaveIdempotencia,
    agora: agora.getTime(),
  });
  const resultado = await inserirTentativa({
    prisma: input.prisma,
    pedidoId: input.pedidoId,
    chaveIdempotencia,
    numero: 2,
    agora,
  });
  if (
    !resultado.criada &&
    (resultado.tentativa.confirmadaEm !== null ||
      resultado.tentativa.status !== StatusTentativaPagamento.PENDENTE)
  ) {
    return { tentativa: resultado.tentativa, repetida: true };
  }
  const tentativa = await confirmarCriacaoCobranca(
    input.prisma,
    input.provedor,
    resultado.tentativa.id,
    agora,
  );
  return { tentativa, repetida: !resultado.criada };
}

async function confirmarCriacaoCobranca(
  prisma: PrismaClient,
  provedor: ProvedorPagamentos,
  tentativaId: string,
  agora: Date,
) {
  const resultado = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${tentativaId}, 7313)) IS NULL AS "lockObtained"
    `;
    const tentativa = await tx.tentativaPagamento.findUniqueOrThrow({
      where: { id: tentativaId },
      include: { pedido: true },
    });
    if (
      tentativa.status !== StatusTentativaPagamento.PENDENTE ||
      tentativa.confirmadaEm !== null
    ) {
      return tentativa;
    }

    let cobranca;
    try {
      cobranca = await provedor.criarCobranca({
        pedidoId: tentativa.pedidoId,
        tentativaId: tentativa.id,
        valor: tentativa.valor.toFixed(2),
        metodo: tentativa.metodo,
        idempotencyKey: tentativa.chaveIdempotencia,
      });
    } catch {
      await tx.tentativaPagamento.update({
        where: { id: tentativa.id },
        data: {
          auditoria: acrescentar(tentativa.auditoria, {
            tipo: "RESULTADO_CRIACAO_COBRANCA_INDETERMINADO",
            registradaEm: agora.toISOString(),
          }),
        },
      });
      return tx.tentativaPagamento.findUniqueOrThrow({
        where: { id: tentativa.id },
      });
    }

    const criadaEm = new Date();
    const terminal =
      cobranca.estado === "FALHOU" || cobranca.estado === "RECUSADO";
    const status = terminal
      ? cobranca.estado === "RECUSADO"
        ? StatusTentativaPagamento.RECUSADO
        : StatusTentativaPagamento.FALHOU
      : StatusTentativaPagamento.PENDENTE;
    await tx.tentativaPagamento.update({
      where: { id: tentativa.id },
      data: {
        identificadorExterno: cobranca.identificador,
        status,
        confirmadaEm: terminal ? null : criadaEm,
        expiraEm:
          terminal || tentativa.metodo !== MetodoPagamento.PIX
            ? null
            : new Date(criadaEm.getTime() + DURACAO_TENTATIVA_MS),
        encerradoEm: terminal ? criadaEm : null,
        transacaoExterna: cobranca.transacao,
        auditoria: acrescentar(tentativa.auditoria, {
          tipo: "COBRANCA_CRIADA",
          confirmadaEm: criadaEm.toISOString(),
        }),
      },
    });
    return tx.tentativaPagamento.findUniqueOrThrow({
      where: { id: tentativa.id },
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });

  if (
    resultado.metodo === MetodoPagamento.PIX &&
    resultado.status === StatusTentativaPagamento.PENDENTE &&
    resultado.confirmadaEm === null
  ) {
    throw new Error("COBRANCA_NAO_CONFIRMADA");
  }
  return resultado;
}

export async function processarEventoPagamento(
  prisma: PrismaClient,
  provedor: ProvedorPagamentos,
  payload: unknown,
) {
  const evento = provedor.normalizarEvento(payload);
  return transacaoSerializavel(prisma, async (tx) => {
    const tentativa = await tx.tentativaPagamento.findFirst({
      where: {
        OR: [
          { id: evento.identificadorCobranca },
          { identificadorExterno: evento.identificadorCobranca },
        ],
      },
      include: { pedido: true },
    });
    if (!tentativa) throw new Error("TENTATIVA_PAGAMENTO_NAO_ENCONTRADA");
    await bloquearPedido(tx, tentativa.pedidoId);
    await expirarNoPedido(tx, tentativa.pedidoId, new Date());
    const atual = await tx.tentativaPagamento.findUniqueOrThrow({
      where: { id: tentativa.id },
      include: { pedido: true },
    });
    const eventos = Array.isArray(atual.eventos) ? atual.eventos : [];
    const duplicado = eventos.some((entrada) =>
      Boolean(entrada && typeof entrada === "object" && "idEvento" in entrada && entrada.idEvento === evento.idEvento),
    );
    const auditoria = acrescentar(atual.auditoria, {
      tipo: duplicado ? "EVENTO_DUPLICADO" : "EVENTO_RECEBIDO",
      idEvento: evento.idEvento,
      identificadorTransacao: evento.identificadorTransacao,
      estado: evento.estado,
      ocorridoEm: evento.ocorridoEm.toISOString(),
      registradoEm: new Date().toISOString(),
    });
    if (duplicado) {
      return tx.tentativaPagamento.update({ where: { id: atual.id }, data: { auditoria } });
    }

    const eventosNovos = [
      ...eventos,
      {
        idEvento: evento.idEvento,
        identificadorTransacao: evento.identificadorTransacao,
        estado: evento.estado,
        ocorridoEm: evento.ocorridoEm.toISOString(),
      },
    ] as Prisma.InputJsonArray;
    if (atual.status === StatusTentativaPagamento.PAGO && evento.estado === "PAGO") {
      return tx.tentativaPagamento.update({
        where: { id: atual.id },
        data: {
          eventos: eventosNovos,
          auditoria: acrescentar(auditoria, {
            tipo: atual.transacaoExterna && evento.identificadorTransacao !== atual.transacaoExterna
              ? "TRANSACAO_DIVERGENTE_MESMA_COBRANCA"
              : "CONFIRMACAO_REPETIDA_MESMA_COBRANCA",
            idEvento: evento.idEvento,
          }),
        },
      });
    }
    if (atual.status === StatusTentativaPagamento.PAGO && evento.estado !== "PAGO") {
      return tx.tentativaPagamento.update({
        where: { id: atual.id },
        data: { eventos: eventosNovos, auditoria },
      });
    }

    if (evento.estado === "PAGO") {
      const outroPago = await tx.tentativaPagamento.findFirst({
        where: {
          pedidoId: atual.pedidoId,
          id: { not: atual.id },
          status: StatusTentativaPagamento.PAGO,
        },
      });
      let tentativaAtualizada = await tx.tentativaPagamento.update({
        where: { id: atual.id },
        data: {
          status: StatusTentativaPagamento.PAGO,
          transacaoExterna: evento.identificadorTransacao ?? atual.transacaoExterna,
          encerradoEm: new Date(),
          eventos: eventosNovos,
          auditoria: outroPago
            ? acrescentar(auditoria, {
                tipo: "OUTRA_COBRANCA_DO_PEDIDO_TAMBEM_PAGA",
                outraTentativaId: outroPago.id,
              })
            : auditoria,
        },
      });
      if (outroPago) {
        await tx.tentativaPagamento.update({
          where: { id: outroPago.id },
          data: {
            auditoria: acrescentar(outroPago.auditoria, {
              tipo: "OUTRA_COBRANCA_DO_PEDIDO_TAMBEM_PAGA",
              outraTentativaId: atual.id,
              idEvento: evento.idEvento,
            }),
          },
        });
      }
      await tx.pedido.update({
        where: { id: atual.pedidoId },
        data: {
          statusFinanceiro: atual.pedido.status === StatusPedido.CANCELADO
            ? StatusFinanceiroPedido.REEMBOLSO_PENDENTE
            : StatusFinanceiroPedido.PAGO,
        },
      });
      return tentativaAtualizada;
    }

    const terminal = evento.estado !== "PENDENTE";
    const status = evento.estado === "RECUSADO"
      ? StatusTentativaPagamento.RECUSADO
      : evento.estado === "EXPIRADO"
        ? StatusTentativaPagamento.EXPIRADO
        : evento.estado === "FALHOU"
          ? StatusTentativaPagamento.FALHOU
          : StatusTentativaPagamento.PENDENTE;
    const atualizado = await tx.tentativaPagamento.update({
      where: { id: atual.id },
      data: {
        status,
        eventos: eventosNovos,
        auditoria,
        ...(terminal ? { encerradoEm: new Date() } : {}),
      },
    });
    if (evento.estado === "EXPIRADO" && atual.numeroTentativa === 2) {
      const pedido = await tx.pedido.findUnique({ where: { id: atual.pedidoId } });
      if (pedido && pedido.status !== StatusPedido.CANCELADO && pedido.status !== StatusPedido.CONCLUIDO) {
        const historico = Array.isArray(pedido.historicoStatus)
          ? (pedido.historicoStatus as Prisma.InputJsonArray)
          : [];
        await tx.pedido.update({
          where: { id: pedido.id },
          data: {
            status: StatusPedido.CANCELADO,
            ...(!pedido.usuarioId
              ? { tokenAcompanhamentoExpiraEm: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000) }
              : {}),
            historicoStatus: [
              ...historico,
              {
                status: StatusPedido.CANCELADO,
                alteradoEm: new Date().toISOString(),
                motivo: "EXPIRACAO_SEGUNDA_TENTATIVA_PIX",
              },
            ] as Prisma.InputJsonArray,
          },
        });
      }
    }
    return atualizado;
  });
}

export async function confirmarPagamentoPresencial(input: {
  prisma: PrismaClient;
  tentativaId: string;
  adminId: string;
  resultado: "PAGO" | "RECUSADO";
  agora?: Date;
}) {
  const agora = input.agora ?? new Date();
  return transacaoSerializavel(input.prisma, async (tx) => {
    const tentativa = await tx.tentativaPagamento.findUnique({
      where: { id: input.tentativaId },
      include: { pedido: true },
    });
    if (!tentativa) throw new Error("TENTATIVA_PAGAMENTO_NAO_ENCONTRADA");
    await bloquearPedido(tx, tentativa.pedidoId);
    if (tentativa.metodo === MetodoPagamento.PIX) throw new Error("CONFIRMACAO_PIX_NAO_PERMITIDA");
    if (tentativa.status !== StatusTentativaPagamento.PENDENTE) throw new Error("TENTATIVA_JA_ENCERRADA");
    const status = input.resultado === "PAGO"
      ? StatusTentativaPagamento.PAGO
      : StatusTentativaPagamento.RECUSADO;
    const atualizada = await tx.tentativaPagamento.update({
      where: { id: tentativa.id },
      data: {
        status,
        encerradoEm: agora,
        auditoria: acrescentar(tentativa.auditoria, {
          tipo: "CONFIRMACAO_PRESENCIAL_ADMIN",
          adminId: input.adminId,
          resultado: input.resultado,
          registradoEm: agora.toISOString(),
        }),
      },
    });
    if (status === StatusTentativaPagamento.PAGO) {
      await tx.pedido.update({
        where: { id: tentativa.pedidoId },
        data: {
          statusFinanceiro: tentativa.pedido.status === StatusPedido.CANCELADO
            ? StatusFinanceiroPedido.REEMBOLSO_PENDENTE
            : StatusFinanceiroPedido.PAGO,
        },
      });
    }
    return atualizada;
  });
}

export async function listarTentativasPagamento(
  prisma: ClienteBanco,
  pedidoId: string,
) {
  return prisma.tentativaPagamento.findMany({
    where: { pedidoId },
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
      criadoEm: true,
    },
  });
}
