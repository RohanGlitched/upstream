// Measures the overnight watch on a synthetic 300-drug formulary with the
// deterministic generator and a stub checker (no Zetaris, no model): chunk
// count, per-chunk prompt size (chars/4, labelled estimated), wall time.
// Writes src/engines/results/watch-measure.json. Run: npm run bench:watch
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FormularyWatch } from "../src/engines/markovian.ts";
import { UpstreamWorld, src } from "../src/engines/world-model.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const world = new UpstreamWorld({ storage: "memory" });
  const drugs = [];
  for (let i = 0; i < 300; i++) {
    const e = await world.upsert("Drug", `generic:drug-${i}`, { name: `drug-${i}`, source: src("zetaris", "loader", "2026-10-01T00:00:00.000Z") });
    drugs.push({ id: e.id, name: `drug-${i}` });
  }
  const r = await new FormularyWatch({
    world,
    checker: async (batch) => batch.map((d, k) => ((k + d.name.length) % 11 === 0 ? { drugId: d.id, status: "flagged" as const, reasons: ["stub signal"] } : { drugId: d.id, status: "ok" as const, reasons: [] })),
  }).run("measure-300", drugs);
  const cont = r.chunks.slice(1).map((c) => c.promptTokens.value);
  const out = {
    at: new Date().toISOString(),
    note: "Synthetic formulary, stub checker, deterministic generator. Tokens are chars/4 (estimated); latencies are wall-clock on this machine. No modeled savings are reported.",
    drugs: r.total,
    status: r.status,
    batchSize: r.batchSize,
    chunks: r.totals.chunks,
    markovianRuns: r.markovianRuns.length,
    flagged: r.flagged.length,
    chunk1PromptTokens: r.chunks[0].promptTokens.value,
    continuationPromptTokens: { min: Math.min(...cont), max: Math.max(...cont) },
    totalPromptTokens: r.totals.promptTokens,
    totalOutputTokens: r.totals.outputTokens,
    tokenLabel: r.totals.tokenLabel,
    wallMs: r.totals.wallMs,
  };
  fs.mkdirSync(path.join(root, "src/engines/results"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/engines/results/watch-measure.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(out);
}

main();
