// The semantic layer's rules on FDA's side, and the unit checks on ours, run live and recorded through query()
// so the hosted copy replays them. Writes data/dq/fda.json, which /how and the front page read.
//   npx tsx scripts/dq-fda.mts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";

loadEnv();
const { query } = await import("../src/lib/zetaris.ts");
const { USL, dqSql } = await import("../src/agent/sql.ts");
const { USL_FKS } = await import("../src/lib/lineage.ts");

const n = (v: unknown) => Number(v ?? 0) || 0;
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const queryIds: string[] = [];
const run = async (sql: string) => {
  const r = await query(sql, { mode: "live", limit: 500 });
  queryIds.push(r.id);
  console.log(`  ${r.id} ${r.ms} ms ${r.rows.length} rows  ${r.sql.slice(0, 90)}`);
  return r;
};

// 1. RUN DQ on every table whose foreign keys point into FDA's files, and on site (whose PK they join to).
const rules = [];
for (const table of ["product_site", "inspection", "site"] as const) {
  const r = await run(dqSql(table));
  for (const x of r.rows) {
    const fk = (USL_FKS[table] ?? []).find((f) => f.column === String(x.name));
    rules.push({
      table, column: String(x.name), type: String(x.type), references: fk?.references ?? null,
      total: n(x.total_record), valid: n(x.valid_record), invalid: n(x.invalid_record), pct: pct(n(x.invalid_record), n(x.total_record)), queryId: r.id,
    });
  }
}

// 2. Why a label plant cannot be placed: no DUNS on the label, or a DUNS the registration file does not hold.
const plantsR = await run(`SELECT ps.site_source, count(*) AS plants,
       sum(CASE WHEN ps.est_duns IS NULL THEN 1 ELSE 0 END) AS no_duns,
       sum(CASE WHEN ps.est_duns IS NOT NULL AND st.duns IS NULL THEN 1 ELSE 0 END) AS duns_not_registered,
       sum(CASE WHEN st.duns IS NOT NULL THEN 1 ELSE 0 END) AS placed
FROM ${USL}.product_site ps
LEFT JOIN (SELECT DISTINCT duns FROM ${USL}.site) st ON st.duns = ps.est_duns
GROUP BY ps.site_source
ORDER BY plants DESC`);
const bySource = plantsR.rows.map((r) => ({ source: String(r.site_source), plants: n(r.plants), noDuns: n(r.no_duns), dunsNotRegistered: n(r.duns_not_registered), placed: n(r.placed) }));
const plantsTotal = bySource.reduce((a, r) => a + r.plants, 0);
const unplaced = bySource.reduce((a, r) => a + r.noDuns + r.dunsNotRegistered, 0);

// 3. Labels (SPL sets) that list no plant in their establishment block, and those that name none anywhere.
const labelsR = await run(`SELECT count(*) AS labels,
       sum(CASE WHEN listed = 0 THEN 1 ELSE 0 END) AS list_no_establishment,
       sum(CASE WHEN named = 0 THEN 1 ELSE 0 END) AS name_no_plant,
       sum(CASE WHEN placed = 0 THEN 1 ELSE 0 END) AS no_plant_placed
FROM (SELECT e.set_id,
             max(CASE WHEN e.source = 'spl_establishment' THEN 1 ELSE 0 END) AS listed,
             max(CASE WHEN e.source IN ('spl_establishment', 'label_text') AND e.establishment IS NOT NULL THEN 1 ELSE 0 END) AS named,
             max(CASE WHEN st.duns IS NOT NULL THEN 1 ELSE 0 END) AS placed
      FROM fda.spl_establishments e
      LEFT JOIN (SELECT DISTINCT duns FROM ${USL}.site) st ON st.duns = e.est_duns
      GROUP BY e.set_id) t`);
const L = labelsR.rows[0] ?? {};
const labels = {
  labels: n(L.labels), listNoEstablishment: n(L.list_no_establishment), nameNoPlant: n(L.name_no_plant), noPlantPlaced: n(L.no_plant_placed),
  pctListNoEstablishment: pct(n(L.list_no_establishment), n(L.labels)), pctNameNoPlant: pct(n(L.name_no_plant), n(L.labels)), pctNoPlantPlaced: pct(n(L.no_plant_placed), n(L.labels)),
  queryId: labelsR.id,
};

// 4. Units: East's package count against FDA's for the same NDC, and each hospital's unit against FDA's package unit.
const unitsR = await run(`SELECT s.hospital, count(*) AS rows_checked,
       sum(CASE WHEN p.ndc11 IS NULL THEN 1 ELSE 0 END) AS no_fda_product,
       sum(CASE WHEN p.ndc11 IS NOT NULL AND s.pkg_units <> 1 AND s.pkg_units <> p.units_per_pkg THEN 1 ELSE 0 END) AS pkg_count_differs,
       sum(CASE WHEN p.ndc11 IS NOT NULL AND s.unit <> 'each' AND p.pkg_unit <> s.unit THEN 1 ELSE 0 END) AS unit_differs
FROM (SELECT * FROM ${USL}.stock_general
      UNION ALL SELECT * FROM ${USL}.stock_east
      UNION ALL SELECT * FROM ${USL}.stock_lakeside) s
LEFT JOIN ${USL}.product p ON p.ndc11 = s.ndc11
GROUP BY s.hospital
ORDER BY s.hospital`);
const units = unitsR.rows.map((r) => ({ hospital: String(r.hospital), rows: n(r.rows_checked), noFdaProduct: n(r.no_fda_product), pkgCountDiffers: n(r.pkg_count_differs), unitDiffers: n(r.unit_differs) }));

// 5. The stock tables' own rules, for the same sheet (unit -> unit_of_use is new with the units change).
const stockRules = [];
for (const table of ["stock_general", "stock_east", "stock_lakeside"] as const) {
  const r = await run(dqSql(table));
  for (const x of r.rows) {
    stockRules.push({ table, column: String(x.name), type: String(x.type), total: n(x.total_record), invalid: n(x.invalid_record), queryId: r.id });
  }
}

const fkPlants = rules.find((r) => r.table === "product_site" && r.column === "est_duns");
const out = {
  ranAt: new Date().toISOString(),
  rules,
  stockRules,
  plants: { total: plantsTotal, unplaced, pctUnplaced: pct(unplaced, plantsTotal), bySource, ruleQueryId: fkPlants?.queryId ?? null, queryId: plantsR.id },
  labels,
  units: { byHospital: units, queryId: unitsR.id },
  queryIds,
};
const dir = path.join(ROOT, "data", "dq");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "fda.json"), JSON.stringify(out, null, 1));
console.log(`\nlabel plants not placed: ${unplaced} of ${plantsTotal} (${out.plants.pctUnplaced}%)`);
console.log(`labels: ${labels.listNoEstablishment} of ${labels.labels} list no establishment (${labels.pctListNoEstablishment}%), ${labels.nameNoPlant} name no plant (${labels.pctNameNoPlant}%)`);
for (const r of rules) console.log(`  ${r.table}.${r.column} ${r.type}: ${r.invalid} of ${r.total} fail (${r.pct}%)`);
for (const u of units) console.log(`  units ${u.hospital}: ${u.rows} rows, ${u.pkgCountDiffers} package counts differ from FDA, ${u.unitDiffers} units differ, ${u.noFdaProduct} not in FDA`);
console.log("saved data/dq/fda.json");
