// Sheet A-2 on /how: the Unified Semantic Layer as a drawing. Nine tables with their keys, the foreign keys that
// become RUN DQ rules, and the physical system each table's activation reads (zetaris/04-usl.sql), coloured by
// system. Below it, the rules as measured and the EXPLAIN excerpts. Server-rendered; no client code.
import { fmtInt } from "./lib/format";

type Sys = "general" | "east" | "lakeside" | "fda" | "usl";

interface Tbl {
  name: string;
  sys: Sys;
  x: number;
  y: number;
  rows: string[]; // "PK ndc11", "FK ndc11 > product", plain columns
  from: string; // the physical table its activation reads
}

const SYS: Record<Sys, { label: string; cls: string }> = {
  general: { label: "Corvale General, Postgres", cls: "is-general" },
  east: { label: "Corvale East, Postgres", cls: "is-east" },
  lakeside: { label: "Corvale Lakeside, cabinet CSV export", cls: "is-lakeside" },
  fda: { label: "FDA public file, cleaned CSV", cls: "is-fda" },
  usl: { label: "Declared in the semantic layer", cls: "is-usl" },
};

const W = 300;
const HEAD = 30;
const ROW = 20;
const FOOT = 30;
const A = 16;
const B = 370;
const C = 724;

const TABLES: Tbl[] = [
  { name: "stock_general", sys: "general", x: A, y: 16, rows: ["PK item_key", "FK ndc11 > product", "FK unit > unit_of_use", "on_hand, daily_use in units"], from: "corvale_general.stock_position" },
  { name: "stock_east", sys: "east", x: A, y: 186, rows: ["PK item_key", "FK ndc11 > product", "FK unit > unit_of_use", "packages x pkg_size = units"], from: "corvale_east.stock_position" },
  { name: "stock_lakeside", sys: "lakeside", x: A, y: 356, rows: ["PK item_key", "FK ndc11 > product", "FK unit > unit_of_use", "on_hand, daily_use in units"], from: "corvale_lakeside.cabinet + usage_30d" },
  { name: "product", sys: "fda", x: B, y: 40, rows: ["PK ndc11", "generic_name, labeler_name", "strength, dosage_form", "unit_content, units_per_pkg", "spl_set_id"], from: "fda.ndc_packages" },
  { name: "unit_of_use", sys: "usl", x: B, y: 300, rows: ["PK unit", "unit_kind"], from: "vial, bag, syringe, tablet, capsule, each" },
  { name: "product_site", sys: "fda", x: C, y: 16, rows: ["PK link_id", "set_id", "FK est_duns > site", "establishment, site_source"], from: "fda.spl_establishments" },
  { name: "site", sys: "fda", x: C, y: 196, rows: ["PK duns", "fei, firm_name", "country_iso3, operations"], from: "fda.registrations" },
  { name: "site_fei", sys: "fda", x: C, y: 356, rows: ["PK fei", "firm_name, country_iso3"], from: "fda.registrations, by FEI" },
  { name: "inspection", sys: "fda", x: C, y: 486, rows: ["PK inspection_id", "FK fei > site_fei", "classification, end_date"], from: "fda.inspections" },
];

const height = (t: Tbl) => HEAD + t.rows.length * ROW + FOOT;
const rowY = (t: Tbl, i: number) => t.y + HEAD + i * ROW + ROW / 2;
const T = (n: string) => TABLES.find((t) => t.name === n)!;

export interface DqRule {
  table: string;
  column: string;
  type: string;
  references?: string | null;
  total: number;
  invalid: number;
  queryId: string;
}

export interface FdaDq {
  ranAt: string;
  rules: DqRule[];
  stockRules: DqRule[];
  plants: { total: number; unplaced: number; pctUnplaced: number; bySource: { source: string; plants: number; noDuns: number; dunsNotRegistered: number; placed: number }[]; ruleQueryId: string | null; queryId: string };
  labels: { labels: number; listNoEstablishment: number; nameNoPlant: number; pctListNoEstablishment: number; pctNameNoPlant: number; queryId: string };
  units: { byHospital: { hospital: string; rows: number; noFdaProduct: number; pkgCountDiffers: number; unitDiffers: number }[]; queryId: string };
}

