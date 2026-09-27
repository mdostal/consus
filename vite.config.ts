import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  // base defaults to "/" for local dev; CI sets VITE_BASE_URL=/consus/ for GitHub Pages.
  base: process.env.VITE_BASE_URL ?? "/",
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
  server: {
    // Local-only — standalone dev on this Mac, no tailnet/remote exposure.
    host: "127.0.0.1",
    proxy: {
      "/api": "http://localhost:8722",
    },
  },
});
