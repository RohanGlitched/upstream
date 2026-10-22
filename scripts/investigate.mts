// Run one investigation end to end and save the case.
//   npx tsx scripts/investigate.mts "Carboplatin is short again. Why, and what do we do?"
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";

loadEnv();
const { investigate } = await import("../src/agent/investigate.ts");
const { openMemory } = await import("../src/engines/hmem.ts");
const { UpstreamWorld } = await import("../src/engines/world-model.ts");

const question = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ") || "Carboplatin is short again. Why, and what do we do?";
const t0 = Date.now();
const memory = openMemory({ persistDir: path.join(ROOT, ".state", "hmem") });
const world = new UpstreamWorld({ storage: "memory" });
const c = await investigate({
  question, memory, world,
  onStep: (s) => console.log(`  ${s.status.padEnd(6)} ${String(s.ms).padStart(6)} ms  ${s.title}: ${s.finding}${s.error ? `  [${s.error.slice(0, 160)}]` : ""}`),
});
const slug = (c.molecule || "case").split(" ")[0];
const dir = path.join(ROOT, "data", "cases");
mkdirSync(dir, { recursive: true });
const graph = world.exportSubgraph(world.query("HospitalItem").map((e) => e.id));
writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ ...c, graph }, null, 1));

console.log(`\n${c.intent.name} (${c.intent.risk}) -> ${c.molecule}`);
for (const s of c.stock) console.log(`  ${s.hospital.padEnd(17)} ${s.ndc11.padEnd(12)} ${String(s.onHand).padStart(6)} on hand  ${String(s.days ?? "-").padStart(5)} days  ${s.labeler ?? ""}`);
for (const pc of c.chain) for (const p of pc.plants) console.log(`  plant  ${pc.labeler.slice(0, 22).padEnd(22)} -> ${p.name.slice(0, 34).padEnd(34)} ${p.fei ?? "-"} ${p.country ?? ""} ${p.health} ${p.signals.length} signals`);
console.log(`  shortage: ${c.shortage.status} since ${c.shortage.firstPosting}; ${c.shortage.companies.length} companies`);
for (const t of c.timeline) console.log(`  ${t.date}  ${String(t.daysBeforePosting ?? "").padStart(5)}  ${t.label.slice(0, 110)}`);
for (const o of c.options.slice(0, 6)) console.log(`  option ${o.rank}: ${o.title}`);
if (c.explanation) {
  console.log(`\n${c.explanation.state.toUpperCase()}: ${c.explanation.headline}`);
  for (const s of c.explanation.sentences) console.log(`  - ${s.text} [${s.cites.join(",")}]`);
  for (const r of c.explanation.verifier.rejected) console.log(`  x rejected: ${r.reason} :: ${r.text.slice(0, 120)}`);
}
console.log(`\n${c.usage.zetarisQueries} Zetaris queries (${c.usage.zetarisMs} ms), ${c.usage.modelCalls} model calls, ${c.usage.tokensIn}+${c.usage.tokensOut} tokens, ${Math.round((Date.now() - t0) / 100) / 10} s; gate ${c.gate.length} checks, ${c.gate.filter((g) => g.decision !== "allowed").length} refused`);
console.log(`saved data/cases/${slug}.json`);
