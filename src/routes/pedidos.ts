import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import {
  criarPedido,
  idempotencyKeySchema,
  listarPedidosCliente,
  obterAcompanhamentoVisitante,
  obterDetalhePedidoCliente,
  pedidoBodySchema,
  recuperarAcompanhamentoBodySchema,
  recuperarTokenAcompanhamento,
  registrarSolicitacaoCancelamento,
  revogarTokenAcompanhamentoAdmin,
} from "../services/pedidos.js";
import {
  confirmarPagamentoPresencial,
  expirarTentativasPixVencidas,
  listarTentativasPagamento,
  processarEventoPagamento,
  solicitarSegundaTentativa,
} from "../services/pagamentos/tentativas.js";
import { limitarCobranca } from "../services/pagamentos/limites.js";
import type { TentativaPagamento } from "@prisma/client";
import type { CenarioSimulacao } from "../services/pagamentos/simulador.js";

const erroSchema = z.object({
  status: z.number(),
  error: z.string(),
  message: z.string(),
});

const adicionalSchema = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  preco: z.string(),
  quantidade: z.number().int(),
});

const composicaoSchema = z.object({
  itemId: z.string().uuid(),
  nome: z.string(),
  precoUnitario: z.string(),
  quantidade: z.number().int(),
});

const pedidoRespostaSchema = z.object({
  id: z.string().uuid(),
  numero: z.number().int(),
  status: z.enum([
    "PENDENTE",
    "CONFIRMADO",
    "PREPARANDO",
    "PRONTO",
    "SAIU_PARA_ENTREGA",
    "CONCLUIDO",
    "CANCELADO",
  ]),
  statusFinanceiro: z.enum(["PENDENTE", "PAGO", "REEMBOLSO_PENDENTE"]),
  tipoEntrega: z.enum(["ENTREGA", "RETIRADA"]),
  metodoPagamento: z.enum(["PIX", "CREDITO", "DEBITO", "DINHEIRO"]),
  subtotal: z.string(),
  desconto: z.string(),
  taxaEntrega: z.string(),
  total: z.string(),
  codigoCupom: z.string().nullable(),
  distanciaKm: z.string().nullable(),
  faixaFrete: z
    .object({
      id: z.string().uuid(),
      distanciaMinima: z.string(),
      distanciaMaxima: z.string(),
    })
    .nullable(),
  endereco: z
    .object({
      cep: z.string().nullable(),
      logradouro: z.string().nullable(),
      numero: z.string().nullable(),
      complemento: z.string().nullable(),
      bairro: z.string().nullable(),
      cidade: z.string().nullable(),
      estado: z.string().nullable(),
      referencia: z.string().nullable(),
    })
    .nullable(),
  itens: z.array(
    z.object({
      id: z.string().uuid(),
      itemId: z.string().uuid().nullable(),
      comboId: z.string().uuid().nullable(),
      nome: z.string(),
      precoUnitario: z.string(),
      quantidade: z.number().int(),
      subtotal: z.string(),
      adicionais: z.array(adicionalSchema).nullable(),
      composicao: z.array(composicaoSchema).nullable(),
    }),
  ),
  criadoEm: z.string().datetime(),
});

const pedidoCriadoSchema = z.object({
  pedido: pedidoRespostaSchema,
  pagamento: z.object({
    id: z.string().uuid(),
    numeroTentativa: z.number().int(),
    metodo: z.enum(["PIX", "CREDITO", "DEBITO", "DINHEIRO"]),
    status: z.enum(["PENDENTE", "PAGO", "FALHOU", "RECUSADO", "EXPIRADO"]),
    valor: z.string(),
    confirmadaEm: z.string().datetime().nullable(),
    expiraEm: z.string().datetime().nullable(),
  }),
  tokenAcompanhamento: z.string().length(43).nullable(),
  repetido: z.boolean(),
});

const tokenAcompanhamentoSchema = z.object({
  tokenAcompanhamento: z.string().length(43),
});

