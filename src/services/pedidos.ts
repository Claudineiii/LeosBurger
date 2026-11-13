import { createHash, randomBytes } from "node:crypto";
import {
  MetodoPagamento,
  Prisma,
  StatusPedido,
  TipoEntrega,
  TipoUsuario,
} from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { validarSelecaoAdicionais } from "./adicionais.js";
import { checkoutPreviewBodySchema, gerarPreviaCheckout } from "./checkout-preview.js";
import { calcularFrete } from "./faixas-frete.js";
import { registrarUtilizacaoCupom } from "./cupons.js";
import { ReferenciaEnderecoService } from "./referencias-endereco.js";
import { formatarCentavos } from "./valores-monetarios.js";

export const pedidoBodySchema = checkoutPreviewBodySchema.safeExtend({
  nomeCliente: z.string().trim().min(1).max(100).optional(),
  telefoneCliente: z.string().trim().min(8).max(20).optional(),
});

export const idempotencyKeySchema = z
  .string()
  .uuid()
  .refine((valor) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      valor,
    ),
  );

export const recuperarAcompanhamentoBodySchema = z
  .object({
    numero: z.number().int().positive(),
    telefone: z.string().trim().min(8).max(20),
  })
  .strict();

const hashSha256 = (valor: string) =>
  createHash("sha256").update(valor, "utf8").digest("hex");

const adicionaisHistoricosSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      nome: z.string(),
      preco: z.string(),
      quantidade: z.number().int(),
    }),
  )
  .nullable();

const composicaoHistoricaSchema = z
  .array(
    z.object({
      itemId: z.string().uuid(),
      nome: z.string(),
      precoUnitario: z.string(),
      quantidade: z.number().int(),
    }),
  )
  .nullable();

function telefoneNormalizado(valor: string) {
  return valor.replace(/\D/g, "");
}

function canonicalizar(valor: unknown): string {
  if (Array.isArray(valor)) {
    return `[${valor.map(canonicalizar).join(",")}]`;
  }
  if (valor && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    return `{${Object.keys(objeto)
      .sort()
      .map((chave) => `${JSON.stringify(chave)}:${canonicalizar(objeto[chave])}`)
      .join(",")}}`;
  }
  return JSON.stringify(valor);
}

function tokenAcompanhamento() {
  return randomBytes(32).toString("base64url");
}

function prepararResposta(pedido: {
  id: string;
  numero: number;
  status: StatusPedido;
  tipoEntrega: TipoEntrega;
  metodoPagamento: MetodoPagamento;
  subtotal: Prisma.Decimal;
  desconto: Prisma.Decimal;
  taxaEntrega: Prisma.Decimal;
  total: Prisma.Decimal;
  codigoCupom: string | null;
  distanciaKm: Prisma.Decimal | null;
  faixaFreteIdHistorico: string | null;
  faixaFreteDistanciaMinimaHistorica: Prisma.Decimal | null;
  faixaFreteDistanciaMaximaHistorica: Prisma.Decimal | null;
  cepHistorico: string | null;
  logradouroHistorico: string | null;
  numeroHistorico: string | null;
  complementoHistorico: string | null;
  bairroHistorico: string | null;
  cidadeHistorico: string | null;
  estadoHistorico: string | null;
  referenciaHistorico: string | null;
  criadoEm: Date;
  itensPedido: Array<{
    id: string;
    itemId: string | null;
    comboId: string | null;
    nomeHistorico: string;
    precoUnitarioHistorico: Prisma.Decimal;
    quantidade: number;
    subtotal: Prisma.Decimal;
    adicionais: Prisma.JsonValue;
    composicaoHistorica: Prisma.JsonValue;
  }>;
}) {
  let faixaFrete = null;
  if (pedido.faixaFreteIdHistorico !== null) {
    if (
      pedido.faixaFreteDistanciaMinimaHistorica === null ||
      pedido.faixaFreteDistanciaMaximaHistorica === null
    ) {
      throw new Error("SNAPSHOT_FAIXA_FRETE_INVALIDO");
    }
    faixaFrete = {
      id: pedido.faixaFreteIdHistorico,
      distanciaMinima: pedido.faixaFreteDistanciaMinimaHistorica.toFixed(2),
      distanciaMaxima: pedido.faixaFreteDistanciaMaximaHistorica.toFixed(2),
    };
  }
  return {
    id: pedido.id,
    numero: pedido.numero,
    status: pedido.status,
    tipoEntrega: pedido.tipoEntrega,
    metodoPagamento: pedido.metodoPagamento,
    subtotal: pedido.subtotal.toFixed(2),
    desconto: pedido.desconto.toFixed(2),
    taxaEntrega: pedido.taxaEntrega.toFixed(2),
    total: pedido.total.toFixed(2),
    codigoCupom: pedido.codigoCupom,
    distanciaKm: pedido.distanciaKm?.toFixed(2) ?? null,
    faixaFrete,
    endereco:
      pedido.tipoEntrega === TipoEntrega.RETIRADA
        ? null
        : {
            cep: pedido.cepHistorico,
            logradouro: pedido.logradouroHistorico,
            numero: pedido.numeroHistorico,
            complemento: pedido.complementoHistorico,
            bairro: pedido.bairroHistorico,
            cidade: pedido.cidadeHistorico,
            estado: pedido.estadoHistorico,
            referencia: pedido.referenciaHistorico,
          },
    itens: pedido.itensPedido.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      comboId: item.comboId,
      nome: item.nomeHistorico,
      precoUnitario: item.precoUnitarioHistorico.toFixed(2),
      quantidade: item.quantidade,
      subtotal: item.subtotal.toFixed(2),
      adicionais: adicionaisHistoricosSchema.parse(item.adicionais),
      composicao: composicaoHistoricaSchema.parse(item.composicaoHistorica),
    })),
    criadoEm: pedido.criadoEm.toISOString(),
  };
}

