import { fileURLToPath } from "node:url";
import { configDefaults } from "vitest/config";

const config = {
  test: { exclude: [...configDefaults.exclude, "workers/flow-browser/**", ".runtime/**"] },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
};

export default config;