const tentativaPagamentoSchema = z.object({
  id: z.string().uuid(),
  metodo: z.enum(["PIX", "CREDITO", "DEBITO", "DINHEIRO"]),
  numeroTentativa: z.number().int(),
  status: z.enum(["PENDENTE", "PAGO", "FALHOU", "RECUSADO", "EXPIRADO"]),
  valor: z.string(),
  confirmadaEm: z.string().datetime().nullable(),
  expiraEm: z.string().datetime().nullable(),
  encerradoEm: z.string().datetime().nullable(),
  criadoEm: z.string().datetime(),
});

const tentativasRespostaSchema = z.object({
  statusFinanceiro: z.enum(["PENDENTE", "PAGO", "REEMBOLSO_PENDENTE"]),
  tentativas: z.array(tentativaPagamentoSchema),
});

const listaPedidosQuerySchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(50).default(20),
});

const pedidoResumoListaSchema = z.object({
  id: z.string().uuid(),
  numero: z.number().int(),
  status: z.enum([
    "PENDENTE",
    "CONFIRMADO",
    "PREPARANDO",
    "PRONTO",
    "SAIU_PARA_ENTREGA",
    "CONCLUIDO",
    "CANCELADO",
  ]),
  statusFinanceiro: z.enum(["PENDENTE", "PAGO", "REEMBOLSO_PENDENTE"]),
  tipoEntrega: z.enum(["ENTREGA", "RETIRADA"]),
  metodoPagamento: z.enum(["PIX", "CREDITO", "DEBITO", "DINHEIRO"]),
  subtotal: z.string(),
  desconto: z.string(),
  taxaEntrega: z.string(),
  total: z.string(),
  codigoCupom: z.string().nullable(),
  itensQuantidade: z.number().int(),
  criadoEm: z.string().datetime(),
});

const listaPedidosRespostaSchema = z.object({
  pagina: z.number().int(),
  limite: z.number().int(),
  total: z.number().int(),
  totalPaginas: z.number().int(),
  pedidos: z.array(pedidoResumoListaSchema),
});

const acompanhamentoVisitanteRespostaSchema = z.object({
  id: z.string().uuid(),
  numero: z.number().int(),
  status: z.enum([
    "PENDENTE",
    "CONFIRMADO",
    "PREPARANDO",
    "PRONTO",
    "SAIU_PARA_ENTREGA",
    "CONCLUIDO",
    "CANCELADO",
  ]),
  statusFinanceiro: z.enum(["PENDENTE", "PAGO", "REEMBOLSO_PENDENTE"]),
  tipoEntrega: z.enum(["ENTREGA", "RETIRADA"]),
  metodoPagamento: z.enum(["PIX", "CREDITO", "DEBITO", "DINHEIRO"]),
  subtotal: z.string(),
  desconto: z.string(),
  taxaEntrega: z.string(),
  total: z.string(),
  criadoEm: z.string().datetime(),
  itens: z.array(
    z.object({
      id: z.string().uuid(),
      nome: z.string(),
      quantidade: z.number().int(),
      precoUnitario: z.string(),
      subtotal: z.string(),
      adicionais: z
        .array(
          z.object({
            nome: z.string(),
            quantidade: z.number().int(),
          }),
        )
        .nullable(),
    }),
  ),
  pagamento: z.array(
    z.object({
      id: z.string().uuid(),
      numeroTentativa: z.number().int(),
      metodo: z.enum(["PIX", "CREDITO", "DEBITO", "DINHEIRO"]),
      status: z.enum(["PENDENTE", "PAGO", "FALHOU", "RECUSADO", "EXPIRADO"]),
      valor: z.string(),
      confirmadaEm: z.string().datetime().nullable(),
      expiraEm: z.string().datetime().nullable(),
    }),
  ),
});

const solicitacaoCancelamentoBodySchema = z
  .object({
    motivo: z.string().trim().min(3).max(500),
  })
  .strict();

