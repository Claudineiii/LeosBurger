ALTER TYPE "status_financeiro_pedido" ADD VALUE 'REEMBOLSADO';

CREATE TYPE "metodo_reembolso" AS ENUM ('PIX', 'DINHEIRO', 'CREDITO', 'DEBITO');
CREATE TYPE "status_reembolso" AS ENUM ('PENDENTE', 'CONFIRMADO');

CREATE TABLE "reembolsos" (
  "id" TEXT NOT NULL,
  "pedido_id" TEXT NOT NULL,
  "tentativa_pagamento_id" TEXT,
  "metodo" "metodo_reembolso" NOT NULL,
  "status" "status_reembolso" NOT NULL DEFAULT 'PENDENTE',
  "valor" DECIMAL(10,2) NOT NULL,
  "valor_confirmado" DECIMAL(10,2),
  "motivo" VARCHAR(500) NOT NULL,
  "chave_idempotencia" VARCHAR(100) NOT NULL,
  "chave_confirmacao" VARCHAR(100),
  "identificador_transacao_original" VARCHAR(150),
  "identificador_externo" VARCHAR(150),
  "iniciado_por_admin_id" TEXT NOT NULL,
  "iniciado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmado_por_admin_id" TEXT,
  "confirmado_em" TIMESTAMPTZ(3),
  "auditoria" JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "reembolsos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reembolsos_valor_positivo_check" CHECK ("valor" > 0),
  CONSTRAINT "reembolsos_valor_confirmado_positivo_check"
    CHECK ("valor_confirmado" IS NULL OR "valor_confirmado" > 0),
  CONSTRAINT "reembolsos_estado_confirmacao_check"
    CHECK (
      ("status" = 'PENDENTE' AND "confirmado_em" IS NULL AND "confirmado_por_admin_id" IS NULL AND "valor_confirmado" IS NULL)
      OR
      ("status" = 'CONFIRMADO' AND "confirmado_em" IS NOT NULL AND "confirmado_por_admin_id" IS NOT NULL AND "valor_confirmado" IS NOT NULL)
    ),
  CONSTRAINT "reembolsos_confirmado_nao_supera_solicitado_check"
    CHECK ("valor_confirmado" IS NULL OR "valor_confirmado" <= "valor"),
  CONSTRAINT "reembolsos_pix_exige_tentativa_check"
    CHECK ("metodo" <> 'PIX' OR "tentativa_pagamento_id" IS NOT NULL)
);

CREATE UNIQUE INDEX "reembolsos_chave_idempotencia_key"
  ON "reembolsos"("chave_idempotencia");
CREATE UNIQUE INDEX "reembolsos_chave_confirmacao_key"
  ON "reembolsos"("chave_confirmacao");
CREATE UNIQUE INDEX "reembolsos_tentativa_pendente_key"
  ON "reembolsos"("tentativa_pagamento_id")
  WHERE "status" = 'PENDENTE' AND "tentativa_pagamento_id" IS NOT NULL;
CREATE INDEX "reembolsos_pedido_id_iniciado_em_idx"
  ON "reembolsos"("pedido_id", "iniciado_em");
CREATE INDEX "reembolsos_tentativa_pagamento_id_status_idx"
  ON "reembolsos"("tentativa_pagamento_id", "status");
CREATE INDEX "reembolsos_status_iniciado_em_idx"
  ON "reembolsos"("status", "iniciado_em");

ALTER TABLE "reembolsos"
  ADD CONSTRAINT "reembolsos_pedido_id_fkey"
  FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reembolsos"
  ADD CONSTRAINT "reembolsos_tentativa_pagamento_id_fkey"
  FOREIGN KEY ("tentativa_pagamento_id") REFERENCES "tentativas_pagamento"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reembolsos"
  ADD CONSTRAINT "reembolsos_iniciado_por_admin_id_fkey"
  FOREIGN KEY ("iniciado_por_admin_id") REFERENCES "usuarios"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reembolsos"
  ADD CONSTRAINT "reembolsos_confirmado_por_admin_id_fkey"
  FOREIGN KEY ("confirmado_por_admin_id") REFERENCES "usuarios"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
