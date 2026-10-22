// Load local env files for scripts (values never printed): .env.local, infra/hospital/.env, ../keys/nvidia.env.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");

export function loadEnv(): void {
  for (const f of [path.join(ROOT, ".env.local"), path.join(ROOT, "infra", "hospital", ".env"), path.join(ROOT, "..", "keys", "nvidia.env")]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
    }
  }
}
