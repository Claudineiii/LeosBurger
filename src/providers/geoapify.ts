import { z } from "zod";
import type {
  CandidatoGeocodificado,
  EnderecoParaGeocodificacao,
  Geocodificador,
} from "../services/contratos-geocodificacao.js";
export type {
  CandidatoGeocodificado,
  EnderecoParaGeocodificacao,
  Geocodificador,
} from "../services/contratos-geocodificacao.js";

const endpointGeoapify = "https://api.geoapify.com/v1/geocode/search";
const timeoutPadraoMs = 5_000;

const featureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.array(z.number().finite()).min(2),
      }),
      properties: z.record(z.string(), z.unknown()),
    }),
  ),
});

export type CodigoErroGeoapify =
  | "CONFIGURATION"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE";

export class ErroGeoapify extends Error {
  constructor(
    readonly code: CodigoErroGeoapify,
    message: string,
  ) {
    super(message);
    this.name = "ErroGeoapify";
  }
}

export type GeoapifyProviderOptions = {
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function registro(valor: unknown): Record<string, unknown> | undefined {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : undefined;
}

function textoOpcional(
  propriedades: Record<string, unknown>,
  chave: string,
): string | undefined {
  const valor = propriedades[chave];
  return typeof valor === "string" && valor.trim() !== ""
    ? valor.trim()
    : undefined;
}

function mapearCandidato(
  feature: z.infer<typeof featureCollectionSchema>["features"][number],
): CandidatoGeocodificado {
  const [longitude, latitude] = feature.geometry.coordinates;
  if (
    longitude === undefined ||
    latitude === undefined ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new ErroGeoapify(
      "INVALID_RESPONSE",
      "Geoapify retornou coordenadas inválidas.",
    );
  }

  const propriedades = feature.properties;
  const rank = registro(propriedades.rank);
  const confianca = rank?.confidence;
  if (
    confianca !== undefined &&
    (typeof confianca !== "number" ||
      !Number.isFinite(confianca) ||
      confianca < 0 ||
      confianca > 1)
  ) {
    throw new ErroGeoapify(
      "INVALID_RESPONSE",
      "Geoapify retornou metadados de confiança inválidos.",
    );
  }

  const tipoCorrespondencia = rank?.match_type;
  if (
    tipoCorrespondencia !== undefined &&
    typeof tipoCorrespondencia !== "string"
  ) {
    throw new ErroGeoapify(
      "INVALID_RESPONSE",
      "Geoapify retornou metadados de correspondência inválidos.",
    );
  }

  const enderecoFormatado = textoOpcional(propriedades, "formatted");
  const tipoResultado = textoOpcional(propriedades, "result_type");
  const numero = textoOpcional(propriedades, "housenumber");
  const logradouro = textoOpcional(propriedades, "street");
  const bairro = textoOpcional(propriedades, "suburb");
  const cep = textoOpcional(propriedades, "postcode");
  const cidade = textoOpcional(propriedades, "city");
  const estado = textoOpcional(propriedades, "state");
  const codigoEstado = textoOpcional(propriedades, "state_code");
  const codigoPais = textoOpcional(propriedades, "country_code");

  return {
    latitude,
    longitude,
    ...(enderecoFormatado !== undefined ? { enderecoFormatado } : {}),
    ...(tipoResultado !== undefined ? { tipoResultado } : {}),
    ...(typeof tipoCorrespondencia === "string"
      ? { tipoCorrespondencia }
      : {}),
    ...(typeof confianca === "number" ? { confianca } : {}),
    ...(numero !== undefined ? { numero } : {}),
    ...(logradouro !== undefined ? { logradouro } : {}),
    ...(bairro !== undefined ? { bairro } : {}),
    ...(cep !== undefined ? { cep } : {}),
    ...(cidade !== undefined ? { cidade } : {}),
    ...(estado !== undefined ? { estado } : {}),
    ...(codigoEstado !== undefined ? { codigoEstado } : {}),
    ...(codigoPais !== undefined ? { codigoPais } : {}),
  };
}

export class GeoapifyProvider implements Geocodificador {
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #fetchImpl: typeof fetch;

  constructor(options: GeoapifyProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GEOAPIFY_API_KEY;
    if (!apiKey?.trim()) {
      throw new ErroGeoapify(
        "CONFIGURATION",
        "A chave de API do Geoapify não está configurada.",
      );
    }

    const timeoutMs = options.timeoutMs ?? timeoutPadraoMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new ErroGeoapify(
        "CONFIGURATION",
        "O timeout do Geoapify deve ser um inteiro positivo.",
      );
    }

    this.#apiKey = apiKey.trim();
    this.#timeoutMs = timeoutMs;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async geocodificar(
    endereco: EnderecoParaGeocodificacao,
  ): Promise<CandidatoGeocodificado[]> {
    const url = new URL(endpointGeoapify);
    url.searchParams.set(
      "text",
      [
        endereco.logradouro,
        endereco.numero,
        endereco.cep,
        endereco.bairro,
        endereco.cidade,
        endereco.estado,
        "Brasil",
      ].join(", "),
    );
    url.searchParams.set("filter", "countrycode:br");
    url.searchParams.set("format", "geojson");
    url.searchParams.set("limit", "5");
    url.searchParams.set("apiKey", this.#apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.#fetchImpl(url, { signal: controller.signal });
      } catch {
        if (controller.signal.aborted) {
          throw new ErroGeoapify(
            "TIMEOUT",
            "A consulta ao serviço de geocodificação excedeu o tempo limite.",
          );
        }

        throw new ErroGeoapify(
          "UNAVAILABLE",
          "O serviço de geocodificação está indisponível.",
        );
      }

      if (!response.ok) {
        throw new ErroGeoapify(
          "UNAVAILABLE",
          "O serviço de geocodificação recusou a consulta.",
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (controller.signal.aborted) {
          throw new ErroGeoapify(
            "TIMEOUT",
            "A consulta ao serviço de geocodificação excedeu o tempo limite.",
          );
        }

        throw new ErroGeoapify(
          "INVALID_RESPONSE",
          "O serviço de geocodificação retornou uma resposta inválida.",
        );
      }

      const resultado = featureCollectionSchema.safeParse(payload);
      if (!resultado.success) {
        throw new ErroGeoapify(
          "INVALID_RESPONSE",
          "O serviço de geocodificação retornou uma resposta inválida.",
        );
      }

      return resultado.data.features.map(mapearCandidato);
    } finally {
      clearTimeout(timer);
    }
  }
}
