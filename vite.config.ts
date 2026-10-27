import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    target: "chrome85",
    cssTarget: "chrome85",
    modulePreload: false,
    sourcemap: false,
  },
  server: { port: 8765, strictPort: true },
  preview: { port: 8765, strictPort: true },
});
