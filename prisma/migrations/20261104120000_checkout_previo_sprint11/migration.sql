CREATE TYPE "tipo_desconto_cupom" AS ENUM ('FIXO', 'PERCENTUAL');

ALTER TABLE "referencias_endereco"
  ADD COLUMN "complemento" VARCHAR(100),
  ADD COLUMN "referencia" VARCHAR(150);

CREATE TABLE "reservas_cache_geoapify" (
  "chave_hmac" CHAR(64) NOT NULL,
  "token_reserva" CHAR(64) NOT NULL,
  "expira_em" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "reservas_cache_geoapify_pkey" PRIMARY KEY ("chave_hmac")
);
CREATE INDEX "reservas_cache_geoapify_expira_em_idx"
  ON "reservas_cache_geoapify"("expira_em");

CREATE TABLE "cupons" (
  "id" TEXT NOT NULL,
  "codigo" VARCHAR(50) NOT NULL,
  "tipo_desconto" "tipo_desconto_cupom" NOT NULL,
  "valor" DECIMAL(10,2) NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "validade_inicio" DATE NOT NULL,
  "validade_fim" DATE NOT NULL,
  "compra_minima" DECIMAL(10,2),
  "limite_usos" INTEGER,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cupons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cupons_datas_validas_check" CHECK ("validade_inicio" <= "validade_fim"),
  CONSTRAINT "cupons_valor_positivo_check" CHECK ("valor" > 0),
  CONSTRAINT "cupons_percentual_maximo_check" CHECK (
    "tipo_desconto" <> 'PERCENTUAL' OR "valor" <= 30
  ),
  CONSTRAINT "cupons_compra_minima_nao_negativa_check" CHECK (
    "compra_minima" IS NULL OR "compra_minima" >= 0
  ),
  CONSTRAINT "cupons_limite_usos_positivo_check" CHECK (
    "limite_usos" IS NULL OR "limite_usos" > 0
  )
);
CREATE UNIQUE INDEX "cupons_codigo_key" ON "cupons"("codigo");
CREATE INDEX "cupons_ativo_validade_inicio_validade_fim_idx"
  ON "cupons"("ativo", "validade_inicio", "validade_fim");

CREATE TABLE "cupons_itens" (
  "cupom_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  CONSTRAINT "cupons_itens_pkey" PRIMARY KEY ("cupom_id", "item_id"),
  CONSTRAINT "cupons_itens_cupom_id_fkey" FOREIGN KEY ("cupom_id")
    REFERENCES "cupons"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cupons_itens_item_id_fkey" FOREIGN KEY ("item_id")
    REFERENCES "itens"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cupons_itens_item_id_idx" ON "cupons_itens"("item_id");

CREATE TABLE "cupons_combos" (
  "cupom_id" TEXT NOT NULL,
  "combo_id" TEXT NOT NULL,
  CONSTRAINT "cupons_combos_pkey" PRIMARY KEY ("cupom_id", "combo_id"),
  CONSTRAINT "cupons_combos_cupom_id_fkey" FOREIGN KEY ("cupom_id")
    REFERENCES "cupons"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cupons_combos_combo_id_fkey" FOREIGN KEY ("combo_id")
    REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cupons_combos_combo_id_idx" ON "cupons_combos"("combo_id");

CREATE TABLE "cupons_utilizacoes" (
  "id" TEXT NOT NULL,
  "cupom_id" TEXT NOT NULL,
  "pedido_id" TEXT NOT NULL,
  "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cupons_utilizacoes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cupons_utilizacoes_cupom_id_fkey" FOREIGN KEY ("cupom_id")
    REFERENCES "cupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cupons_utilizacoes_pedido_id_fkey" FOREIGN KEY ("pedido_id")
    REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cupons_utilizacoes_pedido_id_key"
  ON "cupons_utilizacoes"("pedido_id");
CREATE INDEX "cupons_utilizacoes_cupom_id_idx"
  ON "cupons_utilizacoes"("cupom_id");

CREATE TABLE "faixas_frete" (
  "id" TEXT NOT NULL,
  "distancia_minima" DECIMAL(5,2) NOT NULL,
  "distancia_maxima" DECIMAL(5,2) NOT NULL,
  "valor" DECIMAL(10,2) NOT NULL,
  "ativa" BOOLEAN NOT NULL DEFAULT true,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "faixas_frete_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "faixas_frete_distancia_valida_check" CHECK (
    "distancia_minima" >= 0 AND
    "distancia_maxima" > "distancia_minima" AND
    "distancia_maxima" <= 6
  ),
  CONSTRAINT "faixas_frete_valor_nao_negativo_check" CHECK ("valor" >= 0)
);
CREATE INDEX "faixas_frete_ativa_distancia_minima_idx"
  ON "faixas_frete"("ativa", "distancia_minima");
