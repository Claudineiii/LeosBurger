import {
  MetodoPagamento,
  Prisma,
  StatusReferenciaEndereco,
  TipoEntrega,
  TipoUsuario,
} from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import {
  adicionaisSelecionadosSchema,
  validarSelecaoAdicionais,
} from "./adicionais.js";
import { calcularDescontoCupom } from "./cupons.js";
import { ReferenciaEnderecoService } from "./referencias-endereco.js";
import { calcularFrete } from "./faixas-frete.js";
import { formatarCentavos, paraCentavos } from "./valores-monetarios.js";

const linhaPreviewSchema = z
  .object({
    itemId: z.string().uuid().optional(),
    comboId: z.string().uuid().optional(),
    quantidade: z.number().int().min(1).max(99),
    adicionais: adicionaisSelecionadosSchema.default([]),
  })
  .strict()
  .superRefine((linha, contexto) => {
    if ((linha.itemId === undefined) === (linha.comboId === undefined)) {
      contexto.addIssue({
        code: "custom",
        message: "Informe exatamente um item ou combo.",
      });
    }
    if (linha.comboId && linha.adicionais.length > 0) {
      contexto.addIssue({
        code: "custom",
        path: ["adicionais"],
        message: "Combos não aceitam adicionais.",
      });
    }
  });

export const checkoutPreviewBodySchema = z
  .object({
    tipoEntrega: z.nativeEnum(TipoEntrega),
    metodoPagamento: z.nativeEnum(MetodoPagamento),
    itens: z.array(linhaPreviewSchema).min(1).max(50),
    codigoCupom: z.string().trim().min(1).max(50).optional(),
    referenciaEndereco: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  })
  .strict()
  .superRefine((body, contexto) => {
    if (
      body.tipoEntrega === TipoEntrega.RETIRADA &&
      body.referenciaEndereco !== undefined
    ) {
      contexto.addIssue({
        code: "custom",
        path: ["referenciaEndereco"],
        message: "Retirada não utiliza referência de endereço.",
      });
    }
  });

export type CheckoutPreviewBody = z.infer<typeof checkoutPreviewBodySchema>;

const limiteTotalCentavos = 9_999_999_999n;

function validarLimiteMonetario(valor: bigint): void {
  if (valor < 0n || valor > limiteTotalCentavos) {
    throw new Error("TOTAL_PREVIEW_INVALIDO");
  }
}

function serializarEndereco(
  endereco:
    | {
        cep: string;
        logradouro: string;
        numero: string;
        complemento: string | null;
        bairro: string;
        cidade: string;
        estado: string;
        referencia: string | null;
        situacao: StatusReferenciaEndereco;
      }
    | null,
) {
  if (!endereco) {
    return null;
  }
  return {
    cep: endereco.cep,
    logradouro: endereco.logradouro,
    numero: endereco.numero,
    complemento: endereco.complemento,
    bairro: endereco.bairro,
    cidade: endereco.cidade,
    estado: endereco.estado,
    referencia: endereco.referencia,
    situacao: endereco.situacao,
  };
}

