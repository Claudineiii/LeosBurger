import { Prisma, PrismaClient, TipoEntrega, MetodoPagamento } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();

const sufixo = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function criarCategoria() {
  return prisma.categoria.create({
    data: {
      nome: `Teste ${sufixo()}`,
      ordem: 99,
    },
  });
}

async function criarItem(categoriaId: string) {
  return prisma.item.create({
    data: {
      categoriaId,
      nome: `Item ${sufixo()}`,
      preco: 20,
    },
  });
}

async function criarCombo() {
  return prisma.combo.create({
    data: {
      nome: `Combo ${sufixo()}`,
      preco: 30,
    },
  });
}

async function criarPedido(dados: Partial<Prisma.PedidoCreateInput> = {}) {
  return prisma.pedido.create({
    data: {
      tipoEntrega: TipoEntrega.RETIRADA,
      nomeClienteHistorico: "Cliente de teste",
      telefoneClienteHistorico: "19999999999",
      subtotal: 20,
      desconto: 0,
      taxaEntrega: 0,
      total: 20,
      metodoPagamento: MetodoPagamento.PIX,
      ...dados,
    },
  });
}

async function criarUsuario() {
  return prisma.usuario.create({
    data: {
      nome: "Usuário de teste",
      email: `teste_${sufixo()}@leosburger.local`,
      telefone: "19999999999",
      senhaHash: "hash-de-teste",
    },
  });
}

