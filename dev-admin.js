// The admin in development: the app on http://localhost:5190 (Vite) against the Supabase project in
// .env, with /api passed to the admin's Worker under `wrangler dev` on 8787 (its secrets from .dev.vars).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "vite";

mkdirSync("dist/admin", { recursive: true }); // wrangler wants its assets folder to exist
spawn("npx", ["wrangler", "dev", "-c", "wrangler.admin.jsonc", "--port", "8787"], { stdio: "inherit", shell: true });
const server = await createServer({ configFile: "vite.admin.config.js" });
await server.listen();
server.printUrls();
