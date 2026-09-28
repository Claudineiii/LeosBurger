-- CreateTable
CREATE TABLE "TesteConexao" (
    "id" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TesteConexao_pkey" PRIMARY KEY ("id")
);
