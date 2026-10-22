// Run the overnight watch over the whole formulary and save data/watch/latest.json.
//   npx tsx scripts/watch.mts
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";
loadEnv();
const { runWatch } = await import("../src/agent/watch.ts");
const knownCases = readdirSync(path.join(ROOT, "data", "cases")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
const w = await runWatch({ knownCases, log: (s) => console.log(s) });
mkdirSync(path.join(ROOT, "data", "watch"), { recursive: true });
writeFileSync(path.join(ROOT, "data", "watch", "latest.json"), JSON.stringify(w, null, 1));
console.log(`\n${w.brief}\n`);
for (const f of w.flagged.slice(0, 25)) console.log(`  ${f.state.padEnd(5)} ${f.molecule.slice(0, 34).padEnd(34)} ${String(f.minDays ?? "-").padStart(6)} d  ${f.signal.slice(0, 80)}`);
console.log(`\n${w.drugs} drugs, ${w.chunks} chunks, ${w.queries} Zetaris queries, ${w.ms} ms, tokens measured ${w.tokens.measured} / estimated ${w.tokens.estimated}; ${w.flagged.length} flagged, ${w.quiet} quiet`);
