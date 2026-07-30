import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
  server: {
    // Bind IPv4 + IPv6 so the dev server is reachable on 127.0.0.1 (not just [::1]),
    // which is required for the tailscale-serve proxy target.
    host: true,
    // Allow the tailnet hostname through vite's host check when proxied via tailscale serve.
    allowedHosts: ["hive.tail9a130d.ts.net", ".ts.net", "localhost"],
    proxy: {
      "/api": "http://localhost:8722",
    },
  },
});
