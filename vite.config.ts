import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import dts from "vite-plugin-dts";
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), dts({ include: ["lib"] })],
  build: {
    lib: {
      entry: {
        main: resolve(__dirname, "lib/mthread/index.ts"),
        worker: resolve(__dirname, "lib/wthread/index.ts"),
        utils: resolve(__dirname, "lib/utils.ts"),
      },
      formats: ["es"],
    },
    copyPublicDir: false,
    rollupOptions: {
      external: ["react", "react/jsx-runtime"],
    },
  },
});
