import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import { checkoutPreviewBodySchema, gerarPreviaCheckout } from "../services/checkout-preview.js";

const adicionalPreviewSchema = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  preco: z.string(),
  quantidade: z.number().int(),
});
const linhaPreviewResponseSchema = z.object({
  tipo: z.enum(["ITEM", "COMBO"]),
  id: z.string().uuid(),
  nome: z.string(),
  quantidade: z.number().int(),
  precoUnitario: z.string(),
  subtotal: z.string(),
  adicionais: z.array(adicionalPreviewSchema),
});
const enderecoPreviewSchema = z.object({
  cep: z.string(),
  logradouro: z.string(),
  numero: z.string(),
  complemento: z.string().nullable(),
  bairro: z.string(),
  cidade: z.string(),
  estado: z.string(),
  referencia: z.string().nullable(),
  situacao: z.enum(["CONFIRMADO", "PENDENTE"]),
});
const respostaPreviewSchema = z.object({
  tipoEntrega: z.enum(["ENTREGA", "RETIRADA"]),
  metodoPagamento: z.enum(["PIX", "CREDITO", "DEBITO", "DINHEIRO"]),
  itens: z.array(linhaPreviewResponseSchema),
  subtotal: z.string(),
  cupom: z
    .object({
      codigo: z.string(),
      desconto: z.string(),
      subtotalElegivel: z.string(),
    })
    .nullable(),
  frete: z.string().nullable(),
  distanciaKm: z.string().nullable(),
  situacaoEntrega: z.enum([
    "RETIRADA",
    "PENDENTE",
    "INDISPONIVEL",
    "DISPONIVEL",
  ]),
  total: z.string().nullable(),
  endereco: enderecoPreviewSchema.nullable(),
});
const erroSchema = z.object({
  status: z.number(),
  error: z.string(),
  message: z.string(),
});

const mensagensErro: Record<
  string,
  { status: 400 | 403; error: string; message: string }
> = {
  PAGAMENTO_VISITANTE_INVALIDO: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "Visitantes podem selecionar somente PIX.",
  },
  USUARIO_NAO_AUTORIZADO: {
    status: 403,
    error: "FORBIDDEN",
    message: "Acesso não autorizado.",
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
  TOTAL_PREVIEW_INVALIDO: {
    status: 400,
    error: "VALIDATION_ERROR",
    message: "O total do carrinho excede os limites aceitos.",
  },
};

export async function checkoutPreviewRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/checkout/preview",
    {
      preHandler: [app.verificarOrigem, app.autenticarOpcional],
      schema: {
        description:
          "Calcula uma prévia sem criar pedido, cobrança, geocodificação ou consumo de cupom.",
        tags: ["Checkout"],
        body: checkoutPreviewBodySchema,
        response: {
          200: respostaPreviewSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          500: erroSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await gerarPreviaCheckout(request, request.body);
      } catch (erro) {
        if (erro instanceof z.ZodError) {
          return reply.code(400).send({
            status: 400,
            error: "VALIDATION_ERROR",
            message: "Os dados da prévia são inválidos.",
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
    },
  );
}
