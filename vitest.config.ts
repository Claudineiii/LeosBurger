import { defineConfig } from "vitest/config";
import { carregarAmbienteDeTeste } from "./scripts/test-database.js";

carregarAmbienteDeTeste();

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
});
