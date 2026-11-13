ALTER TABLE "pedidos"
  ADD COLUMN "idempotency_key" UUID,
  ADD COLUMN "idempotency_payload_hash" CHAR(64),
  ADD COLUMN "idempotency_scope_hash" CHAR(64),
  ADD COLUMN "token_acompanhamento_hash" CHAR(64),
  ADD COLUMN "token_acompanhamento_revogado_em" TIMESTAMPTZ(3),
  ADD COLUMN "token_acompanhamento_expira_em" TIMESTAMPTZ(3),
  ADD COLUMN "faixa_frete_id_historico" VARCHAR(36),
  ADD COLUMN "faixa_frete_distancia_minima_historica" DECIMAL(5, 2),
  ADD COLUMN "faixa_frete_distancia_maxima_historica" DECIMAL(5, 2),
  ADD COLUMN "cupom_historico" JSONB;

CREATE UNIQUE INDEX "pedidos_idempotency_key_key"
  ON "pedidos"("idempotency_key");

ALTER TABLE "pedidos"
  ADD CONSTRAINT "pedidos_idempotencia_completa_check"
  CHECK (
    ("idempotency_key" IS NULL AND "idempotency_payload_hash" IS NULL AND "idempotency_scope_hash" IS NULL)
    OR
    ("idempotency_key" IS NOT NULL AND "idempotency_payload_hash" IS NOT NULL AND "idempotency_scope_hash" IS NOT NULL)
  ),
  ADD CONSTRAINT "pedidos_snapshot_faixa_frete_completo_check"
  CHECK (
    ("faixa_frete_id_historico" IS NULL AND "faixa_frete_distancia_minima_historica" IS NULL AND "faixa_frete_distancia_maxima_historica" IS NULL)
    OR
    ("faixa_frete_id_historico" IS NOT NULL AND "faixa_frete_distancia_minima_historica" IS NOT NULL AND "faixa_frete_distancia_maxima_historica" IS NOT NULL AND "faixa_frete_distancia_maxima_historica" > "faixa_frete_distancia_minima_historica")
  ),
  ADD CONSTRAINT "pedidos_token_acompanhamento_visitante_check"
  CHECK ("token_acompanhamento_hash" IS NULL OR "usuario_id" IS NULL);
