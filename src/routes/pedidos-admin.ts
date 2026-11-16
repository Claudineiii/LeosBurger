import {
  MetodoPagamento,
  StatusFinanceiroPedido,
  StatusPedido,
  StatusReembolso,
  TipoEntrega,
} from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { idempotencyKeySchema } from "../services/pedidos.js";
import {
  confirmarReembolsoPix,
  decidirSolicitacaoCancelamento,
  iniciarReembolsoPix,
  listarPedidosAdmin,
  obterPedidoAdmin,
  registrarDevolucaoPresencial,
  transicionarStatusPedido,
} from "../services/pedidos-admin.js";

const erroSchema = z.object({ status: z.number(), error: z.string(), message: z.string() });
const enumStatusPedido = z.enum([
  StatusPedido.PENDENTE,
  StatusPedido.CONFIRMADO,
  StatusPedido.PREPARANDO,
  StatusPedido.PRONTO,
  StatusPedido.SAIU_PARA_ENTREGA,
  StatusPedido.CONCLUIDO,
  StatusPedido.CANCELADO,
]);
const enumStatusFinanceiro = z.enum([
  StatusFinanceiroPedido.PENDENTE,
  StatusFinanceiroPedido.PAGO,
  StatusFinanceiroPedido.REEMBOLSO_PENDENTE,
  StatusFinanceiroPedido.REEMBOLSADO,
]);
const pedidoIdParams = z.object({ id: z.string().uuid() });
const queryListaSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
  status: enumStatusPedido.optional(),
  statusFinanceiro: enumStatusFinanceiro.optional(),
  tipoEntrega: z.nativeEnum(TipoEntrega).optional(),
  metodoPagamento: z.nativeEnum(MetodoPagamento).optional(),
  numero: z.coerce.number().int().positive().optional(),
}).strict();
const respostaListaSchema = z.object({
  pagina: z.number().int(),
  limite: z.number().int(),
  total: z.number().int(),
  totalPaginas: z.number().int(),
  pedidos: z.array(z.object({
    id: z.string().uuid(),
    numero: z.number().int(),
    status: enumStatusPedido,
    statusFinanceiro: enumStatusFinanceiro,
    tipoEntrega: z.nativeEnum(TipoEntrega),
    metodoPagamento: z.nativeEnum(MetodoPagamento),
    nomeClienteHistorico: z.string(),
    telefoneClienteHistorico: z.string(),
    total: z.string(),
    criadoEm: z.string().datetime(),
    itensQuantidade: z.number().int(),
  })),
});
const itemDetalheSchema = z.object({
  id: z.string(),
  itemId: z.string().nullable(),
  comboId: z.string().nullable(),
  nomeHistorico: z.string(),
  precoUnitarioHistorico: z.string(),
  quantidade: z.number().int(),
  subtotal: z.string(),
  adicionais: z.unknown().nullable(),
  composicaoHistorica: z.unknown().nullable(),
});
const tentativaSchema = z.object({
  id: z.string(),
  metodo: z.nativeEnum(MetodoPagamento),
  numeroTentativa: z.number().int(),
  status: z.enum(["PENDENTE", "PAGO", "FALHOU", "RECUSADO", "EXPIRADO"]),
  valor: z.string(),
  confirmadaEm: z.string().datetime().nullable(),
  expiraEm: z.string().datetime().nullable(),
  encerradoEm: z.string().datetime().nullable(),
  identificadorExterno: z.string().nullable(),
  transacaoExterna: z.string().nullable(),
  auditoria: z.unknown(),
  criadoEm: z.string().datetime(),
});
const reembolsoSchema = z.object({
  id: z.string(),
  tentativaPagamentoId: z.string().nullable(),
  metodo: z.enum(["PIX", "DINHEIRO", "CREDITO", "DEBITO"]),
  status: z.nativeEnum(StatusReembolso),
  valor: z.string(),
  valorConfirmado: z.string().nullable(),
  motivo: z.string(),
  identificadorExterno: z.string().nullable(),
  identificadorTransacaoOriginal: z.string().nullable(),
  iniciadoPorAdminId: z.string(),
  iniciadoEm: z.string().datetime(),
  confirmadoPorAdminId: z.string().nullable(),
  confirmadoEm: z.string().datetime().nullable(),
  auditoria: z.unknown(),
});
const respostaDetalheSchema = z.object({
  id: z.string(),
  numero: z.number().int(),
  status: enumStatusPedido,
  statusFinanceiro: enumStatusFinanceiro,
  tipoEntrega: z.nativeEnum(TipoEntrega),
  metodoPagamento: z.nativeEnum(MetodoPagamento),
  nomeClienteHistorico: z.string(),
  telefoneClienteHistorico: z.string(),
  cepHistorico: z.string().nullable(),
  logradouroHistorico: z.string().nullable(),
  numeroHistorico: z.string().nullable(),
  complementoHistorico: z.string().nullable(),
  bairroHistorico: z.string().nullable(),
  cidadeHistorico: z.string().nullable(),
  estadoHistorico: z.string().nullable(),
  referenciaHistorico: z.string().nullable(),
  subtotal: z.string(),
  desconto: z.string(),
  taxaEntrega: z.string(),
  total: z.string(),
  codigoCupom: z.string().nullable(),
  cupomHistorico: z.unknown().nullable(),
  distanciaKm: z.string().nullable(),
  faixaFrete: z.object({ id: z.string(), distanciaMinima: z.string().nullable(), distanciaMaxima: z.string().nullable() }).nullable(),
  historicoStatus: z.array(z.unknown()),
  criadoEm: z.string().datetime(),
  itensPedido: z.array(itemDetalheSchema),
  tentativasPagamento: z.array(tentativaSchema),
  reembolsos: z.array(reembolsoSchema),
});
const respostaReembolsoSchema = z.object({
  id: z.string(),
  pedidoId: z.string(),
  tentativaPagamentoId: z.string().nullable(),
  metodo: z.enum(["PIX", "DINHEIRO", "CREDITO", "DEBITO"]),
  status: z.nativeEnum(StatusReembolso),
  valor: z.string(),
  valorConfirmado: z.string().nullable(),
  motivo: z.string(),
  identificadorTransacaoOriginal: z.string().nullable(),
  identificadorExterno: z.string().nullable(),
  iniciadoPorAdminId: z.string(),
  iniciadoEm: z.string().datetime(),
  confirmadoPorAdminId: z.string().nullable(),
  confirmadoEm: z.string().datetime().nullable(),
  auditoria: z.unknown(),
  repetido: z.boolean(),
});