describe("Integridade do banco de dados", () => {
  it("rejeita item e combo preenchidos simultaneamente", async () => {
    const categoria = await criarCategoria();
    const item = await criarItem(categoria.id);
    const combo = await criarCombo();
    const pedido = await criarPedido();

    try {
      await expect(
        prisma.itemPedido.create({
          data: {
            pedidoId: pedido.id,
            itemId: item.id,
            comboId: combo.id,
            nomeHistorico: "Registro inválido",
            precoUnitarioHistorico: 30,
            quantidade: 1,
            subtotal: 30,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.pedido.delete({ where: { id: pedido.id } });
      await prisma.combo.delete({ where: { id: combo.id } });
      await prisma.item.delete({ where: { id: item.id } });
      await prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("rejeita item de pedido sem item nem combo", async () => {
    const pedido = await criarPedido();

    try {
      await expect(
        prisma.itemPedido.create({
          data: {
            pedidoId: pedido.id,
            nomeHistorico: "Registro sem referência",
            precoUnitarioHistorico: 20,
            quantidade: 1,
            subtotal: 20,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.pedido.delete({ where: { id: pedido.id } });
    }
  });

  it("rejeita quantidade zero em item de pedido", async () => {
    const categoria = await criarCategoria();
    const item = await criarItem(categoria.id);
    const pedido = await criarPedido();

    try {
      await expect(
        prisma.itemPedido.create({
          data: {
            pedidoId: pedido.id,
            itemId: item.id,
            nomeHistorico: "Quantidade inválida",
            precoUnitarioHistorico: 20,
            quantidade: 0,
            subtotal: 0,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.pedido.delete({ where: { id: pedido.id } });
      await prisma.item.delete({ where: { id: item.id } });
      await prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("rejeita preço unitário histórico negativo", async () => {
    const categoria = await criarCategoria();
    const item = await criarItem(categoria.id);
    const pedido = await criarPedido();

    try {
      await expect(
        prisma.itemPedido.create({
          data: {
            pedidoId: pedido.id,
            itemId: item.id,
            nomeHistorico: "Preço inválido",
            precoUnitarioHistorico: -20,
            quantidade: 1,
            subtotal: 20,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.pedido.delete({ where: { id: pedido.id } });
      await prisma.item.delete({ where: { id: item.id } });
      await prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("rejeita subtotal negativo em item de pedido", async () => {
    const categoria = await criarCategoria();
    const item = await criarItem(categoria.id);
    const pedido = await criarPedido();

    try {
      await expect(
        prisma.itemPedido.create({
          data: {
            pedidoId: pedido.id,
            itemId: item.id,
            nomeHistorico: "Subtotal inválido",
            precoUnitarioHistorico: 20,
            quantidade: 1,
            subtotal: -20,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.pedido.delete({ where: { id: pedido.id } });
      await prisma.item.delete({ where: { id: item.id } });
      await prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("rejeita quantidade zero na composição de combo", async () => {
    const categoria = await criarCategoria();
    const item = await criarItem(categoria.id);
    const combo = await criarCombo();

    try {
      await expect(
        prisma.itemCombo.create({
          data: {
            comboId: combo.id,
            itemId: item.id,
            quantidade: 0,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.combo.delete({ where: { id: combo.id } });
      await prisma.item.delete({ where: { id: item.id } });
      await prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("rejeita preço negativo de item", async () => {
    const categoria = await criarCategoria();

    try {
      await expect(
        prisma.item.create({
          data: {
            categoriaId: categoria.id,
            nome: `Preço negativo ${sufixo()}`,
            preco: -1,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("rejeita preço negativo de combo", async () => {
    await expect(
      prisma.combo.create({
        data: {
          nome: `Combo negativo ${sufixo()}`,
          preco: -1,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejeita coordenadas geográficas fora dos limites", async () => {
    const usuario = await criarUsuario();

    try {
      await expect(
        prisma.endereco.create({
          data: {
            usuarioId: usuario.id,
            cep: "13000000",
            logradouro: "Rua de teste",
            numero: "10",
            bairro: "Centro",
            cidade: "Campinas",
            estado: "SP",
            latitude: -91,
            longitude: -47,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.usuario.delete({ where: { id: usuario.id } });
    }
  });

  it("rejeita pedido com desconto maior que o subtotal", async () => {
    await expect(
      criarPedido({
        subtotal: 10,
        desconto: 11,
        taxaEntrega: 0,
        total: -1,
      }),
    ).rejects.toThrow();
  });

  it("rejeita pedido com total incompatível com os valores", async () => {
    await expect(
      criarPedido({
        subtotal: 20,
        desconto: 5,
        taxaEntrega: 3,
        total: 99,
      }),
    ).rejects.toThrow();
  });

  it("rejeita pedido de entrega sem endereço completo", async () => {
    await expect(
      criarPedido({
        tipoEntrega: TipoEntrega.ENTREGA,
        subtotal: 20,
        desconto: 0,
        taxaEntrega: 7.99,
        total: 27.99,
      }),
    ).rejects.toThrow();
  });

  it("rejeita pedido de retirada com taxa de entrega", async () => {
    await expect(
      criarPedido({
        tipoEntrega: TipoEntrega.RETIRADA,
        subtotal: 20,
        desconto: 0,
        taxaEntrega: 7.99,
        total: 27.99,
      }),
    ).rejects.toThrow();
  });

  it("rejeita histórico de status que não seja um array JSON", async () => {
    await expect(
      criarPedido({
        historicoStatus: "isto não é um array" as Prisma.InputJsonValue,
      }),
    ).rejects.toThrow();
  });

  it("impede excluir item que já foi vendido", async () => {
    const categoria = await criarCategoria();
    const item = await criarItem(categoria.id);
    const pedido = await criarPedido();

    try {
      await prisma.itemPedido.create({
        data: {
          pedidoId: pedido.id,
          itemId: item.id,
          nomeHistorico: item.nome,
          precoUnitarioHistorico: 20,
          quantidade: 1,
          subtotal: 20,
        },
      });

      await expect(prisma.item.delete({ where: { id: item.id } })).rejects.toThrow();
    } finally {
      await prisma.pedido.delete({ where: { id: pedido.id } });
      await prisma.item.delete({ where: { id: item.id } });
      await prisma.categoria.delete({ where: { id: categoria.id } });
    }
  });

  it("impede excluir combo que já foi vendido", async () => {
    const combo = await criarCombo();
    const pedido = await criarPedido();

    try {
      await prisma.itemPedido.create({
        data: {
          pedidoId: pedido.id,
          comboId: combo.id,
          nomeHistorico: combo.nome,
          precoUnitarioHistorico: 30,
          quantidade: 1,
          subtotal: 30,
        },
      });

      await expect(prisma.combo.delete({ where: { id: combo.id } })).rejects.toThrow();
    } finally {
      await prisma.pedido.delete({ where: { id: pedido.id } });
      await prisma.combo.delete({ where: { id: combo.id } });
    }
  });

  it("define usuario_id como nulo ao excluir usuário com pedidos", async () => {
    const usuario = await criarUsuario();

    const pedido = await prisma.pedido.create({
      data: {
        usuarioId: usuario.id,
        tipoEntrega: TipoEntrega.RETIRADA,
        nomeClienteHistorico: usuario.nome,
        telefoneClienteHistorico: usuario.telefone,
        subtotal: 20,
        desconto: 0,
        taxaEntrega: 0,
        total: 20,
        metodoPagamento: MetodoPagamento.PIX,
      },
    });

    try {
      await prisma.usuario.delete({ where: { id: usuario.id } });

      const pedidoAtualizado = await prisma.pedido.findUniqueOrThrow({
        where: { id: pedido.id },
      });

      expect(pedidoAtualizado.usuarioId).toBeNull();
    } finally {
      await prisma.pedido.delete({ where: { id: pedido.id } });
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