const solicitacaoCancelamentoRespostaSchema = z.object({
  sucesso: z.boolean(),
  pedidoId: z.string().uuid(),
  numero: z.number().int(),
  status: z.string(),
  mensagem: z.string(),
});

const revogarTokenAcompanhamentoRespostaSchema = z.object({
  sucesso: z.boolean(),
  pedidoId: z.string().uuid(),
  numero: z.number().int(),
  revogadoEm: z.string().datetime(),
  mensagem: z.string(),
});

const pedidoDetalheClienteRespostaSchema = pedidoRespostaSchema.extend({
  historicoStatus: z.array(z.record(z.string(), z.unknown())),
  tentativasPagamento: z.array(
    z.object({
      id: z.string().uuid(),
      metodo: z.enum(["PIX", "CREDITO", "DEBITO", "DINHEIRO"]),
      numeroTentativa: z.number().int(),
      status: z.enum(["PENDENTE", "PAGO", "FALHOU", "RECUSADO", "EXPIRADO"]),
      valor: z.string(),
      confirmadaEm: z.string().datetime().nullable(),
      expiraEm: z.string().datetime().nullable(),
      encerradoEm: z.string().datetime().nullable(),
      criadoEm: z.string().datetime(),
    }),
  ),
});

const mensagensErro: Record<
  string,
  { status: 400 | 403 | 404 | 409 | 429 | 503; error: string; message: string }
