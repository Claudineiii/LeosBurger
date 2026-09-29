/*
  Warnings:

  - You are about to drop the `TesteConexao` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "tipo_usuario" AS ENUM ('CLIENTE', 'ADMIN');

-- CreateEnum
CREATE TYPE "tipo_entrega" AS ENUM ('ENTREGA', 'RETIRADA');

-- CreateEnum
CREATE TYPE "status_pedido" AS ENUM ('PENDENTE', 'CONFIRMADO', 'PREPARANDO', 'PRONTO', 'SAIU_PARA_ENTREGA', 'CONCLUIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "metodo_pagamento" AS ENUM ('PIX', 'CREDITO', 'DEBITO', 'DINHEIRO');

-- DropTable
DROP TABLE "TesteConexao";

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "telefone" VARCHAR(20) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "tipo" "tipo_usuario" NOT NULL DEFAULT 'CLIENTE',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enderecos" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "cep" VARCHAR(8) NOT NULL,
    "logradouro" VARCHAR(150) NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100) NOT NULL,
    "cidade" VARCHAR(100) NOT NULL,
    "estado" VARCHAR(2) NOT NULL,
    "referencia" VARCHAR(150),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enderecos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "descricao" VARCHAR(255),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens" (
    "id" TEXT NOT NULL,
    "categoria_id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "descricao" VARCHAR(500),
    "preco" DECIMAL(10,2) NOT NULL,
    "imagem_url" VARCHAR(500),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "adicionais" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combos" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "descricao" VARCHAR(500),
    "preco" DECIMAL(10,2) NOT NULL,
    "imagem_url" VARCHAR(500),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "combos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_combo" (
    "id" TEXT NOT NULL,
    "combo_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "itens_combo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "usuario_id" TEXT,
    "tipo_entrega" "tipo_entrega" NOT NULL,
    "status" "status_pedido" NOT NULL DEFAULT 'PENDENTE',
    "nome_cliente_historico" VARCHAR(100) NOT NULL,
    "telefone_cliente_historico" VARCHAR(20) NOT NULL,
    "cep_historico" VARCHAR(8),
    "logradouro_historico" VARCHAR(150),
    "numero_historico" VARCHAR(20),
    "complemento_historico" VARCHAR(100),
    "bairro_historico" VARCHAR(100),
    "cidade_historico" VARCHAR(100),
    "estado_historico" VARCHAR(2),
    "referencia_historico" VARCHAR(150),
    "distancia_km" DECIMAL(6,2),
    "subtotal" DECIMAL(10,2) NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxa_entrega" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "metodo_pagamento" "metodo_pagamento" NOT NULL,
    "codigo_cupom" VARCHAR(50),
    "observacao" VARCHAR(500),
    "historico_status" JSONB NOT NULL DEFAULT '[]',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_pedido" (
    "id" TEXT NOT NULL,
    "pedido_id" TEXT NOT NULL,
    "item_id" TEXT,
    "combo_id" TEXT,
    "nome_historico" VARCHAR(100) NOT NULL,
    "preco_unitario_historico" DECIMAL(10,2) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "observacao" VARCHAR(500),
    "adicionais" JSONB,
    "composicao_historica" JSONB,

    CONSTRAINT "itens_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "enderecos_usuario_id_key" ON "enderecos"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_nome_key" ON "categorias"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "itens_categoria_id_nome_key" ON "itens"("categoria_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "combos_nome_key" ON "combos"("nome");

-- CreateIndex
CREATE INDEX "itens_combo_item_id_idx" ON "itens_combo"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "itens_combo_combo_id_item_id_key" ON "itens_combo"("combo_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_numero_key" ON "pedidos"("numero");

-- CreateIndex
CREATE INDEX "pedidos_usuario_id_idx" ON "pedidos"("usuario_id");

-- CreateIndex
CREATE INDEX "pedidos_status_idx" ON "pedidos"("status");

-- CreateIndex
CREATE INDEX "pedidos_criado_em_idx" ON "pedidos"("criado_em");

-- CreateIndex
CREATE INDEX "itens_pedido_pedido_id_idx" ON "itens_pedido"("pedido_id");

-- CreateIndex
CREATE INDEX "itens_pedido_item_id_idx" ON "itens_pedido"("item_id");

-- CreateIndex
CREATE INDEX "itens_pedido_combo_id_idx" ON "itens_pedido"("combo_id");

-- AddForeignKey
ALTER TABLE "enderecos" ADD CONSTRAINT "enderecos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens" ADD CONSTRAINT "itens_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_combo" ADD CONSTRAINT "itens_combo_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_combo" ADD CONSTRAINT "itens_combo_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_pedido" ADD CONSTRAINT "itens_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_pedido" ADD CONSTRAINT "itens_pedido_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_pedido" ADD CONSTRAINT "itens_pedido_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- 1. Cada item do pedido deve ser um item individual OU um combo.
ALTER TABLE itens_pedido
ADD CONSTRAINT itens_pedido_item_xor_combo
CHECK (
  (item_id IS NOT NULL) <> (combo_id IS NOT NULL)
);

-- 2. A quantidade deve ser positiva.
ALTER TABLE itens_pedido
ADD CONSTRAINT itens_pedido_quantidade_positiva
CHECK (quantidade > 0);

-- 3. Valores históricos não podem ser negativos.
ALTER TABLE itens_pedido
ADD CONSTRAINT itens_pedido_valores_validos
CHECK (
  preco_unitario_historico >= 0
  AND subtotal >= 0
);

-- 4. A quantidade de itens dentro de um combo deve ser positiva.
ALTER TABLE itens_combo
ADD CONSTRAINT itens_combo_quantidade_positiva
CHECK (quantidade > 0);

-- 5. Preço de item não pode ser negativo.
ALTER TABLE itens
ADD CONSTRAINT itens_preco_nao_negativo
CHECK (preco >= 0);

-- 6. Preço de combo não pode ser negativo.
ALTER TABLE combos
ADD CONSTRAINT combos_preco_nao_negativo
CHECK (preco >= 0);

-- 7. Latitude e longitude devem estar ambas preenchidas
-- ou ambas nulas, respeitando os limites geográficos.
ALTER TABLE enderecos
ADD CONSTRAINT enderecos_coordenadas_validas
CHECK (
  (
    latitude IS NULL
    AND longitude IS NULL
  )
  OR
  (
    latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND latitude BETWEEN -90 AND 90
    AND longitude BETWEEN -180 AND 180
  )
);

-- 8. Valores financeiros e total do pedido.
ALTER TABLE pedidos
ADD CONSTRAINT pedidos_valores_validos
CHECK (
  subtotal >= 0
  AND desconto >= 0
  AND taxa_entrega >= 0
  AND desconto <= subtotal
  AND total = subtotal - desconto + taxa_entrega
);

-- 9. Pedido de entrega exige endereço histórico completo
-- e distância não negativa.
ALTER TABLE pedidos
ADD CONSTRAINT pedidos_entrega_completa
CHECK (
  tipo_entrega = 'RETIRADA'
  OR (
    cep_historico IS NOT NULL
    AND logradouro_historico IS NOT NULL
    AND numero_historico IS NOT NULL
    AND bairro_historico IS NOT NULL
    AND cidade_historico IS NOT NULL
    AND estado_historico IS NOT NULL
    AND distancia_km IS NOT NULL
    AND distancia_km >= 0
  )
);

-- 10. Retirada não pode ter taxa de entrega.
ALTER TABLE pedidos
ADD CONSTRAINT pedidos_retirada_sem_taxa
CHECK (
  tipo_entrega = 'ENTREGA'
  OR taxa_entrega = 0
);

-- 11. O histórico de status deve ser um array JSON.
ALTER TABLE pedidos
ADD CONSTRAINT pedidos_historico_e_lista
CHECK (
  jsonb_typeof(historico_status) = 'array'
);