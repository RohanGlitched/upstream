// Lineage: which physical systems a Zetaris statement read. A query against the semantic layer names USL tables
// (lightning.metastore.upstream.upstream_usl.stock_east); each is resolved to the source table its activation reads
// (zetaris/04-usl.sql), and each source table to the system that holds it. Pure: the UI computes it from the SQL
// text, so recorded cases show lineage without re-running.

export type SystemKind = "hospital" | "fda" | "memory";

export interface SourceSystem {
  id: string;
  name: string; // "Corvale East, Postgres"
  kind: SystemKind;
  how: string; // how Zetaris reaches it
}

export interface LineageEntry {
  system: SourceSystem;
  table: string; // physical table, e.g. "corvale_east.stock_position"
  via: string | null; // the USL table that read it, e.g. "stock_east"
}

const USL_PREFIX = "lightning.metastore.upstream.upstream_usl.";

/** Each USL table and the source tables its ACTIVATE statement reads (zetaris/04-usl.sql). */
export const USL_LINEAGE: Record<string, string[]> = {
  product: ["fda.ndc_packages"],
  site: ["fda.registrations"],
  site_fei: ["fda.registrations"],
  product_site: ["fda.spl_establishments"],
  inspection: ["fda.inspections"],
  stock_general: ["corvale_general.stock_position"],
  // East and Lakeside also look each undashed NDC's three readings up in FDA's NDC file (the repair).
  stock_east: ["corvale_east.stock_position", "fda.ndc_packages"],
  stock_lakeside: ["corvale_lakeside.cabinet", "corvale_lakeside.usage_30d", "fda.ndc_packages"],
  unit_of_use: [], // the semantic layer's own list of units of use, declared in the activation
};

/** The foreign keys declared in 04-usl.sql: RUN DQ on a table also reads the table each key points at. */
export const USL_FKS: Record<string, { column: string; references: string }[]> = {
  stock_general: [{ column: "ndc11", references: "product.ndc11" }, { column: "unit", references: "unit_of_use.unit" }],
  stock_east: [{ column: "ndc11", references: "product.ndc11" }, { column: "unit", references: "unit_of_use.unit" }],
  stock_lakeside: [{ column: "ndc11", references: "product.ndc11" }, { column: "unit", references: "unit_of_use.unit" }],
  product_site: [{ column: "est_duns", references: "site.duns" }],
  inspection: [{ column: "fei", references: "site_fei.fei" }],
};

const HOSPITAL: Record<string, SourceSystem> = {
  corvale_general: { id: "corvale_general", name: "Corvale General, Postgres", kind: "hospital", how: "JDBC, read-only reporting views" },
  corvale_east: { id: "corvale_east", name: "Corvale East, Postgres", kind: "hospital", how: "JDBC, read-only reporting views" },
  corvale_lakeside: { id: "corvale_lakeside", name: "Corvale Lakeside, cabinet CSV export", kind: "hospital", how: "file tables over the nightly export" },
};

/** FDA's public files, one system each: data/fda/build_bundle.py cleans them once into CSVs that Zetaris reads as file tables. */
const FDA: Record<string, string> = {
  ndc_packages: "FDA NDC directory file",
  spl_establishments: "DailyMed SPL establishments file",
  registrations: "FDA registrations file",
  inspections: "FDA inspection classifications file",
  citations: "FDA Form 483 citations file",
  compliance_actions: "FDA compliance actions file",
  import_alerts: "FDA import alerts file",
  recalls: "FDA recall enforcement file",
  shortage_current: "FDA shortage list file",
  shortage_episodes: "FDA shortage history file",
  shortage_presentations: "FDA shortage presentations file",
  dmf_api: "FDA drug master file list",
};

const MEMORY: Record<string, SourceSystem> = {
  "meterless.hmem": { id: "meterless.hmem", name: "H-MEM decision memory", kind: "memory", how: "Meterless H-MEM, not a Zetaris source" },
};

