/**
 * The dashboard's build: static files in dist/, served by admin-api under /admin/.
 *
 * `bun run dev` serves it with hot reload and sends /admin/api to a running app
 * (PIKIT_URL, http://localhost:3000 by default: `pikit dev` or the deployed service).
 */

import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  // Every asset a file of its own: the Content-Security-Policy (`font-src 'self'`) refuses a font
  // inlined as a data: URI.
  build: { assetsInlineLimit: 0 },
  server: {
    proxy: { "/admin/api": { target: process.env.PIKIT_URL ?? "http://localhost:3000", changeOrigin: true } },
  },
});
