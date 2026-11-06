import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import { ReferenciaEnderecoService } from "../services/referencias-endereco.js";
import { validarEnderecoComGeoapify } from "../services/validacao-endereco-geoapify.js";

const enderecoVisitanteSchema = z
  .object({
    cep: z
      .string()
      .trim()
      .regex(/^\d{5}-?\d{3}$/)
      .transform((cep) => cep.replace("-", "")),
    logradouro: z.string().trim().min(1).max(150),
    numero: z.string().trim().min(1).max(20),
    complemento: z.string().trim().max(100).nullable().optional(),
    bairro: z.string().trim().min(1).max(100),
    cidade: z.string().trim().min(1).max(100),
    estado: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    referencia: z.string().trim().max(150).nullable().optional(),
  })
  .strict();

const validarEnderecoResponseSchema = z.object({
  referenciaEndereco: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  situacao: z.enum(["CONFIRMADO", "PENDENTE"]),
  expiraEm: z.string().datetime(),
});

const erroResponseSchema = z.object({
  status: z.number(),
  error: z.string(),
  message: z.string(),
  details: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional(),
});

export async function checkoutEnderecoVisitanteRoutes(
  app: FastifyInstance,
) {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    "/checkout/endereco-visitante/validar",
    {
      preHandler: [app.verificarOrigem],
      schema: {
        description:
          "Valida previamente o endereço de entrega de um visitante e emite uma referência temporária.",
        tags: ["Checkout", "Endereços"],
        body: enderecoVisitanteSchema,
        response: {
          201: validarEnderecoResponseSchema,
          400: erroResponseSchema,
          403: erroResponseSchema,
          500: erroResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const resultado = await validarEnderecoComGeoapify(app.prisma, {
        cep: request.body.cep,
        logradouro: request.body.logradouro,
        numero: request.body.numero,
        bairro: request.body.bairro,
        cidade: request.body.cidade,
        estado: request.body.estado,
      });
      const referencia = await new ReferenciaEnderecoService(
        app.prisma,
      ).emitir({
        ...request.body,
        ...resultado,
      });

      return reply.code(201).send({
        referenciaEndereco: referencia.token,
        situacao: resultado.situacao,
        expiraEm: referencia.expiraEm.toISOString(),
      });
    },
  );
}
