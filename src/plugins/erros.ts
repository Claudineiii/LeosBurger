import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "@fastify/type-provider-zod";

function obterStatusCode(erro: unknown): number | undefined {
  if (
    typeof erro === "object" &&
    erro !== null &&
    "statusCode" in erro &&
    typeof erro.statusCode === "number" &&
    erro.statusCode >= 400 &&
    erro.statusCode < 600
  ) {
    return erro.statusCode;
  }

  return undefined;
}

async function errosPlugin(app: FastifyInstance) {
  app.setErrorHandler((erro, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(erro)) {
      return reply.code(400).send({
        status: 400,
        error: "VALIDATION_ERROR",
        message: "Os dados da requisição são inválidos.",
        details: erro.validation.map(({ instancePath, message }) => ({
          field: instancePath || "/",
          message,
        })),
      });
    }

    const statusCode = isResponseSerializationError(erro) ? 500 : (obterStatusCode(erro) ?? 500);

    if (statusCode >= 500 || isResponseSerializationError(erro)) {
      request.log.error({ err: erro }, "Erro inesperado ao processar requisição");
      return reply.code(500).send({
        status: 500,
        error: "INTERNAL_SERVER_ERROR",
        message: "Ocorreu um erro interno no servidor.",
      });
    }

    const respostasPorStatus: Record<number, { error: string; message: string }> = {
      400: { error: "BAD_REQUEST", message: "A requisição é inválida." },
      401: { error: "UNAUTHORIZED", message: "Autenticação necessária." },
      403: { error: "FORBIDDEN", message: "Acesso não autorizado." },
      404: { error: "NOT_FOUND", message: "Recurso não encontrado." },
      409: {
        error: "CONFLICT",
        message: "A requisição conflita com o estado atual do recurso.",
      },
    };
    const resposta = respostasPorStatus[statusCode] ?? {
      error: "REQUEST_ERROR",
      message: "Não foi possível processar a requisição.",
    };

    return reply.code(statusCode).send({
      status: statusCode,
      ...resposta,
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({
      status: 404,
      error: "NOT_FOUND",
      message: "Recurso não encontrado.",
    });
  });
}

export default fp(errosPlugin);
