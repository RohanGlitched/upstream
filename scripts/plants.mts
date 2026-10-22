// Build data/plants.json: every plant named on the labels of Corvale's formulary, placed through FDA's
// registration file, with its latest FDA inspection and its FDA actions in the last three years.
//   npx tsx scripts/plants.mts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";
loadEnv();
const { query } = await import("../src/lib/zetaris.ts");
const { USL } = await import("../src/agent/sql.ts");

const AS_OF = process.env.UPSTREAM_AS_OF ?? "2026-10-21";
const SINCE = `${Number(AS_OF.slice(0, 4)) - 3}${AS_OF.slice(4)}`;

// Approximate country centroids (lat, lon) for plotting; FDA gives addresses but no coordinates.
const CENTROID: Record<string, [number, number]> = {
  USA: [39.8, -98.6], IND: [22.5, 79], CHN: [33, 105], DEU: [51.1, 10.4], ITA: [42.8, 12.6], FRA: [46.6, 2.3], CAN: [56, -96],
  JPN: [36.2, 138.3], KOR: [36.5, 127.9], ESP: [40.4, -3.7], GBR: [54, -2.5], IRL: [53.4, -8], CHE: [46.8, 8.2], ISR: [31, 34.9],
  PRT: [39.6, -8], AUT: [47.6, 14.1], BEL: [50.6, 4.6], DNK: [56.2, 9.5], SWE: [62, 15], NLD: [52.2, 5.3], MEX: [23.6, -102.5],
  TWN: [23.7, 121], SGP: [1.35, 103.8], HUN: [47.2, 19.5], SVN: [46.1, 14.9], POL: [52, 19.1], CZE: [49.8, 15.5], TUR: [39, 35.2],
  BRA: [-14.2, -51.9], ARG: [-38.4, -63.6], JOR: [31.2, 36.5], PRI: [18.2, -66.5], BGD: [23.7, 90.4], FIN: [64, 26], GRC: [39.1, 21.8],
  CYP: [35.1, 33.4], MLT: [35.9, 14.4], HRV: [45.1, 15.2], AUS: [-25.3, 133.8], NOR: [60.5, 8.5], ROU: [45.9, 24.9], SVK: [48.7, 19.7],
  LVA: [56.9, 24.6], LTU: [55.2, 23.9], EST: [58.6, 25], ISL: [64.9, -19], NZL: [-40.9, 174.9], ZAF: [-30.6, 22.9], EGY: [26.8, 30.8],
  ARE: [23.4, 53.8], SAU: [23.9, 45.1], VNM: [14.1, 108.3], THA: [15.9, 101], MYS: [4.2, 101.9], IDN: [-0.8, 113.9], PHL: [12.9, 121.8],
  PAK: [30.4, 69.3], LKA: [7.9, 80.8], COL: [4.6, -74.3], CHL: [-35.7, -71.5], URY: [-32.5, -55.8], DOM: [18.7, -70.2], CRI: [9.7, -83.8],
  SRB: [44, 21], BGR: [42.7, 25.5], UKR: [48.4, 31.2], BLR: [53.7, 27.9], RUS: [61.5, 105.3], LUX: [49.8, 6.1],
};

const sql = `WITH ours AS (
  SELECT DISTINCT p.ndc11, p.spl_set_id, p.labeler_name, lower(p.generic_name) AS molecule
  FROM (SELECT ndc11 FROM ${USL}.stock_general UNION SELECT ndc11 FROM ${USL}.stock_east UNION SELECT ndc11 FROM ${USL}.stock_lakeside) s
  JOIN ${USL}.product p ON p.ndc11 = s.ndc11),
plants AS (
  SELECT DISTINCT o.labeler_name, o.molecule, st.fei, st.firm_name, st.country_iso3, st.address
  FROM ours o JOIN ${USL}.product_site ps ON ps.set_id = o.spl_set_id JOIN ${USL}.site st ON st.duns = ps.est_duns
  WHERE st.fei IS NOT NULL AND st.fei <> ''),
latest AS (
  SELECT fei, classification, end_date FROM (
    SELECT fei, classification, end_date, row_number() OVER (PARTITION BY fei ORDER BY end_date DESC) AS rn
    FROM ${USL}.inspection WHERE fei IN (SELECT fei FROM plants)) t WHERE rn = 1),
acts AS (
  SELECT fei, count(*) AS n FROM (
    SELECT fei FROM ${USL}.inspection WHERE classification = 'OAI' AND end_date >= '${SINCE}' AND fei IN (SELECT fei FROM plants)
    UNION ALL SELECT fei FROM fda.compliance_actions WHERE action_date >= '${SINCE}' AND fei IN (SELECT fei FROM plants)
    UNION ALL SELECT fei FROM fda.import_alerts WHERE date_published >= '${SINCE}' AND fei IN (SELECT fei FROM plants)) a GROUP BY fei)
SELECT p.fei, p.firm_name, p.country_iso3, p.address, p.labeler_name, p.molecule,
       l.classification AS last_class, l.end_date AS last_date, coalesce(a.n, 0) AS signals
FROM plants p LEFT JOIN latest l ON l.fei = p.fei LEFT JOIN acts a ON a.fei = p.fei`;

const r = await query(sql, { limit: 10000 });
type P = { name: string; fei: string; country_iso3: string; address: string; lat: number | null; lon: number | null; health: string; last: string | null; products: { labeler: string; molecule: string }[]; signals: number };
const byFei = new Map<string, P>();
const yearsAgo = (d: string) => (Date.parse(AS_OF) - Date.parse(d)) / (365.25 * 86_400_000);
for (const row of r.rows) {
  const fei = String(row.fei);
  const p = byFei.get(fei) ?? {
    name: String(row.firm_name), fei, country_iso3: String(row.country_iso3 ?? ""), address: String(row.address ?? ""),
    lat: CENTROID[String(row.country_iso3)]?.[0] ?? null, lon: CENTROID[String(row.country_iso3)]?.[1] ?? null,
    health: "unknown", last: row.last_class ? `${row.last_class} ${row.last_date}` : null, products: [], signals: Number(row.signals ?? 0),
  };
  if (!p.products.some((x) => x.labeler === row.labeler_name && x.molecule === row.molecule)) p.products.push({ labeler: String(row.labeler_name), molecule: String(row.molecule) });
  const sig = Number(row.signals ?? 0);
  // Same rule as the investigator: recent FDA action -> signal; last inspection OAI, or a recent VAI -> watch.
  p.health = sig > 0 ? "signal" : row.last_class === "OAI" || (row.last_class === "VAI" && yearsAgo(String(row.last_date)) <= 2) ? "watch" : row.last_class && yearsAgo(String(row.last_date)) <= 4 ? "clear" : "unknown";
  byFei.set(fei, p);
}
const plants = [...byFei.values()].sort((a, b) => b.signals - a.signals || a.name.localeCompare(b.name));
const out = { builtAt: new Date().toISOString(), asOf: AS_OF, queryId: r.id, ms: r.ms, plants, counts: plants.reduce<Record<string, number>>((m, p) => ((m[p.health] = (m[p.health] ?? 0) + 1), m), {}) };
mkdirSync(path.join(ROOT, "data"), { recursive: true });
writeFileSync(path.join(ROOT, "data", "plants.json"), JSON.stringify(out, null, 1));
const countries = new Set(plants.map((p) => p.country_iso3));
console.log(`${plants.length} plants in ${countries.size} countries (${[...countries].filter((c) => !CENTROID[c]).join(",") || "all placed"}), ${r.ms} ms`, out.counts);
