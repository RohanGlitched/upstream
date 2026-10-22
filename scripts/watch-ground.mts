// Run the grounding check over a saved watch run (data/watch/latest.json) without re-running the watch:
// the brief and headlines are checked against the saved rows, failing sentences dropped, failing headlines
// replaced by the rule-written line, and the result (with briefCheck) written back.
//   npx tsx scripts/watch-ground.mts [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mts";
const { groundWatch } = await import("../src/agent/ground.ts");
type Flag = { molecule: string; state: string; systemDays: number | null; minDays: number | null; hospital: string | null; signal: string; headline: string };
const file = path.join(ROOT, "data", "watch", "latest.json");
const w = JSON.parse(readFileSync(file, "utf8")) as { asOf: string; drugs: number; quiet: number; brief: string; flagged: Flag[]; briefCheck?: unknown };
const rule = (f: Flag) => `${f.signal}${f.minDays !== null ? `; ${f.minDays} days at ${f.hospital}` : ""}.`;
const r = groundWatch(w, rule);
console.log(`${r.grounding.checked} sentences, ${r.grounding.tokens} dates/numbers checked; ${r.grounding.dropped.length} dropped`);
for (const d of r.grounding.dropped) console.log(`  ${d.reason}\n    ${d.text}`);
if (!process.argv.includes("--dry")) {
  writeFileSync(file, JSON.stringify({ ...w, brief: r.brief || `${w.flagged.length} of ${w.drugs} formulary drugs need attention this morning.`, briefCheck: r.grounding, flagged: r.flagged }, null, 1));
  console.log("written", path.relative(ROOT, file));
}