const erros: Record<string, { status: 400 | 404 | 409; error: string; message: string }> = {
  PEDIDO_NAO_ENCONTRADO: { status: 404, error: "NOT_FOUND", message: "Pedido não encontrado." },
  TENTATIVA_PAGAMENTO_NAO_ENCONTRADA: { status: 404, error: "NOT_FOUND", message: "Tentativa de pagamento não encontrada." },
  REEMBOLSO_NAO_ENCONTRADO: { status: 404, error: "NOT_FOUND", message: "Reembolso não encontrado." },
  SOLICITACAO_CANCELAMENTO_NAO_ENCONTRADA: { status: 404, error: "NOT_FOUND", message: "Solicitação de cancelamento não encontrada." },
  TRANSICAO_STATUS_INVALIDA: { status: 409, error: "CONFLICT", message: "A transição de status não é permitida." },
  PEDIDO_NAO_PODE_SER_CANCELADO: { status: 409, error: "CONFLICT", message: "Este pedido não pode mais ser cancelado." },
  CONFLITO_STATUS_PEDIDO: { status: 409, error: "CONFLICT", message: "O status do pedido mudou durante a operação." },
  SOLICITACAO_CANCELAMENTO_JA_DECIDIDA: { status: 409, error: "CONFLICT", message: "A solicitação já foi decidida com outro resultado." },
  MOTIVO_CANCELAMENTO_OBRIGATORIO: { status: 400, error: "VALIDATION_ERROR", message: "Informe o motivo do cancelamento administrativo." },
  PAGAMENTO_NAO_CONFIRMADO: { status: 409, error: "CONFLICT", message: "O pagamento precisa estar confirmado para registrar uma devolução." },
  METODO_REEMBOLSO_INCOMPATIVEL: { status: 409, error: "CONFLICT", message: "O método de devolução não corresponde ao pagamento original." },
  VALOR_REEMBOLSO_INDISPONIVEL: { status: 409, error: "CONFLICT", message: "Não há valor disponível para devolução nesta transação." },
  REEMBOLSO_PARCIAL_NAO_PERMITIDO: { status: 400, error: "VALIDATION_ERROR", message: "A API não permite reembolso parcial." },
  REEMBOLSO_JA_CONFIRMADO: { status: 409, error: "CONFLICT", message: "O reembolso já foi confirmado." },
  IDEMPOTENCIA_CONFLITO: { status: 409, error: "CONFLICT", message: "A chave de idempotência já foi usada com outra operação." },
};

function responderErro(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && erros[error.message]) {
    const body = erros[error.message]!;
    return reply.code(body.status).send({ status: body.status, error: body.error, message: body.message });
  }
  throw error;
}

