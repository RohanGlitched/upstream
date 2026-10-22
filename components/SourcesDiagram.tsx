import type { DataQualityNote } from "../src/agent/types";
import { fmtInt } from "./lib/format";
import "./sources.css";

const TABLE_HOSPITAL: Record<string, string> = {
  stock_general: "Corvale General",
  stock_east: "Corvale East",
  stock_lakeside: "Corvale Lakeside",
};

export function SourcesDiagram({
  dq,
  fdaRows,
  fdaBuilt,
}: {
  dq: DataQualityNote[];
  fdaRows: number | null;
  fdaBuilt: string | null;
}) {
  const catchNote = dq.find((d) => d.invalid > 0 && /foreign/i.test(d.rule)) ?? dq.find((d) => d.invalid > 0);
  const where = catchNote ? TABLE_HOSPITAL[catchNote.table] ?? catchNote.table : null;
  return (
    <div className="flow">
      <ul className="flow-sources" aria-label="Where the data lives">
        <li className="src">
          <span className="src-kind">Postgres</span>
          <span className="src-name">Corvale General</span>
          <span className="src-note">Formulary, inventory snapshots, daily dispensing in vials</span>
        </li>
        <li className="src">
          <span className="src-kind">Postgres</span>
          <span className="src-name">Corvale East</span>
          <span className="src-note">Its own schema: items, stock in packages, weekly usage</span>
        </li>
        <li className={`src${where === "Corvale Lakeside" ? " src--catch" : ""}`}>
          <span className="src-kind">CSV files</span>
          <span className="src-name">Corvale Lakeside</span>
          <span className="src-note">No database: cabinet exports land nightly in object storage</span>
        </li>
        <li className="src src--fda">
          <span className="src-kind">Public files</span>
          <span className="src-name">FDA, 12 files and openFDA labels</span>
          <span className="src-note">
            {fdaRows ? `${fmtInt(fdaRows)} rows` : "NDC directory, labels"}: NDCs, plants on labels, registrations,
            inspections, Form 483s, warning letters, import alerts, recalls, shortages
            {fdaBuilt ? `, read ${fdaBuilt}` : ""}
          </span>
        </li>
      </ul>

      <div className="flow-hub" aria-label="Zetaris">
        <div className="hub">
          <span className="hub-name">Zetaris</span>
          <p>Queries each source where it lives, over JDBC and in-place file tables. Nothing is copied.</p>
          <div className="hub-usl">
            <span className="hub-usl__name">Unified Semantic Layer</span>
            <p>One model over the three hospitals and FDA. Its foreign keys become data-quality rules.</p>
            <ul>
              <li>stock NDC must be an FDA product</li>
              <li>a label&apos;s plant must be a registered site</li>
              <li>an inspection must name a site we can place</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flow-out">
        <div className="out">
          <span className="hub-name">Upstream</span>
          <p>Asks the semantic layer, cites every row it uses by query id, and builds the trace.</p>
        </div>
      </div>
      {catchNote ? (
          <div className="catch">
            <span className="tag tag--ink">Data-quality rule</span>
            <p>
              <strong className="num">
                {catchNote.invalid} of {catchNote.total}
              </strong>{" "}
              {where} cabinet rows carry an NDC that FDA doesn&apos;t list. Upstream reports them by name and leaves
              them out of the stock counts, instead of guessing which product they meant.
            </p>
          </div>
        ) : null}
    </div>
  );
}
