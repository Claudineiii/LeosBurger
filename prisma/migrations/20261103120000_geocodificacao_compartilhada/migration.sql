CREATE TYPE "status_referencia_endereco" AS ENUM ('CONFIRMADO', 'PENDENTE');

CREATE TYPE "motivo_pendencia_endereco" AS ENUM (
    'SEM_RESULTADO',
    'AMBIGUO',
    'PROVEDOR_INDISPONIVEL'
);

CREATE TABLE "referencias_endereco" (
    "id" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "cep" VARCHAR(8) NOT NULL,
    "logradouro" VARCHAR(150) NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "bairro" VARCHAR(100) NOT NULL,
    "cidade" VARCHAR(100) NOT NULL,
    "estado" VARCHAR(2) NOT NULL,
    "situacao" "status_referencia_endereco" NOT NULL,
    "motivo_pendencia" "motivo_pendencia_endereco",
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referencias_endereco_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "referencias_endereco_estado_consistente" CHECK (
        (
            "situacao" = 'CONFIRMADO'
            AND "motivo_pendencia" IS NULL
            AND "latitude" IS NOT NULL
            AND "longitude" IS NOT NULL
        )
        OR (
            "situacao" = 'PENDENTE'
            AND "motivo_pendencia" IS NOT NULL
            AND "latitude" IS NULL
            AND "longitude" IS NULL
        )
    ),
    CONSTRAINT "referencias_endereco_coordenadas_validas" CHECK (
        "latitude" IS NULL
        OR (
            "latitude" BETWEEN -90 AND 90
            AND "longitude" BETWEEN -180 AND 180
        )
    ),
    CONSTRAINT "referencias_endereco_expiracao_valida" CHECK (
        "expira_em" > "criado_em"
    )
);

CREATE UNIQUE INDEX "referencias_endereco_token_hash_key"
    ON "referencias_endereco"("token_hash");

CREATE INDEX "referencias_endereco_expira_em_idx"
    ON "referencias_endereco"("expira_em");

CREATE TABLE "cache_geoapify" (
    "id" TEXT NOT NULL,
    "chave_hmac" CHAR(64) NOT NULL,
    "resultado" JSONB NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cache_geoapify_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cache_geoapify_resultado_array" CHECK (
        jsonb_typeof("resultado") = 'array'
    ),
    CONSTRAINT "cache_geoapify_expiracao_valida" CHECK (
        "expira_em" > "criado_em"
    )
);

CREATE UNIQUE INDEX "cache_geoapify_chave_hmac_key"
    ON "cache_geoapify"("chave_hmac");

CREATE INDEX "cache_geoapify_expira_em_idx"
    ON "cache_geoapify"("expira_em");

CREATE TABLE "controle_geoapify" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "dia_utc" DATE NOT NULL,
    "reservas_dia" INTEGER NOT NULL DEFAULT 0,
    "ultima_reserva_em" TIMESTAMPTZ(3),
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "controle_geoapify_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "controle_geoapify_id_unico" CHECK ("id" = 1),
    CONSTRAINT "controle_geoapify_reservas_validas" CHECK (
        "reservas_dia" BETWEEN 0 AND 3000
    )
);

INSERT INTO "controle_geoapify" (
    "id",
    "dia_utc",
    "reservas_dia",
    "atualizado_em"
) VALUES (
    1,
    (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
    0,
    CURRENT_TIMESTAMP
);
