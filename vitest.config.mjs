import { fileURLToPath } from "node:url";

const config = {
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
};

export default config;