> = {
  USUARIO_NAO_AUTORIZADO: {
    status: 403,
    error: "FORBIDDEN",
    message: "Acesso não autorizado.",
  },
  DADOS_CLIENTE_NAO_PERMITIDOS: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Os dados do cliente autenticado são obtidos da própria conta.",
  },
  DADOS_CLIENTE_OBRIGATORIOS: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Informe nome e telefone para criar um pedido como visitante.",
  },
  PAGAMENTO_VISITANTE_INVALIDO: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Visitantes podem selecionar somente PIX.",
  },
  REFERENCIA_ENDERECO_NAO_PERMITIDA: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Clientes autenticados utilizam o endereço salvo na própria conta.",
  },
  REFERENCIA_ENDERECO_OBRIGATORIA: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Informe uma referência válida de endereço para entrega.",
  },
  REFERENCIA_ENDERECO_INVALIDA: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "A referência de endereço é inválida ou expirou.",
  },
  CUPOM_INVALIDO: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "O cupom informado não pode ser aplicado ao carrinho.",
  },
  CUPOM_ESGOTADO: {
    status: 409,
    error: "CONFLICT",
    message: "O limite de usos do cupom foi atingido.",
  },
  ITEM_INDISPONIVEL: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Um item ou combo não está disponível.",
  },
  ADICIONAL_INDISPONIVEL: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Um adicional não pertence ao item ou está indisponível.",
  },
  QUANTIDADE_ADICIONAL_INVALIDA: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "A quantidade de um adicional excede o limite permitido.",
  },
  ENTREGA_INDISPONIVEL: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "A entrega exige endereço validado dentro da área atendida.",
  },
  CHECKOUT_ALTERADO: {
    status: 409,
    error: "CONFLICT",
    message: "Os valores do checkout foram alterados; atualize a prévia.",
  },
  IDEMPOTENCIA_CONFLITO: {
    status: 409,
    error: "CONFLICT",
    message: "A chave de idempotência já foi usada com outra requisição.",
  },
  ACOMPANHAMENTO_NAO_ENCONTRADO: {
    status: 404,
    error: "NOT_FOUND",
    message: "Não foi possível recuperar o acompanhamento do pedido.",
  },
  PEDIDO_NAO_ENCONTRADO: {
    status: 404,
    error: "NOT_FOUND",
    message: "Pedido não encontrado.",
  },
  TENTATIVA_PAGAMENTO_NAO_ENCONTRADA: {
    status: 404,
    error: "NOT_FOUND",
    message: "Tentativa de pagamento não encontrada.",
  },
  TENTATIVA_PIX_INDISPONIVEL: {
    status: 409,
    error: "CONFLICT",
    message: "A segunda tentativa PIX não está disponível.",
  },
  TENTATIVA_INICIAL_JA_EXISTE: {
    status: 409,
    error: "CONFLICT",
    message: "A tentativa inicial já existe.",
  },
  TENTATIVA_ATIVA_EXISTENTE: {
    status: 409,
    error: "CONFLICT",
    message: "Já existe uma tentativa de pagamento ativa.",
  },
  PEDIDO_NAO_ACEITA_PAGAMENTO: {
    status: 409,
    error: "CONFLICT",
    message: "O pedido não aceita uma nova cobrança.",
  },
  SEGUNDA_TENTATIVA_SOMENTE_PIX: {
    status: 409,
    error: "CONFLICT",
    message: "Somente pedidos PIX aceitam uma segunda tentativa.",
  },
  RATE_LIMIT_PAGAMENTO_EXCEDIDO: {
    status: 429,
    error: "RATE_LIMIT_EXCEEDED",
    message: "Limite de tentativas atingido. Tente novamente mais tarde.",
  },
  RATE_LIMITER_DISTRIBUIDO_INDISPONIVEL: {
    status: 503,
    error: "SERVICE_UNAVAILABLE",
    message: "A cobrança está indisponível no momento.",
  },
  LIMITES_PAGAMENTO_NAO_CONFIGURADOS: {
    status: 503,
    error: "SERVICE_UNAVAILABLE",
    message: "A cobrança está temporariamente indisponível.",
  },
  PROVEDOR_PAGAMENTO_INDISPONIVEL: {
    status: 503,
    error: "SERVICE_UNAVAILABLE",
    message: "O serviço de pagamento não está disponível.",
  },
  COBRANCA_NAO_CONFIRMADA: {
    status: 503,
    error: "SERVICE_UNAVAILABLE",
    message: "A cobrança ainda não foi confirmada pelo serviço de pagamento.",
  },
  CONFIRMACAO_PIX_NAO_PERMITIDA: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Confirmações PIX manuais não são permitidas.",
  },
  TENTATIVA_JA_ENCERRADA: {
    status: 409,
    error: "CONFLICT",
    message: "A tentativa já foi encerrada.",
  },
  PEDIDO_NAO_PODE_SER_CANCELADO: {
    status: 409,
    error: "CONFLICT",
    message: "Este pedido não pode mais ser cancelado.",
  },
  SOLICITACAO_CANCELAMENTO_JA_REGISTRADA: {
    status: 409,
    error: "CONFLICT",
    message: "Já existe uma solicitação de cancelamento registrada para este pedido.",
  },
  PEDIDO_NAO_POSSUI_TOKEN: {
    status: 400,
    error: "BAD_REQUEST",
    message: "O pedido informado não possui token de acompanhamento para revogação.",
  },
  ACESSO_EXCLUSIVO_CLIENTE: {
    status: 403,
    error: "FORBIDDEN",
    message: "Acesso exclusivo para clientes autenticados.",
  },
};

function enviarErroConhecido(erro: unknown, reply: FastifyReply) {
  if (erro instanceof z.ZodError) {
    return reply.code(400).send({
      status: 400,
      error: "VALIDATION_ERROR",
      message: "Os dados da requisição são inválidos.",
    });
  }
  if (erro instanceof Error) {
    const resposta = mensagensErro[erro.message];
    if (resposta) {
      return reply.code(resposta.status).send(resposta);
    }
  }
  throw erro;
}

