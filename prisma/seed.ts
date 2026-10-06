import { PrismaClient, TipoUsuario } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminNome = process.env.ADMIN_NOME;
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminTelefone = process.env.ADMIN_TELEFONE;
  const adminSenha = process.env.ADMIN_SENHA;

  if (!adminNome || !adminEmail || !adminTelefone || !adminSenha) {
    throw new Error("Configure ADMIN_NOME, ADMIN_EMAIL, ADMIN_TELEFONE e ADMIN_SENHA no arquivo .env.");
  }

  if (adminSenha.length < 12) {
    throw new Error("ADMIN_SENHA deve ter pelo menos 12 caracteres.");
  }

  const categorias = [
    { nome: "Lanches", ordem: 1 },
    { nome: "Acompanhamentos", ordem: 2 },
    { nome: "Bebidas", ordem: 3 },
    { nome: "Sobremesas", ordem: 4 },
  ];

  for (const categoria of categorias) {
    await prisma.categoria.upsert({
      where: { nome: categoria.nome },
      update: {
        ordem: categoria.ordem,
        ativo: true,
      },
      create: {
        nome: categoria.nome,
        ordem: categoria.ordem,
      },
    });
  }

  const senhaHash = await bcrypt.hash(adminSenha, 10);

  await prisma.usuario.upsert({
    where: { email: adminEmail },
    update: {
      nome: adminNome,
      telefone: adminTelefone,
      tipo: TipoUsuario.ADMIN,
      ativo: true,
    },
    create: {
      nome: adminNome,
      email: adminEmail,
      telefone: adminTelefone,
      senhaHash,
      tipo: TipoUsuario.ADMIN,
      ativo: true,
    },
  });

  console.log("Seed concluído: categorias e administrador verificados.");
}

main()
  .catch((erro: unknown) => {
    console.error("Erro ao executar o seed:", erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
