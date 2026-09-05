import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Port 5173 (Vite default) is often proxied by Docker Desktop on this
    // machine, blocking bind. 5183 dodges that.
    port: 5183,
    strictPort: true,
    proxy: {
      "/api": {
        // Backend port is configurable via VITE_API_PORT; default 8010
        // because we discovered port 8000 is often taken on this machine
        // by an unrelated Python service.
        target: `http://localhost:${process.env.VITE_API_PORT ?? "8010"}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
