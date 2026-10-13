import { fileURLToPath } from "node:url";
import { configDefaults } from "vitest/config";

const config = {
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { exclude: [...configDefaults.exclude, ".handoff-backup/**", "handoff/local-source/**"] },
};

export default config;
