import { defineConfig } from "vitest/config";
import { randomBytes } from "node:crypto";
import { carregarAmbienteDeTeste } from "./scripts/test-database.js";

carregarAmbienteDeTeste();
process.env.JWT_SECRET = randomBytes(32).toString("base64url");
process.env.FRONTEND_ORIGIN = "http://localhost:5173";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
});