export async function gerarPreviaCheckout(
  request: FastifyRequest,
  dadosRecebidos: unknown,
  opcoes: {
    transacao?: Prisma.TransactionClient;
    usuario?: FastifyRequest["usuarioAutenticado"];
  } = {},
) {
  const dados = checkoutPreviewBodySchema.parse(dadosRecebidos);
  const usuario = opcoes.usuario ?? request.usuarioAutenticado;
  if (!usuario && dados.metodoPagamento !== MetodoPagamento.PIX) {
    throw new Error("PAGAMENTO_VISITANTE_INVALIDO");
  }
  if (usuario?.tipo === TipoUsuario.ADMIN) {
    throw new Error("USUARIO_NAO_AUTORIZADO");
  }
  if (
    usuario &&
    dados.tipoEntrega === TipoEntrega.ENTREGA &&
    dados.referenciaEndereco !== undefined
  ) {
    throw new Error("REFERENCIA_ENDERECO_NAO_PERMITIDA");
  }
  if (
    !usuario &&
    dados.tipoEntrega === TipoEntrega.ENTREGA &&
    dados.referenciaEndereco === undefined
  ) {
    throw new Error("REFERENCIA_ENDERECO_OBRIGATORIA");
  }

  const calcular = async (tx: Prisma.TransactionClient) => {
      const idsItem = [...new Set(
        dados.itens.flatMap((linha) => linha.itemId ? [linha.itemId] : []),
      )];
      const idsCombo = [...new Set(
        dados.itens.flatMap((linha) => linha.comboId ? [linha.comboId] : []),
      )];
      const [itens, combos] = await Promise.all([
        tx.item.findMany({
          where: {
            id: { in: idsItem },
            ativo: true,
          },
          select: {
            id: true,
            nome: true,
            preco: true,
            adicionais: true,
          },
        }),
        tx.combo.findMany({
          where: {
            id: { in: idsCombo },
            ativo: true,
            itensCombo: {
              some: { removidoEm: null },
              every: {
                OR: [
                  { removidoEm: { not: null } },
                  { item: { ativo: true } },
                ],
              },
            },
          },
          select: { id: true, nome: true, preco: true },
        }),
      ]);
      const porIdItem = new Map(itens.map((item) => [item.id, item]));
      const porIdCombo = new Map(combos.map((combo) => [combo.id, combo]));
      if (idsItem.some((id) => !porIdItem.has(id)) || idsCombo.some((id) => !porIdCombo.has(id))) {
        throw new Error("ITEM_INDISPONIVEL");
      }

      let subtotalCentavos = 0n;
      const linhasCupom: Array<{
        tipo: "ITEM" | "COMBO";
        referenciaId: string;
        subtotalCentavos: bigint;
      }> = [];
      const linhas = dados.itens.map((linha) => {
        if (linha.itemId) {
          const item = porIdItem.get(linha.itemId)!;
          let precoUnitarioCentavos = paraCentavos(item.preco);
          const selecionados = validarSelecaoAdicionais(
            item.adicionais,
            linha.adicionais,
          );
          const adicionais = selecionados.map((adicional) => {
            const preco = paraCentavos(adicional.preco);
            precoUnitarioCentavos += preco * BigInt(adicional.quantidade);
            return {
              id: adicional.id,
              nome: adicional.nome,
              preco: formatarCentavos(preco),
              quantidade: adicional.quantidade,
            };
          });
          const subtotalLinha = precoUnitarioCentavos * BigInt(linha.quantidade);
          validarLimiteMonetario(subtotalLinha);
          subtotalCentavos += subtotalLinha;
          linhasCupom.push({
            tipo: "ITEM",
            referenciaId: item.id,
            subtotalCentavos: subtotalLinha,
          });
          return {
            tipo: "ITEM" as const,
            id: item.id,
            nome: item.nome,
            quantidade: linha.quantidade,
            precoUnitario: formatarCentavos(precoUnitarioCentavos),
            subtotal: formatarCentavos(subtotalLinha),
            adicionais,
          };
        }

        const combo = porIdCombo.get(linha.comboId!)!;
        const precoUnitarioCentavos = paraCentavos(combo.preco);
        const subtotalLinha = precoUnitarioCentavos * BigInt(linha.quantidade);
        validarLimiteMonetario(subtotalLinha);
        subtotalCentavos += subtotalLinha;
        linhasCupom.push({
          tipo: "COMBO",
          referenciaId: combo.id,
          subtotalCentavos: subtotalLinha,
        });
        return {
          tipo: "COMBO" as const,
          id: combo.id,
          nome: combo.nome,
          quantidade: linha.quantidade,
          precoUnitario: formatarCentavos(precoUnitarioCentavos),
          subtotal: formatarCentavos(subtotalLinha),
          adicionais: [],
        };
      });
      validarLimiteMonetario(subtotalCentavos);

      const cupom = await calcularDescontoCupom(
        tx,
        dados.codigoCupom,
        linhasCupom,
      );
      const subtotalAposDesconto = subtotalCentavos - cupom.descontoCentavos;
      const endereco = await obterEndereco(tx, request, dados);

      if (dados.tipoEntrega === TipoEntrega.RETIRADA) {
        return {
          tipoEntrega: dados.tipoEntrega,
          metodoPagamento: dados.metodoPagamento,
          itens: linhas,
          subtotal: formatarCentavos(subtotalCentavos),
          cupom: cupom.codigo
            ? {
                codigo: cupom.codigo,
                desconto: formatarCentavos(cupom.descontoCentavos),
                subtotalElegivel: formatarCentavos(cupom.subtotalElegivelCentavos),
              }
            : null,
          frete: "0.00",
          distanciaKm: null,
          situacaoEntrega: "RETIRADA" as const,
          total: formatarCentavos(subtotalAposDesconto),
          endereco: null,
        };
      }

      const coordenadas =
        endereco &&
        endereco.situacao === StatusReferenciaEndereco.CONFIRMADO &&
        endereco.latitude !== null &&
        endereco.longitude !== null
          ? {
              latitude: endereco.latitude,
              longitude: endereco.longitude,
            }
          : null;
      const frete = await calcularFrete(tx, coordenadas);
      if (!coordenadas) {
        return {
          tipoEntrega: dados.tipoEntrega,
          metodoPagamento: dados.metodoPagamento,
          itens: linhas,
          subtotal: formatarCentavos(subtotalCentavos),
          cupom: cupom.codigo
            ? {
                codigo: cupom.codigo,
                desconto: formatarCentavos(cupom.descontoCentavos),
                subtotalElegivel: formatarCentavos(cupom.subtotalElegivelCentavos),
              }
            : null,
          frete: null,
          distanciaKm: null,
          situacaoEntrega: "PENDENTE" as const,
          total: null,
          endereco: serializarEndereco(endereco),
        };
      }

      if (frete.situacao !== "DISPONIVEL") {
        return {
          tipoEntrega: dados.tipoEntrega,
          metodoPagamento: dados.metodoPagamento,
          itens: linhas,
          subtotal: formatarCentavos(subtotalCentavos),
          cupom: cupom.codigo
            ? {
                codigo: cupom.codigo,
                desconto: formatarCentavos(cupom.descontoCentavos),
                subtotalElegivel: formatarCentavos(cupom.subtotalElegivelCentavos),
              }
            : null,
          frete: null,
          distanciaKm: null,
          situacaoEntrega: "INDISPONIVEL" as const,
          total: null,
          endereco: serializarEndereco(endereco),
        };
      }

      const total = subtotalAposDesconto + frete.valor;
      validarLimiteMonetario(total);
      return {
        tipoEntrega: dados.tipoEntrega,
        metodoPagamento: dados.metodoPagamento,
        itens: linhas,
        subtotal: formatarCentavos(subtotalCentavos),
        cupom: cupom.codigo
          ? {
              codigo: cupom.codigo,
              desconto: formatarCentavos(cupom.descontoCentavos),
              subtotalElegivel: formatarCentavos(cupom.subtotalElegivelCentavos),
            }
          : null,
        frete: formatarCentavos(frete.valor),
        distanciaKm: frete.distanciaKm.toFixed(6),
        situacaoEntrega: "DISPONIVEL" as const,
        total: formatarCentavos(total),
        endereco: serializarEndereco(endereco),
      };
  };
  return opcoes.transacao
    ? calcular(opcoes.transacao)
    : request.server.prisma.$transaction(calcular, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
}

async function obterEndereco(
  tx: Prisma.TransactionClient,
  request: FastifyRequest,
  dados: CheckoutPreviewBody,
) {
  if (request.usuarioAutenticado) {
    if (dados.tipoEntrega !== TipoEntrega.ENTREGA) {
      return null;
    }
    const endereco = await tx.endereco.findUnique({
      where: { usuarioId: request.usuarioAutenticado.id },
    });
    if (!endereco) {
      return null;
    }
    const latitude = endereco.latitude?.toNumber() ?? null;
    const longitude = endereco.longitude?.toNumber() ?? null;
    return {
      cep: endereco.cep,
      logradouro: endereco.logradouro,
      numero: endereco.numero,
      complemento: endereco.complemento,
      bairro: endereco.bairro,
      cidade: endereco.cidade,
      estado: endereco.estado,
      referencia: endereco.referencia,
      situacao:
        latitude !== null && longitude !== null
          ? StatusReferenciaEndereco.CONFIRMADO
          : StatusReferenciaEndereco.PENDENTE,
      latitude,
      longitude,
    };
  }

  if (dados.tipoEntrega !== TipoEntrega.ENTREGA || !dados.referenciaEndereco) {
    return null;
  }
  const referencia = await new ReferenciaEnderecoService(tx).buscar(
    dados.referenciaEndereco,
    { limparExpirada: false },
  );
  if (!referencia) {
    throw new Error("REFERENCIA_ENDERECO_INVALIDA");
  }

  return {
    ...referencia,
    complemento: referencia.complemento ?? null,
    referencia: referencia.referencia ?? null,
  };
}