async function consultarPedidoComLinhas(
  prisma: Prisma.TransactionClient | FastifyRequest["server"]["prisma"],
  id: string,
) {
  return prisma.pedido.findUniqueOrThrow({
    where: { id },
    include: { itensPedido: { orderBy: { id: "asc" } } },
  });
}

export async function criarPedido(
  request: FastifyRequest,
  chaveRecebida: unknown,
  corpoRecebido: unknown,
) {
  const idempotencyKey = idempotencyKeySchema.parse(chaveRecebida);
  const dados = pedidoBodySchema.parse(corpoRecebido);
  const usuarioRecebido = request.usuarioAutenticado;

  if (usuarioRecebido?.tipo === TipoUsuario.ADMIN) {
    throw new Error("USUARIO_NAO_AUTORIZADO");
  }
  if (usuarioRecebido) {
    if (dados.nomeCliente !== undefined || dados.telefoneCliente !== undefined) {
      throw new Error("DADOS_CLIENTE_NAO_PERMITIDOS");
    }
  } else if (dados.nomeCliente === undefined || dados.telefoneCliente === undefined) {
    throw new Error("DADOS_CLIENTE_OBRIGATORIOS");
  }
  if (!usuarioRecebido && dados.metodoPagamento !== MetodoPagamento.PIX) {
    throw new Error("PAGAMENTO_VISITANTE_INVALIDO");
  }

  const dadosCheckoutRecebidos = { ...dados };
  delete dadosCheckoutRecebidos.nomeCliente;
  delete dadosCheckoutRecebidos.telefoneCliente;
  const dadosCheckout = checkoutPreviewBodySchema.parse(dadosCheckoutRecebidos);
  const telefoneVisitante = dados.telefoneCliente
    ? telefoneNormalizado(dados.telefoneCliente)
    : null;
  if (telefoneVisitante !== null && telefoneVisitante.length < 8) {
    throw new Error("DADOS_CLIENTE_OBRIGATORIOS");
  }
  const payloadHash = hashSha256(canonicalizar(dados));
  const escopoHash = hashSha256(
    usuarioRecebido
      ? `cliente:${usuarioRecebido.id}`
      : `visitante:${telefoneVisitante}`,
  );

  const obterRespostaExistente = async () => {
    const existente = await request.server.prisma.pedido.findUnique({
      where: { idempotencyKey },
      include: { itensPedido: { orderBy: { id: "asc" } } },
    });
    if (!existente) {
      return null;
    }
    if (
      existente.idempotencyPayloadHash !== payloadHash ||
      existente.idempotencyScopeHash !== escopoHash
    ) {
      throw new Error("IDEMPOTENCIA_CONFLITO");
    }
    return {
      pedido: prepararResposta(existente),
      tokenAcompanhamento: null,
      repetido: true,
    };
  };

  const encontrado = await obterRespostaExistente();
  if (encontrado) {
    return encontrado;
  }

  const executar = async () =>
    request.server.prisma.$transaction(
      async (tx) => {
        let usuario = usuarioRecebido;
        if (usuarioRecebido) {
          const atual = await tx.usuario.findFirst({
            where: { id: usuarioRecebido.id, ativo: true },
            select: { id: true, nome: true, telefone: true, email: true, tipo: true },
          });
          if (!atual || atual.tipo !== TipoUsuario.CLIENTE) {
            throw new Error("USUARIO_NAO_AUTORIZADO");
          }
          usuario = atual;
        }

        const previa = await gerarPreviaCheckout(request, dadosCheckout, {
          transacao: tx,
          usuario,
        });
        if (
          dados.tipoEntrega === TipoEntrega.ENTREGA &&
          previa.situacaoEntrega !== "DISPONIVEL"
        ) {
          throw new Error("ENTREGA_INDISPONIVEL");
        }

        const idsItem = [...new Set(
          dados.itens.flatMap((linha) => linha.itemId ? [linha.itemId] : []),
        )];
        const idsCombo = [...new Set(
          dados.itens.flatMap((linha) => linha.comboId ? [linha.comboId] : []),
        )];
        const [itens, combos] = await Promise.all([
          tx.item.findMany({
            where: { id: { in: idsItem }, ativo: true },
            select: { id: true, nome: true, preco: true, adicionais: true },
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
            select: {
              id: true,
              nome: true,
              preco: true,
              itensCombo: {
                where: { removidoEm: null },
                select: {
                  itemId: true,
                  quantidade: true,
                  item: { select: { nome: true, preco: true } },
                },
                orderBy: { itemId: "asc" },
              },
            },
          }),
        ]);
        const porIdItem = new Map(itens.map((item) => [item.id, item]));
        const porIdCombo = new Map(combos.map((combo) => [combo.id, combo]));
        if (
          idsItem.some((id) => !porIdItem.has(id)) ||
          idsCombo.some((id) => !porIdCombo.has(id))
        ) {
          throw new Error("ITEM_INDISPONIVEL");
        }

        const linhasPedido: Prisma.ItemPedidoCreateWithoutPedidoInput[] =
          dados.itens.map((linha, indice) => {
            const calculada = previa.itens[indice]!;
            if (linha.itemId) {
              const item = porIdItem.get(linha.itemId)!;
              const adicionais = validarSelecaoAdicionais(
                item.adicionais,
                linha.adicionais,
              ).map((adicional) => ({
                id: adicional.id,
                nome: adicional.nome,
                preco: adicional.preco.toFixed(2),
                quantidade: adicional.quantidade,
              }));
              return {
                item: { connect: { id: item.id } },
                nomeHistorico: item.nome,
                precoUnitarioHistorico: item.preco,
                quantidade: linha.quantidade,
                subtotal: new Prisma.Decimal(calculada.subtotal),
                adicionais: adicionais as Prisma.InputJsonArray,
              };
            }

            const combo = porIdCombo.get(linha.comboId!)!;
            const composicao = combo.itensCombo.map((componente) => ({
              itemId: componente.itemId,
              nome: componente.item.nome,
              precoUnitario: componente.item.preco.toFixed(2),
              quantidade: componente.quantidade,
            }));
            return {
              combo: { connect: { id: combo.id } },
              nomeHistorico: combo.nome,
              precoUnitarioHistorico: combo.preco,
              quantidade: linha.quantidade,
              subtotal: new Prisma.Decimal(calculada.subtotal),
              adicionais: Prisma.JsonNull,
              composicaoHistorica: composicao as Prisma.InputJsonArray,
            };
          });

        const cupomHistorico = previa.cupom
          ? await tx.cupom.findUnique({
              where: { codigo: previa.cupom.codigo },
              include: {
                itensElegiveis: { select: { itemId: true } },
                combosElegiveis: { select: { comboId: true } },
              },
            })
          : null;
        if (previa.cupom && !cupomHistorico) {
          throw new Error("CUPOM_INVALIDO");
        }

        const endereco = previa.endereco;
        let faixaFrete: {
          id: string;
          distanciaMinima: number;
          distanciaMaxima: number;
        } | null = null;
        if (dados.tipoEntrega === TipoEntrega.ENTREGA) {
          let coordenadas: { latitude: number; longitude: number } | null = null;
          if (usuario) {
            const enderecoSalvo = await tx.endereco.findUnique({
              where: { usuarioId: usuario.id },
              select: { latitude: true, longitude: true },
            });
            if (enderecoSalvo?.latitude && enderecoSalvo.longitude) {
              coordenadas = {
                latitude: enderecoSalvo.latitude.toNumber(),
                longitude: enderecoSalvo.longitude.toNumber(),
              };
            }
          } else {
            const referencia = await new ReferenciaEnderecoService(tx).buscar(
              dadosCheckout.referenciaEndereco!,
              { limparExpirada: false },
            );
            if (
              referencia?.situacao === "CONFIRMADO" &&
              referencia.latitude !== null &&
              referencia.longitude !== null
            ) {
              coordenadas = {
                latitude: referencia.latitude,
                longitude: referencia.longitude,
              };
            }
          }
          if (!coordenadas) {
            throw new Error("ENTREGA_INDISPONIVEL");
          }
          const resultadoFrete = await calcularFrete(tx, {
            latitude: coordenadas.latitude,
            longitude: coordenadas.longitude,
          });
          if (resultadoFrete.situacao !== "DISPONIVEL") {
            throw new Error("ENTREGA_INDISPONIVEL");
          }
          faixaFrete = resultadoFrete.faixa;
          if (formatarCentavos(resultadoFrete.valor) !== previa.frete) {
            throw new Error("CHECKOUT_ALTERADO");
          }
        }

        const telefoneCliente = usuario?.telefone ?? dados.telefoneCliente!;
        const nomeCliente = usuario?.nome ?? dados.nomeCliente!;
        const token = usuario ? null : tokenAcompanhamento();
        const agora = new Date();
        const pedido = await tx.pedido.create({
          data: {
            ...(usuario ? { usuario: { connect: { id: usuario.id } } } : {}),
            tipoEntrega: dados.tipoEntrega,
            status: StatusPedido.PENDENTE,
            idempotencyKey,
            idempotencyPayloadHash: payloadHash,
            idempotencyScopeHash: escopoHash,
            tokenAcompanhamentoHash: token ? hashSha256(token) : null,
            nomeClienteHistorico: nomeCliente,
            telefoneClienteHistorico: telefoneCliente,
            ...(endereco
              ? {
                  cepHistorico: endereco.cep,
                  logradouroHistorico: endereco.logradouro,
                  numeroHistorico: endereco.numero,
                  complementoHistorico: endereco.complemento,
                  bairroHistorico: endereco.bairro,
                  cidadeHistorico: endereco.cidade,
                  estadoHistorico: endereco.estado,
                  referenciaHistorico: endereco.referencia,
                }
              : {}),
            distanciaKm:
              previa.distanciaKm === null
                ? null
                : new Prisma.Decimal(Number(previa.distanciaKm).toFixed(2)),
            faixaFreteIdHistorico: faixaFrete?.id ?? null,
            faixaFreteDistanciaMinimaHistorica: faixaFrete
              ? new Prisma.Decimal(faixaFrete.distanciaMinima.toFixed(2))
              : null,
            faixaFreteDistanciaMaximaHistorica: faixaFrete
              ? new Prisma.Decimal(faixaFrete.distanciaMaxima.toFixed(2))
              : null,
            subtotal: new Prisma.Decimal(previa.subtotal),
            desconto: new Prisma.Decimal(previa.cupom?.desconto ?? "0.00"),
            taxaEntrega: new Prisma.Decimal(previa.frete ?? "0.00"),
            total: new Prisma.Decimal(previa.total!),
            metodoPagamento: dados.metodoPagamento,
            codigoCupom: previa.cupom?.codigo ?? null,
            cupomHistorico: cupomHistorico
              ? ({
                  id: cupomHistorico.id,
                  codigo: cupomHistorico.codigo,
                  tipoDesconto: cupomHistorico.tipoDesconto,
                  valor: cupomHistorico.valor.toFixed(2),
                  compraMinima: cupomHistorico.compraMinima?.toFixed(2) ?? null,
                  validadeInicio: cupomHistorico.validadeInicio.toISOString().slice(0, 10),
                  validadeFim: cupomHistorico.validadeFim.toISOString().slice(0, 10),
                  limiteUsos: cupomHistorico.limiteUsos,
                  itensElegiveis: cupomHistorico.itensElegiveis.map(({ itemId }) => itemId).sort(),
                  combosElegiveis: cupomHistorico.combosElegiveis.map(({ comboId }) => comboId).sort(),
                } satisfies Prisma.InputJsonObject)
              : Prisma.JsonNull,
            historicoStatus: [
              {
                status: StatusPedido.PENDENTE,
                alteradoEm: agora.toISOString(),
                motivo: "PEDIDO_CRIADO",
              },
            ],
            itensPedido: { create: linhasPedido },
          },
        });

        if (cupomHistorico) {
          await registrarUtilizacaoCupom(tx, cupomHistorico.id, pedido.id);
        }

        return {
          pedido: prepararResposta(await consultarPedidoComLinhas(tx, pedido.id)),
          tokenAcompanhamento: token,
          repetido: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    try {
      return await executar();
    } catch (erro) {
      const codigo = erro instanceof Prisma.PrismaClientKnownRequestError
        ? erro.code
        : null;
      if (codigo === "P2034" && tentativa < 2) {
        continue;
      }
      if (codigo === "P2002") {
        const repetido = await obterRespostaExistente();
        if (repetido) {
          return repetido;
        }
      }
      throw erro;
    }
  }
  throw new Error("TRANSACAO_PEDIDO_NAO_CONCLUIDA");
}

export async function recuperarTokenAcompanhamento(
  prisma: FastifyRequest["server"]["prisma"],
  dadosRecebidos: unknown,
) {
  const dados = recuperarAcompanhamentoBodySchema.parse(dadosRecebidos);
  return prisma.$transaction(async (tx) => {
    const localizado = await tx.pedido.findFirst({
      where: { numero: dados.numero, usuarioId: null },
      select: { id: true },
    });
    if (!localizado) {
      throw new Error("ACOMPANHAMENTO_NAO_ENCONTRADO");
    }

    await tx.$queryRaw`SELECT "id" FROM "pedidos" WHERE "id" = ${localizado.id} FOR UPDATE`;
    const pedido = await tx.pedido.findUnique({
      where: { id: localizado.id },
    });
    if (
      !pedido ||
      telefoneNormalizado(pedido.telefoneClienteHistorico) !==
        telefoneNormalizado(dados.telefone)
    ) {
      throw new Error("ACOMPANHAMENTO_NAO_ENCONTRADO");
    }

    const agora = new Date();
    const encerrado =
      pedido.status === StatusPedido.CONCLUIDO ||
      pedido.status === StatusPedido.CANCELADO;
    if (
      encerrado
        ? !pedido.tokenAcompanhamentoExpiraEm ||
          pedido.tokenAcompanhamentoExpiraEm <= agora
        : pedido.status !== StatusPedido.PENDENTE &&
          pedido.status !== StatusPedido.CONFIRMADO &&
          pedido.status !== StatusPedido.PREPARANDO &&
          pedido.status !== StatusPedido.PRONTO &&
          pedido.status !== StatusPedido.SAIU_PARA_ENTREGA
    ) {
      throw new Error("ACOMPANHAMENTO_NAO_ENCONTRADO");
    }

    const token = tokenAcompanhamento();
    await tx.pedido.update({
      where: { id: pedido.id },
      data: {
        tokenAcompanhamentoHash: hashSha256(token),
        tokenAcompanhamentoRevogadoEm: null,
      },
    });
    return { tokenAcompanhamento: token };
  });
}