export interface ExplainFile {
  ranAt: string;
  plans: { name: string; what: string; queryId: string; scans: { kind: string; source: string; table: string; pushedFilters: string[]; readSchema: string }[] }[];
}

function Box({ t }: { t: Tbl }) {
  const h = height(t);
  return (
    <g className={`usl-t ${SYS[t.sys].cls}`}>
      <rect className="usl-t__box" x={t.x} y={t.y} width={W} height={h} />
      <rect className="usl-t__head" x={t.x} y={t.y} width={W} height={HEAD} />
      <rect className="usl-t__stripe" x={t.x} y={t.y} width={6} height={h} />
      <text className="usl-t__name" x={t.x + 16} y={t.y + 20}>
        {t.name}
      </text>
      {t.rows.map((r, i) => {
        const key = /^(PK|FK) /.exec(r)?.[1];
        return (
          <text key={i} className={`usl-t__row${key ? ` is-${key.toLowerCase()}` : ""}`} x={t.x + 16} y={rowY(t, i) + 4.5}>
            {key ? <tspan className="usl-t__k">{key}</tspan> : null}
            {key ? ` ${r.slice(3).replace(" > ", " → ")}` : r}
          </text>
        );
      })}
      <line className="usl-t__rule" x1={t.x} x2={t.x + W} y1={t.y + h - FOOT} y2={t.y + h - FOOT} />
      <text className="usl-t__from" x={t.x + 16} y={t.y + h - 10}>
        {t.sys === "usl" ? t.from : `← ${t.from}`}
      </text>
    </g>
  );
}

/** An elbow from one table's FK row to the other table's PK row, over a vertical bus at x = bus. */
function Fk({ from, row, to, bus, side = "right", label }: { from: string; row: number; to: string; bus: number; side?: "right" | "left"; label?: string }) {
  const a = T(from);
  const b = T(to);
  const y1 = rowY(a, row);
  const y2 = rowY(b, 0);
  const x1 = side === "right" ? a.x + W : a.x;
  const x2 = side === "right" ? b.x : b.x;
  const d = `M${x1},${y1} H${bus} V${y2} H${x2 - 7}`;
  return (
    <g className="usl-fk">
      <path d={d} />
      <path className="usl-fk__head" d={`M${x2 - 8},${y2 - 4.5} L${x2},${y2} L${x2 - 8},${y2 + 4.5} Z`} />
      {label ? (
        <text className="usl-fk__l" x={bus + 4} y={(y1 + y2) / 2}>
          {label}
        </text>
      ) : null}
    </g>
  );
}