/** The system that holds a physical table (or a non-Zetaris source such as H-MEM). */
export function systemOf(table: string): SourceSystem {
  const t = table.toLowerCase();
  if (MEMORY[t]) return MEMORY[t];
  const [db, name] = t.split(".");
  if (HOSPITAL[db]) return HOSPITAL[db];
  if (db === "fda" && name) {
    return { id: `fda.${name}`, name: FDA[name] ?? `FDA ${name.replace(/_/g, " ")} file`, kind: "fda", how: "CSV file table, cleaned once from FDA's public file" };
  }
  return { id: t, name: t, kind: "fda", how: "" };
}

/** Every FDA file Zetaris registers (zetaris/02-fda.sql): the one count the site quotes. */
export const FDA_FILES_REGISTERED = Object.keys(FDA).length;

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/** Qualified tables the statement names, in full (USL tables keep all five parts). */
export function tablesOf(sql: string): string[] {
  const s = normalize(sql);
  const found = new Set<string>();
  const dq = /^(?:explain\s+)?run dq table\s+([a-z_][\w.]*)/i.exec(s);
  if (dq) {
    const t = dq[1].toLowerCase();
    found.add(t);
    const usl = t.startsWith(USL_PREFIX) ? t.slice(USL_PREFIX.length) : null;
    for (const fk of (usl && USL_FKS[usl]) || []) found.add(USL_PREFIX + fk.references.split(".")[0]);
  }
  for (const m of s.matchAll(/\b(?:from|join)\s+([a-z_]\w*(?:\.[a-z_]\w*){1,4})/gi)) found.add(m[1].toLowerCase());
  return [...found];
}

/** The statement's lineage: each physical table it read, the system holding it, and the USL table it came through. */
export function lineageOf(sql: string): LineageEntry[] {
  const out: LineageEntry[] = [];
  const seen = new Set<string>();
  const add = (table: string, via: string | null) => {
    const k = `${table}|${via ?? ""}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ system: systemOf(table), table, via });
  };
  for (const t of tablesOf(sql)) {
    if (t.startsWith(USL_PREFIX)) {
      const usl = t.slice(USL_PREFIX.length);
      for (const phys of USL_LINEAGE[usl] ?? []) add(phys, usl);
    } else {
      add(t, null);
    }
  }
  return out;
}

/** Physical tables a statement read, deduplicated: what a query's "sources" field holds. */
export function physicalOf(sql: string): string[] {
  return [...new Set(lineageOf(sql).map((l) => l.table))];
}

/** Distinct systems behind a set of physical tables (or statements' sources). */
export function systemsOf(tables: Iterable<string>): SourceSystem[] {
  const by = new Map<string, SourceSystem>();
  for (const t of tables) {
    const s = systemOf(t);
    if (!by.has(s.id)) by.set(s.id, s);
  }
  return [...by.values()];
}

/** "4 systems, 1 statement, 2.3 s": the strip under a query or a step. */
export function lineageLine(systems: number, statements: number, ms: number): string {
  const sec = ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
  return `${systems} ${systems === 1 ? "system" : "systems"}, ${statements} ${statements === 1 ? "statement" : "statements"}, ${sec}`;
}

interface CaseLike {
  steps: { queryIds: string[]; sources: string[] }[];
  queries: Record<string, { sql: string; sources: string[] }>;
}

/** Recompute every query's and step's sources from the SQL text. Recorded cases stored truncated names
 *  ("lightning.metastore.upstream"); this replaces them with the physical tables, so lineage never trusts the stored field. */
export function withLineage<T extends CaseLike>(c: T): T {
  const queries = Object.fromEntries(Object.entries(c.queries).map(([id, q]) => [id, { ...q, sources: physicalOf(q.sql) }]));
  const steps = c.steps.map((s) => {
    const fromSql = s.queryIds.flatMap((id) => queries[id]?.sources ?? []);
    const other = s.sources.filter((x) => systemOf(x).kind === "memory");
    return { ...s, sources: [...new Set([...fromSql, ...other])] };
  });
  return { ...c, queries, steps };
}

/** The data systems a whole case read (H-MEM is memory, not a data source, so it is not counted). */
export function caseSystems(c: CaseLike): SourceSystem[] {
  return systemsOf(Object.values(c.queries).flatMap((q) => physicalOf(q.sql))).filter((s) => s.kind !== "memory");
}
