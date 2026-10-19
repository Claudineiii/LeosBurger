import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function validarUrlBancoTeste(valor: string): string {
  let url: URL;

  try {
    url = new URL(valor);
  } catch {
    throw new Error("TEST_DATABASE_URL deve ser uma URL PostgreSQL válida.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL deve usar o protocolo PostgreSQL.");
  }

  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("TEST_DATABASE_URL deve apontar para um servidor local.");
  }

  if (url.pathname !== "/leosburger_test") {
    throw new Error("TEST_DATABASE_URL deve apontar exclusivamente para leosburger_test.");
  }

  return valor;
}

export function carregarAmbienteDeTeste(): string {
  const envTestPath = resolve(projectRoot, ".env.test");
  const envTest = existsSync(envTestPath)
    ? parseEnv(readFileSync(envTestPath, "utf8"))
    : {};
  const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? envTest.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error(
      "Banco de teste não configurado. Defina TEST_DATABASE_URL ou crie .env.test a partir de .env.test.example.",
    );
  }

  const url = validarUrlBancoTeste(testDatabaseUrl);
  process.env.DATABASE_URL = url;
  return url;
}

const executar = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (executar) {
  const [acao, ...argumentos] = process.argv.slice(2);
  const comandos = {
    vitest: resolve(projectRoot, "node_modules", "vitest", "vitest.mjs"),
    migrate: resolve(projectRoot, "node_modules", "prisma", "build", "index.js"),
  };

  if (acao !== "vitest" && acao !== "migrate") {
    throw new Error("Ação inválida. Use 'vitest' ou 'migrate'.");
  }

  const url = carregarAmbienteDeTeste();
  const argumentosComando =
    acao === "migrate" ? ["migrate", "deploy", ...argumentos] : argumentos;
  const resultado = spawnSync(process.execPath, [comandos[acao], ...argumentosComando], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  if (resultado.error) {
    throw resultado.error;
  }

  process.exitCode = resultado.status ?? 1;
}
