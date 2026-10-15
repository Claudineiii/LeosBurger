import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import ScalarApiReference from "@scalar/fastify-api-reference";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";

async function documentacaoPlugin(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      info: {
        title: "LEOSBurger API",
        version: "1.0.0",
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(ScalarApiReference, {
    routePrefix: "/reference",
  });
}

export default fp(documentacaoPlugin);
