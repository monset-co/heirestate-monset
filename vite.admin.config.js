// The admin app (admin/), built to dist/admin for wrangler.admin.jsonc. It talks to Supabase
// directly; VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY come from .env at the project root.
// In development /api goes to the admin's Worker under `wrangler dev` (npm run dev:admin runs both).
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Emits /sw.js with this build's files to keep: a new build is a new cache (admin/sw.js)
const serviceWorker = {
  name: "heir-admin-sw",
  apply: "build",
  generateBundle(_, bundle) {
    const assets = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/logo.svg", "/loader.svg", ...Object.keys(bundle).map((f) => `/${f}`)];
    const version = Date.now().toString(36);
    const source = readFileSync("admin/sw.js", "utf8").replace("__VERSION__", version).replace("__ASSETS__", JSON.stringify([...new Set(assets)]));
    this.emitFile({ type: "asset", fileName: "sw.js", source });
  },
};

export default defineConfig({
  root: "admin",
  envDir: "..",
  plugins: [react(), tailwindcss(), serviceWorker],
  build: { outDir: "../dist/admin", emptyOutDir: true },
  server: { port: 5190, strictPort: true, proxy: { "/api": "http://localhost:8787" } },
});