function serializarReembolso(resultado: Awaited<ReturnType<typeof iniciarReembolsoPix>>) {
  const registro = resultado.reembolso;
  return {
    id: registro.id,
    pedidoId: registro.pedidoId,
    tentativaPagamentoId: registro.tentativaPagamentoId,
    metodo: registro.metodo,
    status: registro.status,
    valor: registro.valor.toFixed(2),
    valorConfirmado: registro.valorConfirmado?.toFixed(2) ?? null,
    motivo: registro.motivo,
    identificadorTransacaoOriginal: registro.identificadorTransacaoOriginal,
    identificadorExterno: registro.identificadorExterno,
    iniciadoPorAdminId: registro.iniciadoPorAdminId,
    iniciadoEm: registro.iniciadoEm.toISOString(),
    confirmadoPorAdminId: registro.confirmadoPorAdminId,
    confirmadoEm: registro.confirmadoEm?.toISOString() ?? null,
    auditoria: registro.auditoria,
    repetido: resultado.repetido,
  };
}

export async function pedidosAdminRoutes(app: FastifyInstance) {
  const api = app.withTypeProvider<import("@fastify/type-provider-zod").ZodTypeProvider>();

  api.get("/admin/pedidos", {
    preHandler: [app.autorizarAdmin],
    schema: {
      description: "Lista pedidos para operação administrativa, com filtros e paginação.",
      tags: ["Admin - Pedidos"],
      querystring: queryListaSchema,
      response: { 200: respostaListaSchema, 401: erroSchema, 403: erroSchema },
    },
  }, async (request, reply) => {
    const filtro = request.query;
    const resultado = await listarPedidosAdmin(app.prisma, {
      pagina: filtro.pagina,
      limite: filtro.limite,
      ...(filtro.status ? { status: filtro.status } : {}),
      ...(filtro.statusFinanceiro ? { statusFinanceiro: filtro.statusFinanceiro } : {}),
      ...(filtro.tipoEntrega ? { tipoEntrega: filtro.tipoEntrega } : {}),
      ...(filtro.metodoPagamento ? { metodoPagamento: filtro.metodoPagamento } : {}),
      ...(filtro.numero ? { numero: filtro.numero } : {}),
    });
    return reply.send(resultado);
  });

  api.get("/admin/pedidos/:id", {
    preHandler: [app.autorizarAdmin],
    schema: {
      description: "Consulta snapshots e registros financeiros completos de um pedido.",
      tags: ["Admin - Pedidos"],
      params: pedidoIdParams,
      response: { 200: respostaDetalheSchema, 401: erroSchema, 403: erroSchema, 404: erroSchema },
    },
  }, async (request, reply) => {
    const pedido = await obterPedidoAdmin(app.prisma, request.params.id);
    if (!pedido) return reply.code(404).send({ status: 404, error: "NOT_FOUND", message: "Pedido não encontrado." });
    return reply.send(pedido);
  });

  api.patch("/admin/pedidos/:id/status", {
    preHandler: [app.verificarOrigem, app.autorizarAdmin],
    schema: {
      description: "Transiciona o estado operacional do pedido pela matriz aprovada.",
      tags: ["Admin - Pedidos"],
      params: pedidoIdParams,
      body: z.object({ statusAtualEsperado: enumStatusPedido, status: enumStatusPedido, motivo: z.string().trim().min(3).max(500).optional() }).strict(),
      response: {
        200: z.object({ id: z.string(), numero: z.number().int(), status: enumStatusPedido, statusFinanceiro: enumStatusFinanceiro, tipoEntrega: z.nativeEnum(TipoEntrega), atualizadoEm: z.string().datetime() }),
        400: erroSchema, 401: erroSchema, 403: erroSchema, 404: erroSchema, 409: erroSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const pedido = await transicionarStatusPedido({
        prisma: app.prisma,
        pedidoId: request.params.id,
        adminId: request.usuarioAutenticado!.id,
        statusAtualEsperado: request.body.statusAtualEsperado,
        proximoStatus: request.body.status,
        ...(request.body.motivo ? { motivo: request.body.motivo } : {}),
      });
      return reply.send({ ...pedido, atualizadoEm: pedido.atualizadoEm.toISOString() });
    } catch (error) { return responderErro(error, reply); }
  });

  api.patch("/admin/pedidos/:id/solicitacoes-cancelamento/:solicitacaoId", {
    preHandler: [app.verificarOrigem, app.autorizarAdmin],
    schema: {
      description: "Aprova ou rejeita solicitação de cancelamento; aprovação cancela atomicamente o pedido.",
      tags: ["Admin - Pedidos"],
      params: z.object({ id: z.string().uuid(), solicitacaoId: z.string().uuid() }),
      body: z.object({ decisao: z.enum(["APROVADA", "REJEITADA"]), justificativa: z.string().trim().min(3).max(500).optional() }).strict(),
      response: {
        200: z.object({ sucesso: z.boolean(), repetida: z.boolean(), pedidoId: z.string(), numero: z.number().int(), decisao: z.enum(["APROVADA", "REJEITADA"]), status: enumStatusPedido, statusFinanceiro: enumStatusFinanceiro }),
        400: erroSchema, 401: erroSchema, 403: erroSchema, 404: erroSchema, 409: erroSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const resultado = await decidirSolicitacaoCancelamento({
        prisma: app.prisma,
        pedidoId: request.params.id,
        solicitacaoId: request.params.solicitacaoId,
        adminId: request.usuarioAutenticado!.id,
        decisao: request.body.decisao,
        ...(request.body.justificativa ? { justificativa: request.body.justificativa } : {}),
      });
      return reply.send(resultado);
    } catch (error) { return responderErro(error, reply); }
  });

  const bodyReembolso = z.object({ tentativaId: z.string().uuid(), motivo: z.string().trim().min(3).max(500) }).strict();
  const headersIdempotencia = z.object({ "idempotency-key": idempotencyKeySchema });
  const paramsReembolso = z.object({ id: z.string().uuid() });

  api.post("/admin/pedidos/:id/reembolsos", {
    preHandler: [app.verificarOrigem, app.autorizarAdmin],
    schema: {
      description: "Inicia manualmente reembolso PIX integral da transação paga escolhida.",
      tags: ["Admin - Reembolsos"],
      params: paramsReembolso,
      headers: headersIdempotencia,
      body: bodyReembolso,
      response: { 201: respostaReembolsoSchema, 200: respostaReembolsoSchema, 400: erroSchema, 401: erroSchema, 403: erroSchema, 404: erroSchema, 409: erroSchema },
    },
  }, async (request, reply) => {
    try {
      const resultado = await iniciarReembolsoPix({
        prisma: app.prisma,
        pedidoId: request.params.id,
        tentativaId: request.body.tentativaId,
        motivo: request.body.motivo,
        chaveIdempotencia: request.headers["idempotency-key"],
        adminId: request.usuarioAutenticado!.id,
      });
      return reply.code(resultado.repetido ? 200 : 201).send(serializarReembolso(resultado));
    } catch (error) { return responderErro(error, reply); }
  });

  api.patch("/admin/pedidos/:id/reembolsos/:reembolsoId", {
    preHandler: [app.verificarOrigem, app.autorizarAdmin],
    schema: {
      description: "Confirma manualmente a execução integral de reembolso PIX pendente.",
      tags: ["Admin - Reembolsos"],
      params: z.object({ id: z.string().uuid(), reembolsoId: z.string().uuid() }),
      headers: headersIdempotencia,
      body: z.object({ valorConfirmado: z.string().regex(/^\d{1,8}\.\d{2}$/), identificadorExterno: z.string().trim().min(1).max(150).optional() }).strict(),
      response: { 200: respostaReembolsoSchema, 400: erroSchema, 401: erroSchema, 403: erroSchema, 404: erroSchema, 409: erroSchema },
    },
  }, async (request, reply) => {
    try {
      const resultado = await confirmarReembolsoPix({
        prisma: app.prisma,
        pedidoId: request.params.id,
        reembolsoId: request.params.reembolsoId,
        adminId: request.usuarioAutenticado!.id,
        chaveIdempotencia: request.headers["idempotency-key"],
        valorConfirmado: request.body.valorConfirmado,
        ...(request.body.identificadorExterno ? { identificadorExterno: request.body.identificadorExterno } : {}),
      });
      return reply.send(serializarReembolso(resultado));
    } catch (error) { return responderErro(error, reply); }
  });

  api.post("/admin/pedidos/:id/devolucoes-presenciais", {
    preHandler: [app.verificarOrigem, app.autorizarAdmin],
    schema: {
      description: "Registra devolução presencial integral já realizada, separada de reembolso PIX.",
      tags: ["Admin - Reembolsos"],
      params: paramsReembolso,
      headers: headersIdempotencia,
      body: bodyReembolso,
      response: { 201: respostaReembolsoSchema, 200: respostaReembolsoSchema, 400: erroSchema, 401: erroSchema, 403: erroSchema, 404: erroSchema, 409: erroSchema },
    },
  }, async (request, reply) => {
    try {
      const resultado = await registrarDevolucaoPresencial({
        prisma: app.prisma,
        pedidoId: request.params.id,
        tentativaId: request.body.tentativaId,
        motivo: request.body.motivo,
        chaveIdempotencia: request.headers["idempotency-key"],
        adminId: request.usuarioAutenticado!.id,
      });
      return reply.code(resultado.repetido ? 200 : 201).send(serializarReembolso(resultado));
    } catch (error) { return responderErro(error, reply); }
  });
}
