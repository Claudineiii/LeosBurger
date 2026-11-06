import {
  MotivoPendenciaEndereco,
  StatusReferenciaEndereco,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { ErroGeoapify, GeoapifyProvider } from "../providers/geoapify.js";
import type { EnderecoParaGeocodificacao } from "./contratos-geocodificacao.js";
import { ErroGeocodificacao, GeocodificacaoService } from "./geocodificacao.js";
import {
  ValidacaoEnderecoService,
  type ResultadoValidacaoEndereco,
} from "./validacao-endereco.js";

export async function validarEnderecoComGeoapify(
  prisma: PrismaClient,
  endereco: EnderecoParaGeocodificacao,
): Promise<ResultadoValidacaoEndereco> {
  try {
    const provider = new GeoapifyProvider();
    const geocodificacao = new GeocodificacaoService(prisma, provider);
    return await new ValidacaoEnderecoService(geocodificacao).validar(endereco);
  } catch (erro) {
    if (
      erro instanceof ErroGeoapify &&
      erro.code === "CONFIGURATION"
    ) {
      return {
        situacao: StatusReferenciaEndereco.PENDENTE,
        motivoPendencia: MotivoPendenciaEndereco.PROVEDOR_INDISPONIVEL,
        latitude: null,
        longitude: null,
      };
    }

    if (
      erro instanceof ErroGeocodificacao &&
      erro.code === "CONFIGURATION"
    ) {
      return {
        situacao: StatusReferenciaEndereco.PENDENTE,
        motivoPendencia: MotivoPendenciaEndereco.PROVEDOR_INDISPONIVEL,
        latitude: null,
        longitude: null,
      };
    }

    throw erro;
  }
}
