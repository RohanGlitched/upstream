// Run Lightning SQL against Zetaris, one statement per call (Zetaris accepts one at a time).
//   npx tsx scripts/zsql.mts zetaris/01-hospitals.sql [--skip-exists] [--dry-run]
//   npx tsx scripts/zsql.mts -e "SHOW LIGHTNING DATABASES"
// Statements end with ";" at the end of a line. A block between "-- @whole" and "-- @end" is sent as one
// statement (multi-table COMPILE USL must not be split). ${VAR} is filled from .env.local and
// infra/hospital/.env, so passwords never sit in committed SQL.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
  }
}
const root = path.resolve(import.meta.dirname, "..");
loadEnv(path.join(root, ".env.local"));
loadEnv(path.join(root, "infra", "hospital", ".env"));
process.env.ZETARIS_RECORD = "0";

const { query } = await import("../src/lib/zetaris.ts");

export function splitStatements(text: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let whole = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "-- @whole") { whole = true; continue; }
    if (t === "-- @end") { whole = false; out.push(buf.join("\n").trim().replace(/;$/, "")); buf = []; continue; }
    if (!whole && (t === "" || t.startsWith("--")) && buf.length === 0) continue;
    buf.push(line);
    if (!whole && t.endsWith(";")) { out.push(buf.join("\n").trim().replace(/;$/, "")); buf = []; }
  }
  if (buf.join("").trim()) out.push(buf.join("\n").trim());
  return out.filter(Boolean);
}

function fill(sql: string): string {
  return sql.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => {
    const v = process.env[k];
    if (v === undefined) throw new Error(`missing env ${k}`);
    return v;
  });
}

const args = process.argv.slice(2);
const skipExists = args.includes("--skip-exists");
const dry = args.includes("--dry-run");
const e = args.indexOf("-e");
const stmts = e >= 0 ? [args[e + 1]] : splitStatements(readFileSync(args.find((a) => !a.startsWith("-"))!, "utf8"));

let failed = 0;
for (const [i, s] of stmts.entries()) {
  const head = s.replace(/\s+/g, " ").slice(0, 110);
  if (dry) { console.log(`[${i + 1}] ${head}`); continue; }
  try {
    const r = await query(fill(s), { mode: "live", limit: 200 });
    console.log(`[${i + 1}] ok ${r.ms}ms ${r.rows.length} rows  ${head}`);
    if (e >= 0 || /^\s*(show|select|with|describe|preview|run dq|list dq)/i.test(s)) {
      console.log(r.columns.join(" | "));
      for (const row of r.rows.slice(0, 40)) console.log(r.columns.map((c) => String(row[c] ?? "")).join(" | "));
    }
  } catch (err) {
    const msg = (err as Error).message.replace(/password\s+"[^"]*"/gi, 'password "***"');
    if (skipExists && /already exist/i.test(msg)) { console.log(`[${i + 1}] exists  ${head}`); continue; }
    console.log(`[${i + 1}] FAIL ${head}\n    ${msg.slice(0, 500)}`);
    failed++;
    if (!args.includes("--keep-going")) break;
  }
}
process.exit(failed ? 1 : 0);
