import {
  MotivoPendenciaEndereco,
  StatusReferenciaEndereco,
} from "@prisma/client";
import type {
  CandidatoGeocodificado,
  EnderecoParaGeocodificacao,
} from "./contratos-geocodificacao.js";
import { ErroGeocodificacao } from "./geocodificacao.js";

export type ResultadoValidacaoEndereco =
  | {
      situacao: typeof StatusReferenciaEndereco.CONFIRMADO;
      motivoPendencia: null;
      latitude: number;
      longitude: number;
    }
  | {
      situacao: typeof StatusReferenciaEndereco.PENDENTE;
      motivoPendencia: MotivoPendenciaEndereco;
      latitude: null;
      longitude: null;
    };

export interface GeocodificadorDeEndereco {
  geocodificar(
    endereco: EnderecoParaGeocodificacao,
  ): Promise<{ candidatos: CandidatoGeocodificado[] }>;
}

function normalizarComponente(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

function componentesCoincidem(
  endereco: EnderecoParaGeocodificacao,
  candidato: CandidatoGeocodificado,
): boolean {
  const estadoCandidato = candidato.codigoEstado?.replace(/^BR-/i, "");
  const componentes = [
    [endereco.numero, candidato.numero],
    [endereco.logradouro, candidato.logradouro],
    [endereco.bairro, candidato.bairro],
    [endereco.cidade, candidato.cidade],
    [endereco.estado, estadoCandidato],
  ];

  if (
    candidato.cep === undefined ||
    candidato.codigoPais?.toLowerCase() !== "br" ||
    candidato.tipoCorrespondencia !== "full_match" ||
    componentes.some(
      ([informado, retornado]) =>
        retornado === undefined ||
        normalizarComponente(informado ?? "") !==
          normalizarComponente(retornado),
    )
  ) {
    return false;
  }

  return endereco.cep.replace(/\D/g, "") === candidato.cep.replace(/\D/g, "");
}

function enderecoPendente(
  motivoPendencia: MotivoPendenciaEndereco,
): ResultadoValidacaoEndereco {
  return {
    situacao: StatusReferenciaEndereco.PENDENTE,
    motivoPendencia,
    latitude: null,
    longitude: null,
  };
}

export class ValidacaoEnderecoService {
  readonly #geocodificador: GeocodificadorDeEndereco;

  constructor(geocodificador: GeocodificadorDeEndereco) {
    this.#geocodificador = geocodificador;
  }

  async validar(
    endereco: EnderecoParaGeocodificacao,
  ): Promise<ResultadoValidacaoEndereco> {
    let candidatos: CandidatoGeocodificado[];
    try {
      ({ candidatos } = await this.#geocodificador.geocodificar(endereco));
    } catch (erro) {
      if (
        erro instanceof ErroGeocodificacao &&
        (erro.code === "CONFIGURATION" ||
          erro.code === "LIMITE_DIARIO" ||
          erro.code === "PROVEDOR_INDISPONIVEL")
      ) {
        return enderecoPendente(
          MotivoPendenciaEndereco.PROVEDOR_INDISPONIVEL,
        );
      }

      throw erro;
    }

    if (candidatos.length === 0) {
      return enderecoPendente(MotivoPendenciaEndereco.SEM_RESULTADO);
    }

    if (
      candidatos.length !== 1 ||
      !componentesCoincidem(endereco, candidatos[0]!)
    ) {
      return enderecoPendente(MotivoPendenciaEndereco.AMBIGUO);
    }

    const candidato = candidatos[0]!;
    return {
      situacao: StatusReferenciaEndereco.CONFIRMADO,
      motivoPendencia: null,
      latitude: candidato.latitude,
      longitude: candidato.longitude,
    };
  }
}
