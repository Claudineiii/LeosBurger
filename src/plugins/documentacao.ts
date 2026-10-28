import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import ScalarApiReference from "@scalar/fastify-api-reference";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import { COOKIE_SESSAO_NOME } from "./autenticacao.js";

async function documentacaoPlugin(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      info: {
        title: "LEOSBurger API",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          sessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: COOKIE_SESSAO_NOME,
          },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: (documentObject) => {
      if (!("openapiObject" in documentObject)) {
        return documentObject.swaggerObject;
      }

      const { openapiObject } = documentObject;
      const respostaLogout =
        openapiObject.paths?.["/auth/logout"]?.post?.responses["204"];

      if (respostaLogout && "content" in respostaLogout) {
        delete respostaLogout.content;
      }

      return openapiObject;
    },
  });

  await app.register(ScalarApiReference, {
    routePrefix: "/reference",
  });
}

export default fp(documentacaoPlugin);
