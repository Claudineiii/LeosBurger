import { describe, expect, it, vi } from "vitest";
import {
  ErroGeoapify,
  GeoapifyProvider,
  type EnderecoParaGeocodificacao,
} from "../../../src/providers/geoapify.js";

const endereco: EnderecoParaGeocodificacao = {
  cep: "13010000",
  logradouro: "Rua Exemplo",
  numero: "123",
  bairro: "Centro",
  cidade: "Campinas",
  estado: "SP",
};

function respostaGeoapify(features: unknown[] = []) {
  return {
    type: "FeatureCollection",
    features,
  };
}

function feature(
  longitude = -47.06,
  latitude = -22.9,
  properties: Record<string, unknown> = {},
) {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [longitude, latitude],
    },
    properties,
  };
}

function fetchComJson(payload: unknown, init?: ResponseInit) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      ...init,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("GeoapifyProvider", () => {
  it("consulta somente os componentes de endereço e normaliza os candidatos", async () => {
    const fetchImpl = fetchComJson(
      respostaGeoapify([
        feature(-47.06, -22.9, {
          formatted: "Rua Exemplo 123, Campinas",
          result_type: "building",
          housenumber: "123",
          street: "Rua Exemplo",
          suburb: "Centro",
          postcode: "13010000",
          city: "Campinas",
          state: "São Paulo",
          state_code: "BR-SP",
          country_code: "br",
          rank: { match_type: "full_match", confidence: 0.99 },
          datasource: { raw: { internal: "não deve ser retornado" } },
        }),
      ]),
    );
    const provider = new GeoapifyProvider({
      apiKey: "chave-de-teste",
      fetchImpl,
    });

    const candidatos = await provider.geocodificar(endereco);

    expect(candidatos).toEqual([
      {
        latitude: -22.9,
        longitude: -47.06,
        enderecoFormatado: "Rua Exemplo 123, Campinas",
        tipoResultado: "building",
        tipoCorrespondencia: "full_match",
        confianca: 0.99,
        numero: "123",
        logradouro: "Rua Exemplo",
        bairro: "Centro",
        cep: "13010000",
        cidade: "Campinas",
        estado: "São Paulo",
        codigoEstado: "BR-SP",
        codigoPais: "br",
      },
    ]);

    const requestUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://api.geoapify.com/v1/geocode/search",
    );
    expect(requestUrl.searchParams.get("text")).toBe(
      "Rua Exemplo, 123, 13010000, Centro, Campinas, SP, Brasil",
    );
    expect(requestUrl.searchParams.get("filter")).toBe("countrycode:br");
    expect(requestUrl.searchParams.get("format")).toBe("geojson");
    expect(requestUrl.searchParams.get("limit")).toBe("5");
    expect(requestUrl.searchParams.get("apiKey")).toBe("chave-de-teste");
    expect(requestUrl.search).not.toContain("complemento");
    expect(requestUrl.search).not.toContain("telefone");
  });

  it("retorna todos os candidatos sem escolher resultado ambíguo", async () => {
    const fetchImpl = fetchComJson(
      respostaGeoapify([
        feature(-47.06, -22.9, { result_type: "building" }),
        feature(-47.07, -22.91, { result_type: "street" }),
      ]),
    );
    const provider = new GeoapifyProvider({
      apiKey: "chave-de-teste",
      fetchImpl,
    });

    const candidatos = await provider.geocodificar(endereco);

    expect(candidatos).toHaveLength(2);
    expect(candidatos.map((candidato) => candidato.tipoResultado)).toEqual([
      "building",
      "street",
    ]);
  });

  it("retorna lista vazia quando o provedor não encontra resultado", async () => {
    const provider = new GeoapifyProvider({
      apiKey: "chave-de-teste",
      fetchImpl: fetchComJson(respostaGeoapify()),
    });

    await expect(provider.geocodificar(endereco)).resolves.toEqual([]);
  });

  it("falha com erro sanitizado quando a chave não está configurada", () => {
    expect(() => new GeoapifyProvider({ apiKey: " " })).toThrowError(
      new ErroGeoapify(
        "CONFIGURATION",
        "A chave de API do Geoapify não está configurada.",
      ),
    );
  });

  it("rejeita timeout sem expor endereço ou chave", async () => {
    const provider = new GeoapifyProvider({
      apiKey: "chave-secreta",
      timeoutMs: 1,
      fetchImpl: vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    });

    await expect(provider.geocodificar(endereco)).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "A consulta ao serviço de geocodificação excedeu o tempo limite.",
    });
    await expect(provider.geocodificar(endereco)).rejects.not.toThrow(
      "chave-secreta",
    );
  });

  it("mantém o timeout ativo durante a leitura do corpo", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) => {
        const response = new Response();
        Object.defineProperty(response, "json", {
          value: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            }),
        });
        return response;
      },
    );
    const provider = new GeoapifyProvider({
      apiKey: "chave-de-teste",
      timeoutMs: 1,
      fetchImpl,
    });

    await expect(provider.geocodificar(endereco)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("mapeia falha de rede sem encadear erro que possa conter a URL secreta", async () => {
    const provider = new GeoapifyProvider({
      apiKey: "chave-secreta",
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(
        new Error("Falha ao consultar apiKey=chave-secreta"),
      ),
    });

    await expect(provider.geocodificar(endereco)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "O serviço de geocodificação está indisponível.",
    });
    await expect(provider.geocodificar(endereco)).rejects.not.toThrow(
      "chave-secreta",
    );
  });

  it("mapeia resposta HTTP de indisponibilidade sem expor o corpo do provedor", async () => {
    const provider = new GeoapifyProvider({
      apiKey: "chave-secreta",
      fetchImpl: fetchComJson({ message: "chave-secreta" }, { status: 429 }),
    });

    await expect(provider.geocodificar(endereco)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "O serviço de geocodificação recusou a consulta.",
    });
  });

  it("rejeita JSON e coordenadas inválidos", async () => {
    const respostaInvalida = new GeoapifyProvider({
      apiKey: "chave-de-teste",
      fetchImpl: fetchComJson({ type: "FeatureCollection", features: [{}] }),
    });
    const coordenadasInvalidas = new GeoapifyProvider({
      apiKey: "chave-de-teste",
      fetchImpl: fetchComJson(
        respostaGeoapify([feature(999, -22.9)]),
      ),
    });

    await expect(respostaInvalida.geocodificar(endereco)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(
      coordenadasInvalidas.geocodificar(endereco),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
