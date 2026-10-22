// Investigate every drug on Corvale's formulary (one live run per base molecule) and save each case, so the
// hosted copy can answer any formulary drug with a real recorded investigation.
//   npx tsx scripts/investigate-all.mts [--skip-existing] [--limit N]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";
loadEnv();
process.env.ZETARIS_MEMO_DQ = "1";
const { query } = await import("../src/lib/zetaris.ts");
const { investigate } = await import("../src/agent/investigate.ts");
const { USL } = await import("../src/agent/sql.ts");
const { baseMolecule } = await import("../src/agent/watch.ts");
const { openMemory } = await import("../src/engines/hmem.ts");
const { UpstreamWorld } = await import("../src/engines/world-model.ts");

const roster = await query(`SELECT DISTINCT lower(p.generic_name) AS molecule
FROM (SELECT ndc11 FROM ${USL}.stock_general UNION SELECT ndc11 FROM ${USL}.stock_east UNION SELECT ndc11 FROM ${USL}.stock_lakeside) s
JOIN ${USL}.product p ON p.ndc11 = s.ndc11`, { limit: 5000 });
const groups = new Map<string, string[]>();
for (const r of roster.rows) {
  const m = String(r.molecule);
  const b = baseMolecule(m);
  groups.set(b, [...(groups.get(b) ?? []), m]);
}
const names = [...groups.keys()].filter((b) => /^[a-z][a-z -]{2,}/.test(b)).sort();
const formulary = [...new Set([...names, ...[...groups.values()].flat()])];
const limit = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;
const skip = process.argv.includes("--skip-existing");
const dir = path.join(ROOT, "data", "cases");
mkdirSync(dir, { recursive: true });
const memory = openMemory({ persistDir: path.join(ROOT, ".state", "hmem") });
console.log(`${names.length} molecules`);

let done = 0;
const t0 = Date.now();
for (const base of names.slice(0, limit)) {
  const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (skip && existsSync(path.join(dir, `${slug}.json`))) continue;
  const display = [...(groups.get(base) ?? [base])].sort((a, b) => a.length - b.length)[0];
  const world = new UpstreamWorld({ storage: "memory" });
  try {
    const c = await investigate({ question: `Why is ${display} short, and what do we do?`, drug: base, formulary, memory, world });
    if (!c.stock.length) {
      console.log(`  skip ${slug}: no stock lines matched`);
      continue;
    }
    const graph = world.exportSubgraph(world.query("HospitalItem").map((e) => e.id));
    writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ ...c, slug, graph }, null, 1));
    done++;
    console.log(`  ${String(done).padStart(3)} ${slug.padEnd(28)} ${(c.explanation?.state ?? "-").padEnd(9)} ${c.explanation?.verifier.rejected.length ?? 0} rejected  ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) {
    console.log(`  FAIL ${slug}: ${(e as Error).message.slice(0, 160)}`);
  }
}
console.log(`done: ${done} cases in ${Math.round((Date.now() - t0) / 60000)} min`);
