import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ command }) => ({
  // The production build is served from waltonben.github.io/pdf/.
  // Development stays rooted at / so the local preview URL is unchanged.
  base: command === "build" ? "/pdf/" : "/",
  plugins: [react()],
  optimizeDeps: {
    // MuPDF's Emscripten loader resolves its WASM binary relative to the JS
    // module. Vite prebundling moves the JS without copying that binary.
    exclude: ["mupdf"],
  },
  server: {
    // The embedded verification browser does not expose Vite's HMR socket.
    // Full reloads keep local development deterministic across environments.
    hmr: false,
  },
  worker: {
    format: "es",
  },
}))
