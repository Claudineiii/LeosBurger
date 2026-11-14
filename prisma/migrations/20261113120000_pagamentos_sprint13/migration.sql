CREATE TYPE "status_tentativa_pagamento" AS ENUM (
  'PENDENTE',
  'PAGO',
  'FALHOU',
  'RECUSADO',
  'EXPIRADO'
);

CREATE TYPE "status_financeiro_pedido" AS ENUM (
  'PENDENTE',
  'PAGO',
  'REEMBOLSO_PENDENTE'
);

ALTER TABLE "pedidos"
  ADD COLUMN "status_financeiro" "status_financeiro_pedido" NOT NULL DEFAULT 'PENDENTE';

CREATE TABLE "tentativas_pagamento" (
  "id" TEXT NOT NULL,
  "pedido_id" TEXT NOT NULL,
  "metodo" "metodo_pagamento" NOT NULL,
  "numero_tentativa" INTEGER NOT NULL,
  "status" "status_tentativa_pagamento" NOT NULL DEFAULT 'PENDENTE',
  "valor" DECIMAL(10, 2) NOT NULL,
  "chave_idempotencia" VARCHAR(160) NOT NULL,
  "identificador_externo" VARCHAR(150),
  "transacao_externa" VARCHAR(150),
  "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmada_em" TIMESTAMPTZ(3),
  "expira_em" TIMESTAMPTZ(3),
  "encerrado_em" TIMESTAMPTZ(3),
  "eventos" JSONB NOT NULL DEFAULT '[]',
  "auditoria" JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "tentativas_pagamento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tentativas_pagamento_numero_valido_check"
    CHECK ("numero_tentativa" IN (1, 2)),
  CONSTRAINT "tentativas_pagamento_valor_nao_negativo_check"
    CHECK ("valor" >= 0),
  CONSTRAINT "tentativas_pagamento_prazo_pix_check"
    CHECK (
      ("metodo" = 'PIX' AND "confirmada_em" IS NOT NULL AND "expira_em" = "confirmada_em" + INTERVAL '5 minutes')
      OR
      ("metodo" = 'PIX' AND "confirmada_em" IS NULL AND "expira_em" IS NULL)
      OR
      ("metodo" <> 'PIX' AND "expira_em" IS NULL)
    )
);

CREATE UNIQUE INDEX "tentativas_pagamento_chave_idempotencia_key"
  ON "tentativas_pagamento"("chave_idempotencia");
CREATE UNIQUE INDEX "tentativas_pagamento_pedido_id_numero_tentativa_key"
  ON "tentativas_pagamento"("pedido_id", "numero_tentativa");
CREATE INDEX "tentativas_pagamento_pedido_id_status_idx"
  ON "tentativas_pagamento"("pedido_id", "status");
CREATE INDEX "tentativas_pagamento_status_expira_em_idx"
  ON "tentativas_pagamento"("status", "expira_em");
CREATE UNIQUE INDEX "tentativas_pagamento_pix_ativo_por_pedido_key"
  ON "tentativas_pagamento"("pedido_id")
  WHERE "metodo" = 'PIX' AND "status" = 'PENDENTE';

ALTER TABLE "tentativas_pagamento"
  ADD CONSTRAINT "tentativas_pagamento_pedido_id_fkey"
  FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
