import type {
  CandidatoGeocodificado,
  EnderecoParaGeocodificacao,
} from "../../../src/services/contratos-geocodificacao.js";
import { ErroGeocodificacao } from "../../../src/services/geocodificacao.js";
import {
  ValidacaoEnderecoService,
  type GeocodificadorDeEndereco,
} from "../../../src/services/validacao-endereco.js";
import { describe, expect, it, vi } from "vitest";

const endereco: EnderecoParaGeocodificacao = {
  cep: "13010000",
  logradouro: "Rua Exemplo",
  numero: "123",
  bairro: "Centro",
  cidade: "Campinas",
  estado: "SP",
};

const candidato: CandidatoGeocodificado = {
  latitude: -22.9,
  longitude: -47.06,
  tipoResultado: "building",
  tipoCorrespondencia: "full_match",
  numero: "123",
  logradouro: "Rúa Exémplo",
  bairro: "Centro",
  cep: "13010-000",
  cidade: "Campinas",
  codigoEstado: "BR-SP",
  codigoPais: "br",
};

function criarServico(
  candidatos: CandidatoGeocodificado[],
): ValidacaoEnderecoService {
  const geocodificador: GeocodificadorDeEndereco = {
    geocodificar: vi.fn(async () => ({
      candidatos,
      origem: "GEOAPIFY" as const,
    })),
  };
  return new ValidacaoEnderecoService(geocodificador);
}

describe("ValidacaoEnderecoService", () => {
  it("confirma somente candidato único full_match com componentes coincidentes", async () => {
    await expect(criarServico([candidato]).validar(endereco)).resolves.toEqual({
      situacao: "CONFIRMADO",
      motivoPendencia: null,
      latitude: -22.9,
      longitude: -47.06,
    });
  });

  it("mantém pendente quando não há candidatos", async () => {
    await expect(criarServico([]).validar(endereco)).resolves.toMatchObject({
      situacao: "PENDENTE",
      motivoPendencia: "SEM_RESULTADO",
      latitude: null,
      longitude: null,
    });
  });

  it("mantém pendente quando há múltiplos candidatos", async () => {
    await expect(
      criarServico([candidato, candidato]).validar(endereco),
    ).resolves.toMatchObject({
      situacao: "PENDENTE",
      motivoPendencia: "AMBIGUO",
      latitude: null,
      longitude: null,
    });
  });

  it("mantém pendente para correspondência aproximada ou componente diferente", async () => {
    await expect(
      criarServico([{ ...candidato, tipoCorrespondencia: "match_by_street" }])
        .validar(endereco),
    ).resolves.toMatchObject({
      situacao: "PENDENTE",
      motivoPendencia: "AMBIGUO",
    });
    await expect(
      criarServico([{ ...candidato, numero: "124" }]).validar(endereco),
    ).resolves.toMatchObject({
      situacao: "PENDENTE",
      motivoPendencia: "AMBIGUO",
    });
  });

  it("não confirma quando falta componente ou código de país", async () => {
    const { bairro: _bairro, ...semBairro } = candidato;
    const { codigoPais: _codigoPais, ...semCodigoPais } = candidato;

    await expect(
      criarServico([semBairro]).validar(endereco),
    ).resolves.toMatchObject({ situacao: "PENDENTE" });
    await expect(
      criarServico([semCodigoPais]).validar(endereco),
    ).resolves.toMatchObject({ situacao: "PENDENTE" });
  });

  it("classifica falhas do provider e limite diário como pendentes", async () => {
    for (const erro of [
      new ErroGeocodificacao("PROVEDOR_INDISPONIVEL", "timeout"),
      new ErroGeocodificacao("LIMITE_DIARIO", "limite"),
    ]) {
      const geocodificador: GeocodificadorDeEndereco = {
        geocodificar: vi.fn().mockRejectedValue(erro),
      };

      await expect(
        new ValidacaoEnderecoService(geocodificador).validar(endereco),
      ).resolves.toMatchObject({
        situacao: "PENDENTE",
        motivoPendencia: "PROVEDOR_INDISPONIVEL",
      });
    }
  });

  it("propaga falhas do controle compartilhado em vez de emitir sucesso", async () => {
    const geocodificador: GeocodificadorDeEndereco = {
      geocodificar: vi
        .fn()
        .mockRejectedValue(
          new ErroGeocodificacao(
            "CONTROLE_INDISPONIVEL",
            "controle indisponível",
          ),
        ),
    };

    await expect(
      new ValidacaoEnderecoService(geocodificador).validar(endereco),
    ).rejects.toMatchObject({ code: "CONTROLE_INDISPONIVEL" });
  });
});
