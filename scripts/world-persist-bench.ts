// Measures World Model local persistence before/after Upstream's patch:
// "immediate" (reference behaviour: rewrite the whole file on every event
// and audit line) vs "deferred" (one write per flush). Same workload as the
// research probe: N drugs x (drug + product + relate + fact) writes.
// Writes src/engines/results/world-persist-bench.json. Run: npm run bench:world
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UpstreamWorld, src } from "../src/engines/world-model.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function run(mode: "immediate" | "deferred", n: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `upstream-bench-${mode}-`));
  const w = new UpstreamWorld({ namespace: "bench", storage: "local", directory: dir, persist: mode });
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const at = src("dailymed-spl", "bench", new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString());
    const d = await w.upsert("Drug", `generic:drug-${i}`, { name: `drug ${i}`, source: at });
    const p = await w.upsert("Product", `${String(10000 + i).padStart(5, "0")}-${String(i % 1000).padStart(3, "0")}`, { source: at });
    await w.relate(p.id, "of-drug", d.id, { source: at });
    await w.assertFact(d.id, "shortage-status", i % 9 === 0 ? "current" : "none", { source: src("fda-shortage-db", "bench", at.at) });
  }
  await w.flush();
  const ms = performance.now() - t0;
  const file = path.join(dir, ".world", "bench.json");
  const out = { mode, drugs: n, logicalWrites: n * 4, fileWrites: w.persistWrites(), ms: Math.round(ms), fileKB: Math.round(fs.statSync(file).size / 1024) };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

async function main() {
  const rows = [];
  for (const n of [100, 300]) for (const mode of ["immediate", "deferred"] as const) rows.push(await run(mode, n));
  const out = { at: new Date().toISOString(), machine: `${os.platform()} ${os.release()}, node ${process.version}`, rows };
  fs.mkdirSync(path.join(root, "src/engines/results"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/engines/results/world-persist-bench.json"), JSON.stringify(out, null, 2) + "\n");
  console.table(rows);
}

main();