function rule(rules: DqRule[], table: string, column: string): DqRule | undefined {
  return rules.find((r) => r.table === table && r.column === column);
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(a && (100 * a) / b < 1 ? 1 : 0)}%` : "0%");

export function UslSheet({ dq, explain }: { dq: FdaDq | null; explain: ExplainFile | null }) {
  const all = dq ? [...dq.stockRules, ...dq.rules] : [];
  const fks = all.filter((r) => /foreign/i.test(r.type));
  const pks = all.filter((r) => /primary/i.test(r.type));
  const noDuns = dq ? dq.plants.bySource.reduce((a, r) => a + r.noDuns, 0) : 0;
  const notReg = dq ? dq.plants.bySource.reduce((a, r) => a + r.dunsNotRegistered, 0) : 0;
  const blocks = dq?.plants.bySource.find((r) => r.source === "spl_establishment");

  return (
    <>
      <figure className="usl-fig">
        <svg
          className="usl-svg"
          viewBox="0 0 1040 622"
          role="img"
          aria-label="Nine USL tables. Three stock tables, one per hospital, each with a foreign key from ndc11 to product and from unit to unit_of_use. product reads FDA's NDC file and joins product_site on spl_set_id. product_site has a foreign key from est_duns to site; inspection has a foreign key from fei to site_fei. site and site_fei read FDA's registrations file."
        >
          <Fk from="stock_general" row={1} to="product" bus={343} />
          <Fk from="stock_east" row={1} to="product" bus={343} />
          <Fk from="stock_lakeside" row={1} to="product" bus={343} />
          <Fk from="stock_general" row={2} to="unit_of_use" bus={354} />
          <Fk from="stock_east" row={2} to="unit_of_use" bus={354} />
          <Fk from="stock_lakeside" row={2} to="unit_of_use" bus={354} />
          <Fk from="product_site" row={2} to="site" bus={708} side="left" />
          <Fk from="inspection" row={1} to="site_fei" bus={708} side="left" />
          <g className="usl-join">
            <path d={`M${B + W},${rowY(T("product"), 4)} H697 V${rowY(T("product_site"), 1)} H${C}`} />
            <text className="usl-fk__l" x={B + 8} y={T("product").y + height(T("product")) + 18}>
              joined on spl_set_id = set_id, not a key
            </text>
          </g>
          {TABLES.map((t) => (
            <Box key={t.name} t={t} />
          ))}
        </svg>

        <ul className="usl-list" aria-label="The semantic layer's tables">
          {TABLES.map((t) => (
            <li key={t.name} className={`usl-card ${SYS[t.sys].cls}`}>
              <p className="usl-card__h">
                <span className="hw-type">{t.name}</span>
                <span className="usl-card__sys">{SYS[t.sys].label}</span>
              </p>
              <ul>
                {t.rows.map((r) => (
                  <li key={r} className="hw-type">
                    {r.replace(" > ", " → ")}
                  </li>
                ))}
              </ul>
              <p className="usl-card__from hw-type">{t.sys === "usl" ? t.from : `reads ${t.from}`}</p>
            </li>
          ))}
        </ul>

        <figcaption className="usl-legend">
          {(Object.keys(SYS) as Sys[]).map((k) => (
            <span key={k} className={SYS[k].cls}>
              <i aria-hidden="true" />
              {SYS[k].label}
            </span>
          ))}
          <span className="usl-legend__k">
            <b className="hw-type">FK</b> a declared foreign key, which RUN DQ checks
          </span>
        </figcaption>
      </figure>

      <p className="hw-note">
        Lineage in the UI follows the same map: a query over <span className="hw-type">stock_east</span> is counted as a read of Corvale East&apos;s Postgres,
        not of &ldquo;the semantic layer&rdquo;. East and Lakeside also look each undashed NDC up in FDA&apos;s NDC file three ways (4-4-2, 5-3-2,
        5-4-1) and accept a reading only when exactly one is listed.
      </p>

      {dq ? (
        <>
          <div className="hw-two hw-two--tables">
            <div>
              <h3>The keys, as RUN DQ measured them</h3>
              <div className="hw-table-wrap" tabIndex={0} role="region" aria-label="RUN DQ results by rule">
                <table className="hw-table usl-dq">
                  <thead>
                    <tr>
                      <th scope="col">Rule</th>
                      <th scope="col" className="hw-num">
                        Rows
                      </th>
                      <th scope="col" className="hw-num">
                        Failing
                      </th>
                      <th scope="col">Query</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...fks, ...pks].map((r) => (
                      <tr key={`${r.table}.${r.column}`} className={r.invalid ? "is-fail" : undefined}>
                        <td className="hw-type" data-label="Rule">
                          {r.table}.{r.column} {/foreign/i.test(r.type) ? `→ ${r.references ?? (r.column === "unit" ? "unit_of_use.unit" : "product.ndc11")}` : "(PK)"}
                        </td>
                        <td className="hw-num" data-label="Rows">
                          {fmtInt(r.total)}
                        </td>
                        <td className="hw-num" data-label="Failing">
                          {fmtInt(r.invalid)} <span className="hw-muted">({pct(r.invalid, r.total)})</span>
                        </td>
                        <td className="hw-type hw-muted" data-label="Query">
                          {r.queryId}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="usl-facts">
              <h3>What the FDA-side keys say</h3>
              <p>
                <strong className="usl-big">{dq.plants.pctUnplaced}%</strong> of label plants are not in FDA&apos;s registration file: {fmtInt(dq.plants.unplaced)} of{" "}
                {fmtInt(dq.plants.total)} fail <span className="hw-type">product_site.est_duns {"→"} site.duns</span>. {fmtInt(noDuns)} are named without a DUNS
                (from the label&apos;s text or the application holder), and {fmtInt(notReg)} carry a DUNS the file does not list
                {blocks ? `, so ${fmtInt(blocks.placed)} of ${fmtInt(blocks.plants)} plants in labels' establishment blocks are placed` : ""}.
              </p>
              <p>
                <strong className="usl-big">{Math.round(dq.labels.pctNameNoPlant)}%</strong> of the {fmtInt(dq.labels.labels)} labels in the bundle name no plant at all, and{" "}
                {Math.round(dq.labels.pctListNoEstablishment)}% list none in the establishment block, so Upstream falls back to the label&apos;s text or the application
                holder and says so <span className="hw-type hw-muted">({dq.labels.queryId})</span>.
              </p>
              {(() => {
                const insp = rule(dq.rules, "inspection", "fei");
                return insp ? (
                  <p>
                    {pct(insp.invalid, insp.total)} of FDA&apos;s {fmtInt(insp.total)} drug inspections are of an FEI the registration file does not hold today (closed or
                    deregistered plants), so a plant&apos;s history is read by FEI from the inspection file, never through the registration join.
                  </p>
                ) : null;
              })()}
              <p>
                Units: every stock row is in a shared unit of use. East&apos;s package counts agree with FDA&apos;s for{" "}
                {(() => {
                  const e = dq.units.byHospital.find((u) => u.hospital === "Corvale East");
                  return e ? `${fmtInt(e.rows - e.pkgCountDiffers)} of ${fmtInt(e.rows)}` : "every";
                })()}{" "}
                rows; a unit that differs from FDA&apos;s package word (a hospital that counts &ldquo;vial&rdquo; for FDA&apos;s &ldquo;carton&rdquo;) is listed, not converted{" "}
                <span className="hw-type hw-muted">({dq.units.queryId})</span>.
              </p>
            </div>
          </div>
        </>
      ) : (
        <p className="hw-empty">The FDA-side key checks have not been run on this copy (npx tsx scripts/dq-fda.mts).</p>
      )}

      {explain ? (
        <div className="usl-plans">
          <h3>What Zetaris pushes down, from EXPLAIN</h3>
          <p className="hw-note">
            Recorded {explain.ranAt.slice(0, 10)}. A USL table is one scan in the plan of a query over it, so the third plan is the stock_east activation itself.
          </p>
          <ol>
            {explain.plans.map((p) => (
              <li key={p.name}>
                <p className="usl-plans__h">
                  <span className="hw-type">{p.name}</span> {p.what} <span className="hw-type hw-muted">{p.queryId}</span>
                </p>
                <pre tabIndex={0}>
                  {p.scans
                    .map((s) => `${s.kind === "jdbc" ? "JDBC scan" : s.kind === "usl" ? "USL scan " : "File scan"}  ${s.source}.${s.table}\n  pushed: [${s.pushedFilters.join(", ")}]${s.readSchema ? `\n  reads:  ${s.readSchema}` : ""}`)
                    .join("\n")}
                </pre>
              </li>
            ))}
          </ol>
          <p className="hw-note">
            The interchange query&apos;s NDC list reaches Corvale General&apos;s Postgres as a pushed filter, and every JDBC scan reads only the columns it needs. The stock
            query&apos;s molecule filter is not pushed into the hospitals: it runs in Zetaris over the three USL stock tables, which read each hospital&apos;s small
            stock_position view whole.
          </p>
        </div>
      ) : null}
    </>
  );
}
