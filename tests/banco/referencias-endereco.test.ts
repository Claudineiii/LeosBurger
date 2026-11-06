import { PrismaClient, StatusReferenciaEndereco, MotivoPendenciaEndereco } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  hashTokenReferenciaEndereco,
  limparReferenciasECacheExpirados,
  ReferenciaEnderecoService,
} from "../../src/services/referencias-endereco.js";
import type { DadosEnderecoReferencia } from "../../src/services/referencias-endereco.js";

const prisma = new PrismaClient();
const prismaSegundaInstancia = new PrismaClient();

const enderecoConfirmado: DadosEnderecoReferencia = {
  cep: "13010000",
  logradouro: "Rua Referência de Teste",
  numero: "123",
  bairro: "Centro",
  cidade: "Campinas",
  estado: "SP",
  situacao: StatusReferenciaEndereco.CONFIRMADO,
  motivoPendencia: null,
  latitude: -22.9,
  longitude: -47.06,
};

const hashesCriados = new Set<string>();

async function limparReferenciasCriadas() {
  if (hashesCriados.size === 0) {
    return;
  }

  await prisma.referenciaEndereco.deleteMany({
    where: { tokenHash: { in: [...hashesCriados] } },
  });
  hashesCriados.clear();
}

afterAll(async () => {
  await limparReferenciasCriadas();
  await Promise.all([
    prisma.$disconnect(),
    prismaSegundaInstancia.$disconnect(),
  ]);
});

describe("referências temporárias de endereço", () => {
  it("persiste somente o hash e permite consulta por outra instância", async () => {
    const servico = new ReferenciaEnderecoService(prisma);
    const emissao = await servico.emitir(enderecoConfirmado);
    const tokenHash = hashTokenReferenciaEndereco(emissao.token);
    hashesCriados.add(tokenHash);

    const registro = await prisma.referenciaEndereco.findUniqueOrThrow({
      where: { tokenHash },
    });
    const segundaInstancia = new ReferenciaEnderecoService(prismaSegundaInstancia);

    expect(registro.tokenHash).toBe(tokenHash);
    expect(JSON.stringify(registro)).not.toContain(emissao.token);
    expect(registro.expiraEm.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    await expect(segundaInstancia.buscar(emissao.token)).resolves.toEqual(
      enderecoConfirmado,
    );
  });

  it("aceita endereço pendente sem coordenadas e sem frete presumido", async () => {
    const enderecoPendente: DadosEnderecoReferencia = {
      ...enderecoConfirmado,
      situacao: StatusReferenciaEndereco.PENDENTE,
      motivoPendencia: MotivoPendenciaEndereco.AMBIGUO,
      latitude: null,
      longitude: null,
    };
    const servico = new ReferenciaEnderecoService(prisma);
    const emissao = await servico.emitir(enderecoPendente);
    hashesCriados.add(hashTokenReferenciaEndereco(emissao.token));

    await expect(servico.buscar(emissao.token)).resolves.toEqual(
      enderecoPendente,
    );
  });

  it("rejeita coordenadas em uma referência pendente", async () => {
    const servico = new ReferenciaEnderecoService(prisma);

    await expect(
      servico.emitir({
        ...enderecoConfirmado,
        situacao: StatusReferenciaEndereco.PENDENTE,
        motivoPendencia: MotivoPendenciaEndereco.AMBIGUO,
      }),
    ).rejects.toThrow();
  });

  it("recusa e remove referência expirada", async () => {
    let agora = new Date();
    const servico = new ReferenciaEnderecoService(prisma, {
      agora: () => agora,
    });
    const emissao = await servico.emitir(enderecoConfirmado);
    const tokenHash = hashTokenReferenciaEndereco(emissao.token);
    hashesCriados.add(tokenHash);
    agora = new Date(emissao.expiraEm.getTime() + 1);

    await expect(servico.buscar(emissao.token)).resolves.toBeNull();
    await expect(
      prisma.referenciaEndereco.findUnique({ where: { tokenHash } }),
    ).resolves.toBeNull();
  });

  it("remove somente referências e cache vencidos", async () => {
    const criadoEm = new Date(Date.now() - 120_000);
    const expiraEm = new Date(criadoEm.getTime() + 60_000);
    const tokenHash = hashTokenReferenciaEndereco("C".repeat(43));
    hashesCriados.add(tokenHash);
    const chaveHmac = "a".repeat(64);

    await prisma.referenciaEndereco.create({
      data: {
        tokenHash,
        cep: enderecoConfirmado.cep,
        logradouro: enderecoConfirmado.logradouro,
        numero: enderecoConfirmado.numero,
        bairro: enderecoConfirmado.bairro,
        cidade: enderecoConfirmado.cidade,
        estado: enderecoConfirmado.estado,
        situacao: StatusReferenciaEndereco.PENDENTE,
        motivoPendencia: MotivoPendenciaEndereco.SEM_RESULTADO,
        expiraEm,
        criadoEm,
      },
    });
    await prisma.cacheGeoapify.create({
      data: {
        chaveHmac,
        resultado: [],
        expiraEm,
        criadoEm,
      },
    });

    try {
      const removidos = await limparReferenciasECacheExpirados(prisma);

      expect(removidos.referencias).toBeGreaterThanOrEqual(1);
      expect(removidos.cache).toBe(1);
      await expect(
        prisma.referenciaEndereco.findUnique({ where: { tokenHash } }),
      ).resolves.toBeNull();
      await expect(
        prisma.cacheGeoapify.findUnique({ where: { chaveHmac } }),
      ).resolves.toBeNull();
      hashesCriados.delete(tokenHash);
    } finally {
      await prisma.cacheGeoapify.deleteMany({ where: { chaveHmac } });
    }
  });

  it("não consulta o banco para tokens malformados", async () => {
    const servico = new ReferenciaEnderecoService(prisma);

    await expect(servico.buscar("token-inválido")).resolves.toBeNull();
  });
});
