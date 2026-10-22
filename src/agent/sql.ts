// The investigation's fixed moves: one Lightning SQL statement per step, against Upstream's semantic layer
// (lightning.metastore.upstream.upstream_usl) and FDA's files. The hospitals are read in place; FDA's files are
// CSVs cleaned once by data/fda/build_bundle.py and read by Zetaris as file tables.
import { inList, moleculeFindRegex, moleculeRegex } from "./util";

export const USL = "lightning.metastore.upstream.upstream_usl";
const like = (term: string) => `'%${term.toLowerCase().replace(/'/g, "''").replace(/[%_]/g, "")}%'`;
// The molecule on whole words, salts allowed, never a longer molecule (atracurium is not cisatracurium).
const isMolecule = (col: string, term: string) => `lower(trim(coalesce(${col}, ''))) RLIKE '${moleculeRegex(term)}'`;

/** Every stock line in all three hospitals whose product (or, when FDA does not list the NDC, whose description)
 *  is the molecule, in units of use, with what makes a presentation: strength, form and the content of one unit. */
export function stockSql(term: string, form: string | null = null): string {
  return `SELECT s.hospital, s.item_key, s.ndc11, s.ndc_as_recorded, s.description, s.on_hand, s.daily_use, s.unit, s.pkg_units, s.unit_basis, s.ndc_match,
       p.generic_name, p.labeler_name, p.package_ndc, p.spl_set_id, p.dosage_form, p.route, p.strength, p.unit_content, p.pkg_unit
FROM (SELECT * FROM ${USL}.stock_general
      UNION ALL SELECT * FROM ${USL}.stock_east
      UNION ALL SELECT * FROM ${USL}.stock_lakeside) s
LEFT JOIN ${USL}.product p ON p.ndc11 = s.ndc11
WHERE (${isMolecule("p.generic_name", term)} OR (p.ndc11 IS NULL AND ${isMolecule("s.description", term)}))${form ? `
  AND (p.ndc11 IS NULL OR lower(p.dosage_form) LIKE ${like(form)})` : ""}
ORDER BY s.hospital, s.item_key`;
}

/** The plants each of our products' labels names, placed through FDA's registration file. */
export function chainSql(setIds: string[]): string {
  return `SELECT ps.set_id, ps.establishment, ps.est_duns, ps.est_operations, ps.site_source,
       st.fei, st.firm_name, st.country_iso3, st.address
FROM ${USL}.product_site ps
LEFT JOIN ${USL}.site st ON st.duns = ps.est_duns
WHERE ps.set_id IN (${inList(setIds)})
ORDER BY ps.set_id, ps.establishment`;
}

/** Every FDA drug inspection of these plants. */
export function inspectionsSql(feis: string[]): string {
  return `SELECT inspection_id, fei, legal_name, country, end_date, classification, known_date, known_date_basis
FROM ${USL}.inspection
WHERE fei IN (${inList(feis)})
ORDER BY fei, end_date`;
}

/** What FDA wrote down at the OAI inspections: the Form 483 observations. */
export function citationsSql(inspectionIds: string[]): string {
  return `SELECT inspection_id, fei, end_date, cfr, short_description
FROM fda.citations
WHERE inspection_id IN (${inList(inspectionIds)})
ORDER BY inspection_id, cfr`;
}

/** Warning letters, injunctions and seizures at these plants. */
export function actionsSql(feis: string[]): string {
  return `SELECT fei, legal_name, country, action_date, action_type, case_id
FROM fda.compliance_actions
WHERE fei IN (${inList(feis)})
ORDER BY fei, action_date`;
}

/** Import alerts (66-40 CGMP, 66-79 refused inspection) for these plants: by FEI, or by firm name when FDA gives no FEI. */
export function importAlertsSql(feis: string[], firmKeys: string[]): string {
  return `SELECT alert, country, firm, address, date_published, fei, fei_match, firm_key
FROM fda.import_alerts
WHERE fei IN (${inList(feis)}) OR (fei_match <> 'name_and_city' AND firm_key IN (${inList(firmKeys)}))
ORDER BY date_published`;
}

/** Recalls of this molecule by our labelers or plants since 2020. */
export function recallsSql(term: string, firmKeys: string[]): string {
  return `SELECT recall_number, recalling_firm, firm_key, country, classification, status, initiation_date, report_date,
       substr(reason, 1, 220) AS reason, substr(product_description, 1, 160) AS product_description
FROM fda.recalls
WHERE firm_key IN (${inList(firmKeys)}) AND initiation_date >= '2020-01-01'
  AND lower(product_description) RLIKE '${moleculeFindRegex(term)}'
ORDER BY initiation_date`;
}

/** FDA's shortage list today for this molecule (one row per presentation). */
export function shortageCurrentSql(term: string): string {
  return `SELECT generic_name, company_name, status, package_ndc, initial_posting_date, update_date, substr(related_info, 1, 220) AS related_info
FROM fda.shortage_current
WHERE ${isMolecule("generic_name", term)}
ORDER BY status, company_name, package_ndc`;
}

/** FDA's shortage history for this molecule: the first posting and stated reasons, from archived snapshots. */
export function shortageHistorySql(term: string): string {
  return `SELECT generic, category, first_posting, first_seen, last_seen, resolved_first_seen, statuses, n_companies, reasons
FROM fda.shortage_episodes
WHERE ${isMolecule("generic", term)}
ORDER BY first_posting`;
}

/** Everyone else who makes this molecule in the same form, and the plants their labels name. */
export function marketSql(term: string, dosageWord: string): string {
  return `SELECT p.ndc11, p.package_ndc, p.labeler_name, p.dosage_form, p.spl_set_id,
       ps.establishment, ps.est_duns, st.fei, st.country_iso3
FROM ${USL}.product p
LEFT JOIN ${USL}.product_site ps ON ps.set_id = p.spl_set_id
LEFT JOIN ${USL}.site st ON st.duns = ps.est_duns
WHERE ${isMolecule("p.generic_name", term)} AND lower(p.dosage_form) LIKE ${like(dosageWord)}
ORDER BY p.labeler_name, p.ndc11`;
}

/** The P&T committee's approved interchanges for our items, from Corvale General's own database. */
export function interchangeSql(ndc11s: string[]): string {
  return `SELECT a.ndc11 AS ndc11, a.generic_name AS item, b.ndc11 AS alt_ndc11, b.generic_name AS alternative, b.strength AS alt_strength,
       ti.rule, ti.approved_by, ti.approved_on, ti.notes, p.labeler_name AS alt_labeler
FROM corvale_general.therapeutic_interchange ti
JOIN corvale_general.formulary_item a ON a.item_id = ti.item_id
JOIN corvale_general.formulary_item b ON b.item_id = ti.alt_item_id
LEFT JOIN ${USL}.product p ON p.ndc11 = b.ndc11
WHERE a.ndc11 IN (${inList(ndc11s)})`;
}

/** The semantic layer's key rules over one USL table (the stock tables' NDC and unit keys, or FDA's plant and inspection keys). */
export function dqSql(table: "stock_general" | "stock_east" | "stock_lakeside" | "product_site" | "inspection" | "site"): string {
  return `RUN DQ TABLE ${USL}.${table}`;
}

/** Lakeside rows the NDC rule rejects, so the brief can name them. */
export function dqLakesideRowsSql(term: string): string {
  return `SELECT s.item_key, s.description, s.ndc_as_recorded, s.ndc_match
FROM ${USL}.stock_lakeside s
LEFT JOIN ${USL}.product p ON p.ndc11 = s.ndc11
WHERE p.ndc11 IS NULL AND ${isMolecule("s.description", term)}`;
}
