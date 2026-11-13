import { z } from "zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import {
  criarPedido,
  idempotencyKeySchema,
  pedidoBodySchema,
  recuperarAcompanhamentoBodySchema,
  recuperarTokenAcompanhamento,
} from "../services/pedidos.js";

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
  tokenAcompanhamento: z.string().length(43).nullable(),
  repetido: z.boolean(),
});

const tokenAcompanhamentoSchema = z.object({
  tokenAcompanhamento: z.string().length(43),
});

const mensagensErro: Record<
  string,
  { status: 400 | 403 | 404 | 409; error: string; message: string }
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

  api.post(
    "/pedidos",
    {
      preHandler: [app.verificarOrigem, app.autenticarOpcional],
      schema: {
        description:
          "Cria pedido e snapshots históricos em transação. Não inicia cobrança.",
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
        );
        return reply.code(resultado.repetido ? 200 : 201).send(resultado);
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
          500: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
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