export async function pedidosRoutes(app: FastifyInstance) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  let temporizador: NodeJS.Timeout | undefined;
  app.addHook("onReady", async () => {
    temporizador = setInterval(() => {
      void expirarTentativasPixVencidas(app.prisma).catch((erro: unknown) => {
        app.log.error({ err: erro }, "Falha ao expirar tentativas PIX vencidas");
      });
    }, 1_000);
    temporizador.unref();
  });
  app.addHook("onClose", async () => {
    if (temporizador) clearInterval(temporizador);
  });

  api.post(
    "/pedidos",
    {
      preHandler: [app.verificarOrigem, app.autenticarOpcional],
      schema: {
        description:
          "Cria pedido, snapshots históricos e sua tentativa de pagamento inicial.",
        tags: ["Pedidos"],
        headers: z.object({ "idempotency-key": idempotencyKeySchema }),
        body: pedidoBodySchema,
        response: {
          201: pedidoCriadoSchema,
          200: pedidoCriadoSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          409: erroSchema,
          429: erroSchema,
          503: erroSchema,
          500: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const resultado = await criarPedido(
          request,
          request.headers["idempotency-key"],
          request.body,
          app.provedorPagamentos,
        );
        return reply.code(resultado.repetido ? 200 : 201).send(resultado);
      } catch (erro) {
        return enviarErroConhecido(erro, reply);
      }
    },
  );

  api.get(
    "/pedidos",
    {
      preHandler: [app.autenticar],
      schema: {
        description: "Lista o histórico de pedidos do cliente autenticado.",
        tags: ["Pedidos"],
        querystring: listaPedidosQuerySchema,
        response: {
          200: listaPedidosRespostaSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          500: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        if (request.usuarioAutenticado?.tipo !== "CLIENTE") {
          return reply.code(403).send(mensagensErro.ACESSO_EXCLUSIVO_CLIENTE!);
        }
        const resultado = await listarPedidosCliente(
          app.prisma,
          request.usuarioAutenticado.id,
          request.query,
        );
        return reply.code(200).send(resultado);
      } catch (erro) {
        return enviarErroConhecido(erro, reply);
      }
    },
  );

  api.get(
    "/pedidos/acompanhamento",
    {
      preHandler: [app.autenticarOpcional],
      schema: {
        description:
          "Consulta acompanhamento operacional e financeiro do pedido por visitante usando token.",
        tags: ["Pedidos"],
        headers: z
          .object({
            "x-pedido-token": z.string().min(1).optional(),
          })
          .passthrough(),
        response: {
          200: acompanhamentoVisitanteRespostaSchema,
          400: erroSchema,
          404: erroSchema,
          429: erroSchema,
          500: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const query = request.query as Record<string, unknown> | undefined;
        if (query && (query.token || query.tokenAcompanhamento || query["x-pedido-token"])) {
          return reply.code(400).send({
            status: 400,
            error: "BAD_REQUEST",
            message: "O token de acompanhamento não deve ser enviado na query ou URL.",
          });
        }
        const tokenRecebido = request.headers["x-pedido-token"];
        if (typeof tokenRecebido !== "string" || !tokenRecebido.trim()) {
          return reply.code(404).send({
            status: 404,
            error: "NOT_FOUND",
            message: "Pedido não encontrado.",
          });
        }
        limitarCobranca({
          operacao: "CONSULTA_ACOMPANHAMENTO",
          identificador: `${request.ip}:${tokenRecebido.slice(0, 8)}`,
        });
        const acompanhamento = await obterAcompanhamentoVisitante(
          app.prisma,
          tokenRecebido.trim(),
        );
        if (!acompanhamento) {
          return reply.code(404).send({
            status: 404,
            error: "NOT_FOUND",
            message: "Pedido não encontrado.",
          });
        }
        return reply.code(200).send(acompanhamento);
      } catch (erro) {
        return enviarErroConhecido(erro, reply);
      }
    },
  );

  api.get(
    "/pedidos/:id",
    {
      preHandler: [app.autenticar],
      schema: {
        description:
          "Obtém detalhe completo de um pedido pertencente ao cliente autenticado.",
        tags: ["Pedidos"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: pedidoDetalheClienteRespostaSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          500: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        if (request.usuarioAutenticado?.tipo !== "CLIENTE") {
          return reply.code(403).send(mensagensErro.ACESSO_EXCLUSIVO_CLIENTE!);
        }
        const pedido = await obterDetalhePedidoCliente(
          app.prisma,
          request.params.id,
          request.usuarioAutenticado.id,
        );
        if (!pedido) {
          return reply.code(404).send({
            status: 404,
            error: "NOT_FOUND",
            message: "Pedido não encontrado.",
          });
        }
        return reply.code(200).send(pedido);
      } catch (erro) {
        return enviarErroConhecido(erro, reply);
      }
    },
  );

  api.post(
    "/pedidos/:id/solicitacoes-cancelamento",
    {
      preHandler: [app.verificarOrigem, app.autenticarOpcional],
      schema: {
        description:
          "Registra solicitação de cancelamento de pedido por cliente proprietário ou visitante com token válido.",
        tags: ["Pedidos"],
        params: z.object({ id: z.string().uuid() }),
        headers: z
          .object({
            "x-pedido-token": z.string().length(43).optional(),
          })
          .passthrough(),
        body: solicitacaoCancelamentoBodySchema,
        response: {
          200: solicitacaoCancelamentoRespostaSchema,
          400: erroSchema,
          404: erroSchema,
          409: erroSchema,
          429: erroSchema,
          500: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const pedido = await pedidoAutorizado(app, request.params.id, request);
        if (!pedido) {
          return reply.code(404).send({
            status: 404,
            error: "NOT_FOUND",
            message: "Pedido não encontrado.",
          });
        }
        limitarCobranca({
          operacao: "SOLICITACAO_CANCELAMENTO",
          identificador: `${request.ip}:${pedido.id}`,
          idempotencyKey: `cancelamento:${pedido.id}`,
        });
        const resultado = await registrarSolicitacaoCancelamento(app.prisma, {
          pedidoId: pedido.id,
          solicitante: request.usuarioAutenticado
            ? { tipo: "CLIENTE", usuarioId: request.usuarioAutenticado.id }
            : { tipo: "VISITANTE" },
          motivo: request.body.motivo,
        });
        return reply.code(200).send(resultado);
      } catch (erro) {
        return enviarErroConhecido(erro, reply);
      }
    },
  );

  api.get(
    "/pedidos/:id/tentativas-pagamento",
    {
      preHandler: [app.autenticarOpcional],
      schema: {
        description: "Consulta somente as tentativas financeiras do próprio pedido.",
        tags: ["Pagamentos"],
        params: z.object({ id: z.string().uuid() }),
        headers: z.object({ "x-pedido-token": z.string().length(43).optional() }),
        response: { 200: tentativasRespostaSchema, 404: erroSchema },
      },
    },
    async (request, reply) => {
      const pedido = await pedidoAutorizado(app, request.params.id, request);
      if (!pedido) return reply.code(404).send(mensagensErro.ACOMPANHAMENTO_NAO_ENCONTRADO!);
      await expirarTentativasPixVencidas(app.prisma);
      return reply.send({
        statusFinanceiro: pedido.statusFinanceiro,
        tentativas: (await listarTentativasPagamento(app.prisma, pedido.id)).map((item) => ({
          ...item,
          valor: item.valor.toFixed(2),
          confirmadaEm: item.confirmadaEm?.toISOString() ?? null,
          expiraEm: item.expiraEm?.toISOString() ?? null,
          encerradoEm: item.encerradoEm?.toISOString() ?? null,
          criadoEm: item.criadoEm.toISOString(),
        })),
      });
    },
  );

  api.post(
    "/pedidos/:id/tentativas-pagamento",
    {
      preHandler: [app.verificarOrigem, app.autenticarOpcional],
      schema: {
        description: "Solicita a segunda tentativa PIX, quando elegível.",
        tags: ["Pagamentos"],
        params: z.object({ id: z.string().uuid() }),
        headers: z.object({
          "idempotency-key": idempotencyKeySchema,
          "x-pedido-token": z.string().length(43).optional(),
        }),
        response: { 201: tentativaPagamentoSchema, 200: tentativaPagamentoSchema, 400: erroSchema, 404: erroSchema, 409: erroSchema, 429: erroSchema, 503: erroSchema },
      },
    },
    async (request, reply) => {
      try {
        const pedido = await pedidoAutorizado(app, request.params.id, request);
        if (!pedido) return reply.code(404).send(mensagensErro.ACOMPANHAMENTO_NAO_ENCONTRADO!);
        if (!app.provedorPagamentos) throw new Error("PROVEDOR_PAGAMENTO_INDISPONIVEL");
        const resultado = await solicitarSegundaTentativa({
          prisma: app.prisma,
          provedor: app.provedorPagamentos,
          pedidoId: pedido.id,
          chaveRequisicao: request.headers["idempotency-key"],
          identificadorRateLimit: request.usuarioAutenticado?.id ?? `ip:${request.ip}`,
        });
        return reply
          .code(resultado.repetida ? 200 : 201)
          .send(serializarTentativa(resultado.tentativa));
      } catch (erro) {
        return enviarErroConhecido(erro, reply);
      }
    },
  );

  if (app.simuladorPagamentos) {
    api.post(
      "/dev/pedidos/:id/tentativas-pagamento/simular",
      {
        preHandler: [app.verificarOrigem, app.autorizarAdmin],
        schema: {
          description: "Emite eventos de pagamento simulados apenas em dev/testes.",
          tags: ["Pagamentos"],
          params: z.object({ id: z.string().uuid() }),
          body: z.object({
            tentativaId: z.string().uuid(),
            cenario: z.enum(["PENDENTE", "PAGO", "FALHOU", "RECUSADO", "EXPIRADO", "TARDIO", "DUPLICADO"]),
          }).strict(),
          response: { 200: tentativaPagamentoSchema, 400: erroSchema, 404: erroSchema },
        },
      },
      async (request, reply) => {
        try {
          const tentativa = await app.prisma.tentativaPagamento.findFirst({
            where: { id: request.body.tentativaId, pedidoId: request.params.id },
          });
          if (!tentativa) throw new Error("TENTATIVA_PAGAMENTO_NAO_ENCONTRADA");
          const eventos = await app.simuladorPagamentos!.criarEvento({
            tentativaId: tentativa.id,
            cenario: request.body.cenario as CenarioSimulacao,
            ...(request.body.cenario === "TARDIO"
              ? { dataEvento: new Date(Date.now() - 6 * 60 * 1_000) }
              : {}),
          });
          let atual = tentativa;
          for (const evento of eventos) {
            atual = await processarEventoPagamento(app.prisma, app.simuladorPagamentos!, evento);
          }
          return reply.send(serializarTentativa(atual));
        } catch (erro) {
          return enviarErroConhecido(erro, reply);
        }
      },
    );
  }

  api.patch(
    "/admin/pedidos/:id/tentativas-pagamento/:tentativaId",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description: "Registra confirmação ou recusa presencial por ADMIN.",
        tags: ["Pagamentos"],
        params: z.object({ id: z.string().uuid(), tentativaId: z.string().uuid() }),
        body: z.object({ resultado: z.enum(["PAGO", "RECUSADO"]) }).strict(),
        response: { 200: tentativaPagamentoSchema, 400: erroSchema, 404: erroSchema, 409: erroSchema },
      },
    },
    async (request, reply) => {
      try {
        const tentativa = await app.prisma.tentativaPagamento.findFirst({
          where: { id: request.params.tentativaId, pedidoId: request.params.id },
        });
        if (!tentativa) throw new Error("TENTATIVA_PAGAMENTO_NAO_ENCONTRADA");
        const atualizada = await confirmarPagamentoPresencial({
          prisma: app.prisma,
          tentativaId: tentativa.id,
          adminId: request.usuarioAutenticado!.id,
          resultado: request.body.resultado,
        });
        return reply.send(serializarTentativa(atualizada));
      } catch (erro) {
        return enviarErroConhecido(erro, reply);
      }
    },
  );

  api.patch(
    "/admin/pedidos/:id/token-acompanhamento/revogar",
    {
      preHandler: [app.verificarOrigem, app.autorizarAdmin],
      schema: {
        description: "Revoga imediatamente o token de acompanhamento de um visitante pelo ADMIN.",
        tags: ["Admin - Pedidos"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: revogarTokenAcompanhamentoRespostaSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          500: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const resultado = await revogarTokenAcompanhamentoAdmin(
          app.prisma,
          request.params.id,
          request.usuarioAutenticado!.id,
        );
        return reply.code(200).send(resultado);
      } catch (erro) {
        return enviarErroConhecido(erro, reply);
      }
    },
  );

  api.post(
    "/pedidos/acompanhamento/recuperar",
    {
      preHandler: [app.verificarOrigem],
      schema: {
        description:
          "Rotaciona o token de acompanhamento de um pedido visitante usando número e telefone.",
        tags: ["Pedidos"],
        body: recuperarAcompanhamentoBodySchema,
        response: {
          200: tokenAcompanhamentoSchema,
          400: erroSchema,
          404: erroSchema,
          429: erroSchema,
          500: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        limitarCobranca({
          operacao: "RECUPERACAO_TOKEN",
          identificador: `${request.ip}:${request.body.telefone}`,
          idempotencyKey: `recuperar:${request.body.numero}:${request.body.telefone}`,
        });
        const resultado = await recuperarTokenAcompanhamento(
          app.prisma,
          request.body,
        );
        return reply.code(200).send(resultado);
      } catch (erro) {
        return enviarErroConhecido(erro, reply);
      }
    },
  );
}

function serializarTentativa(tentativa: TentativaPagamento) {
  return {
    id: tentativa.id,
    metodo: tentativa.metodo,
    numeroTentativa: tentativa.numeroTentativa,
    status: tentativa.status,
    valor: tentativa.valor.toFixed(2),
    confirmadaEm: tentativa.confirmadaEm?.toISOString() ?? null,
    expiraEm: tentativa.expiraEm?.toISOString() ?? null,
    encerradoEm: tentativa.encerradoEm?.toISOString() ?? null,
    criadoEm: tentativa.criadoEm.toISOString(),
  };
}

async function pedidoAutorizado(
  app: FastifyInstance,
  pedidoId: string,
  request: import("fastify").FastifyRequest,
) {
  const pedido = await app.prisma.pedido.findUnique({ where: { id: pedidoId } });
  if (!pedido) return null;
  if (request.usuarioAutenticado) {
    return request.usuarioAutenticado.tipo === "CLIENTE" && pedido.usuarioId === request.usuarioAutenticado.id
      ? pedido
      : null;
  }
  if (pedido.usuarioId !== null) return null;
  const tokenRecebido = request.headers["x-pedido-token"];
  if (
    typeof tokenRecebido !== "string" ||
    !pedido.tokenAcompanhamentoHash ||
    pedido.tokenAcompanhamentoRevogadoEm
  ) {
    return null;
  }
  const agora = new Date();
  if (pedido.tokenAcompanhamentoExpiraEm && pedido.tokenAcompanhamentoExpiraEm <= agora) {
    return null;
  }
  if (pedido.status === "CONCLUIDO" || pedido.status === "CANCELADO") {
    const dataLimite =
      pedido.tokenAcompanhamentoExpiraEm ??
      new Date(pedido.atualizadoEm.getTime() + 30 * 24 * 60 * 60 * 1_000);
    if (agora >= dataLimite) {
      return null;
    }
  }
  const hash = createHash("sha256").update(tokenRecebido, "utf8").digest();
  const hashArmazenado = Buffer.from(pedido.tokenAcompanhamentoHash, "hex");
  return hash.length === hashArmazenado.length && timingSafeEqual(hash, hashArmazenado)
    ? pedido
    : null;
}
