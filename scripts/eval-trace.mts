// Trace eval. Ground truth: backtest/join_test.csv, built by independent Python over FDA's raw files
// (backtest/07_join_test.py imports nothing from Upstream). For each shortage drug + labeler + plant row:
//   1. Upstream: does the Zetaris path (product -> label plants -> registration) reach the same FEI, and
//      the same last inspection before the posting?
//   2. Nemotron alone: asked the same question with no tools, does it name the right plant and inspection?
//   npx tsx scripts/eval-trace.mts [--no-baseline]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";
loadEnv();
const { query } = await import("../src/lib/zetaris.ts");
const { chat, parseJson, MODELS, tally } = await import("../src/lib/nemotron.ts");
const { USL } = await import("../src/agent/sql.ts");
const { firmKey, inList } = await import("../src/agent/util.ts");

type Truth = { drug: string; posted: string; labeler: string; site: string; country: string; duns: string; fei: string; last_dqa: string };
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { cur.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; cur.push(cell); rows.push(cur); cur = []; cell = ""; } else cell += ch;
  }
  if (cell || cur.length) { cur.push(cell); rows.push(cur); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
const truth = parseCsv(readFileSync(path.join(ROOT, "backtest", "join_test.csv"), "utf8")).filter((r) => r.fei) as unknown as Truth[];
const lastOf = (s: string) => s.match(/(NAI|VAI|OAI) ended (\d{4}-\d{2}-\d{2})/);

const byDrug = new Map<string, Truth[]>();
for (const t of truth) byDrug.set(t.drug, [...(byDrug.get(t.drug) ?? []), t]);

const rows: Record<string, unknown>[] = [];
let queries = 0, ms = 0;
for (const [drug, ts] of byDrug) {
  // The agent's own path: FDA's listed NDCs for this shortage -> product -> the plants its label names -> registration.
  const r = await query(`SELECT p.labeler_name, ps.est_duns, st.fei, st.firm_name
    FROM fda.shortage_presentations sp
    JOIN ${USL}.product p ON p.package_ndc = sp.package_ndc
    JOIN ${USL}.product_site ps ON ps.set_id = p.spl_set_id
    LEFT JOIN ${USL}.site st ON st.duns = ps.est_duns
    WHERE sp.generic = '${drug.replace(/'/g, "''")}'`, { limit: 5000 });
  queries++; ms += r.ms;
  const feis = [...new Set(ts.map((t) => t.fei))];
  const ins = await query(`SELECT fei, inspection_id, end_date, classification FROM ${USL}.inspection WHERE fei IN (${inList(feis)})`, { limit: 5000 });
  queries++; ms += ins.ms;
  for (const t of ts) {
    const lab = firmKey(t.labeler);
    void lab;
    const feiFound = r.rows.some((x) => String(x.fei) === t.fei);
    const before = ins.rows.filter((x) => String(x.fei) === t.fei && String(x.end_date) < t.posted).sort((a, b) => String(b.end_date).localeCompare(String(a.end_date)))[0];
    const want = lastOf(t.last_dqa);
    rows.push({
      drug, labeler: t.labeler, plant: t.site, fei: t.fei, posted: t.posted,
      upstreamFei: feiFound, truthLast: want ? `${want[1]} ${want[2]}` : null,
      upstreamLast: before ? `${before.classification} ${before.end_date}` : null,
      lastMatch: want ? !!before && before.classification === want[1] && before.end_date === want[2] : !before,
    });
  }
}

let baseline: Record<string, unknown>[] = [];
if (!process.argv.includes("--no-baseline")) {
  const pairs = [...new Map(truth.map((t) => [`${t.drug}|${t.labeler}`, t])).values()];
  for (const t of pairs) {
    const sites = truth.filter((x) => x.drug === t.drug && x.labeler === t.labeler);
    try {
      const r = await chat([
        { role: "system", content: "Answer from your own knowledge. Reply with JSON only." },
        { role: "user", content: `FDA posted a US shortage of ${t.drug} on ${t.posted}. For ${t.labeler}'s product, name the manufacturing plant (firm, city, country) and FDA's most recent drug inspection of that plant before the posting: classification (NAI, VAI or OAI) and the date the inspection ended. JSON: {"plant": "", "city": "", "country": "", "fei": "", "classification": "", "end_date": "YYYY-MM-DD", "confident": true}` },
      ], { model: MODELS.reason, maxTokens: 220, temperature: 0 });
      const j = parseJson<{ plant?: string; country?: string; fei?: string; classification?: string; end_date?: string; confident?: boolean }>(r.text);
      const plantOk = sites.some((s) => { const a = firmKey(s.site).split(" ")[0]; return !!a && firmKey(j.plant ?? "").includes(a); });
      const want = sites.map((s) => lastOf(s.last_dqa)).find(Boolean);
      baseline.push({
        drug: t.drug, labeler: t.labeler, said: j, plantOk,
        feiOk: sites.some((s) => s.fei === String(j.fei ?? "").replace(/^0+/, "")),
        classOk: !!want && j.classification === want[1], dateOk: !!want && j.end_date === want[2],
        inventedDate: !!j.end_date && !!want && j.end_date !== want[2], confident: j.confident ?? null,
      });
    } catch (e) {
      baseline.push({ drug: t.drug, labeler: t.labeler, error: (e as Error).message.slice(0, 100) });
    }
  }
}

const n = rows.length;
const pct = (k: number, d: number) => `${k}/${d} (${Math.round((100 * k) / d)}%)`;
const summary = {
  ranAt: new Date().toISOString(), truthRows: n, drugs: byDrug.size, zetaris: { queries, ms },
  upstream: { plantFound: pct(rows.filter((r) => r.upstreamFei).length, n), lastInspectionMatch: pct(rows.filter((r) => r.lastMatch).length, n) },
  baseline: baseline.length ? {
    model: MODELS.reason, pairs: baseline.length,
    plantNamed: pct(baseline.filter((b) => b.plantOk).length, baseline.length),
    feiCorrect: pct(baseline.filter((b) => b.feiOk).length, baseline.length),
    classificationCorrect: pct(baseline.filter((b) => b.classOk).length, baseline.length),
    dateCorrect: pct(baseline.filter((b) => b.dateOk).length, baseline.length),
    inventedDates: baseline.filter((b) => b.inventedDate).length,
    saidConfident: baseline.filter((b) => b.confident === true).length,
    tokens: { in: tally.tokensIn, out: tally.tokensOut },
  } : null,
};
mkdirSync(path.join(ROOT, "data", "eval"), { recursive: true });
writeFileSync(path.join(ROOT, "data", "eval", "trace.json"), JSON.stringify({ summary, rows, baseline }, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const r of rows.filter((r) => !r.upstreamFei || !r.lastMatch)) console.log("  miss:", r.drug, "|", r.labeler, "|", r.plant, "| want", r.truthLast, "got", r.upstreamLast, r.upstreamFei ? "" : "(plant not reached)");
