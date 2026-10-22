// EXPLAIN the two federated statements that reach the hospitals' Postgres, through query() so the plans are
// recorded and replayable, and keep the plan lines that show what Zetaris pushes down to each source.
// Writes data/zetaris/explain.json for sheet A-2 on /how.
//   npx tsx scripts/explain-pushdown.mts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";

loadEnv();
const { query } = await import("../src/lib/zetaris.ts");
const Q = await import("../src/agent/sql.ts");

// The carboplatin case's own statements: its stock lookup, and the interchange query over its NDCs.
const CARBOPLATIN_NDC11 = ["00703423901", "16729029512", "60505628201"];
const plans = [
  { name: "stockSql", what: "Our stock in three hospitals (carboplatin)", sql: Q.stockSql("carboplatin") },
  { name: "interchangeSql", what: "Approved interchanges for carboplatin's NDCs", sql: Q.interchangeSql(CARBOPLATIN_NDC11) },
];
// A USL table is an opaque scan in the plan above it, so also EXPLAIN what the stock_east activation itself reads.
const usl = readFileSync(path.join(ROOT, "zetaris", "04-usl.sql"), "utf8");
const east = /ACTIVATE USL TABLE \S+\.stock_east AS\s+([\s\S]*?);\s*\n\s*\n/.exec(usl)?.[1];
if (east) plans.push({ name: "stock_east activation", what: "What the stock_east activation reads from Corvale East's Postgres", sql: east });

/** One scan in the physical plan: which source, which columns it reads, and what it pushed down. */
interface Scan {
  kind: "jdbc" | "file" | "usl";
  source: string;
  table: string;
  pushedFilters: string[];
  readSchema: string;
  line: string;
}

function scansOf(plan: string): Scan[] {
  const out: Scan[] = [];
  for (const raw of plan.split(/\r?\n/)) {
    const line = raw.trim();
    const jdbc = /Scan InsertableJDBCTableRelation.*?\)\s+([A-Z_]+)\.(\w+)\[/.exec(line);
    const file = /FileScan csv\s+(?:(\w+)\.)?(\w+)?/.exec(line);
    const uslScan = /Scan USLTableScan\[(\w+)\]/.exec(line);
    if (!jdbc && !file && !uslScan) continue;
    // Filters can hold lists (In(ndc11, [...])), so read up to the "], ReadSchema" that closes them.
    const pushed = /PushedFilters: \[(.*?)\], ReadSchema/.exec(line)?.[1] ?? "";
    const schema = /ReadSchema: (struct<.*)$/.exec(line)?.[1] ?? "";
    // Drop the connection block: Zetaris masks the credentials, but the plan line needs only source and table.
    const short = line.replace(/InsertableJDBCTableRelation\(.*?SQLContext@\w+\)/, "JDBCTableRelation(…)").replace(/Location: [^,]*,/, "");
    out.push({
      kind: jdbc ? "jdbc" : uslScan ? "usl" : "file",
      source: jdbc ? jdbc[1].toLowerCase() : uslScan ? "upstream_usl" : (file?.[1] ?? "file"),
      table: jdbc ? jdbc[2] : uslScan ? uslScan[1] : (file?.[2] ?? ""),
      pushedFilters: pushed ? pushed.split(/,\s(?=[A-Z][a-zA-Z]+\()/) : [],
      readSchema: schema,
      line: short.slice(0, 600),
    });
  }
  return out;
}

const results = [];
for (const p of plans) {
  const r = await query(`EXPLAIN ${p.sql}`, { mode: "live", limit: 50 });
  const text = r.rows.map((x) => String(Object.values(x)[0] ?? "")).join("\n");
  const scans = scansOf(text);
  results.push({ ...p, queryId: r.id, ms: r.ms, ranAt: r.ranAt, scans });
  console.log(`${p.name}: ${r.id}, ${scans.length} scans`);
  for (const s of scans) console.log(`  ${s.kind} ${s.source}.${s.table}  pushed [${s.pushedFilters.join("; ")}]  ${s.readSchema.slice(0, 120)}`);
}
const dir = path.join(ROOT, "data", "zetaris");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "explain.json"), JSON.stringify({ ranAt: new Date().toISOString(), plans: results }, null, 1));
console.log("saved data/zetaris/explain.json");
