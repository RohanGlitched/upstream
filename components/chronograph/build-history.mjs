// Usage: node components/chronograph/build-history.mjs "$(pwd)"   (needs data/fda/bundle from data/fda/build_bundle.py)
// Builds components/chronograph/fda-history.json: FDA actions 2000-01-01..asOf (the health rule needs the last inspection, however old) at each of the plants in data/plants.json, by FEI.
import fs from "node:fs";
import path from "node:path";
const ROOT = process.argv[2];
const B = path.join(ROOT, "data/fda/bundle");
function parse(file) {
  const s = fs.readFileSync(path.join(B, file), "utf8");
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length >= head.length - 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
const plantsFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data/plants.json"), "utf8"));
const asOf = plantsFile.asOf;
const feis = new Set(plantsFile.plants.map((p) => p.fei).filter(Boolean));
const FROM = "2000-01-01";
const inWin = (d) => d && d >= FROM && d <= asOf;
const out = {};
const push = (fei, e) => { (out[fei] ??= []).push(e); };
let n = { insp: 0, ca: 0, ia: 0 };
for (const r of parse("inspections.csv")) {
  if (!feis.has(r.fei) || !inWin(r.end_date)) continue;
  const k = r.classification === "OAI" ? "oai" : r.classification === "VAI" ? "vai" : r.classification === "NAI" ? "nai" : null;
  if (!k) continue;
  push(r.fei, { d: r.end_date, k, id: r.inspection_id, known: r.fmd145_date || r.known_date || null, basis: r.known_date_basis || null });
  n.insp++;
}
for (const r of parse("compliance_actions.csv")) {
  if (!feis.has(r.fei) || !inWin(r.action_date)) continue;
  const t = r.action_type;
  const k = /warning/i.test(t) ? "wl" : /injunction/i.test(t) ? "inj" : /seizure/i.test(t) ? "sz" : null;
  if (!k) continue;
  push(r.fei, { d: r.action_date, k, id: r.case_id || null });
  n.ca++;
}
for (const r of parse("import_alerts.csv")) {
  if (!feis.has(r.fei) || !inWin(r.date_published)) continue;
  push(r.fei, { d: r.date_published, k: "ia", id: r.alert });
  n.ia++;
}
for (const k of Object.keys(out)) {
  const seen = new Set();
  out[k] = out[k].filter((e) => { const key = e.k + e.d + (e.id ?? ""); if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => a.d.localeCompare(b.d));
}
const res = { builtFrom: "FDA bundle (data/fda/bundle): inspections, compliance_actions, import_alerts", from: FROM, asOf, plants: out };
fs.writeFileSync(path.join(ROOT, "components/chronograph/fda-history.json"), JSON.stringify(res));
console.log(n, Object.keys(out).length, "plants with events");
