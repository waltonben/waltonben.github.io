import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  // GitHub Pages serves this application from benwalton.co.uk/pdf/.
  // Keeping the base path in source prevents production builds from
  // accidentally emitting domain-root /assets URLs.
  base: "/pdf/",
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
})
