"use client";

import { useState } from "react";
import { useApi } from "./lib/useApi";
import { fmtDate, fmtMs } from "./lib/format";
import { drugTitle } from "./lib/drug";
import "./eval.css";

interface EvalRow {
  drug: string;
  labeler: string;
  plant: string;
  fei: string | null;
  posted: string | null;
  upstreamFei: boolean;
  truthLast: string | null;
  upstreamLast: string | null;
  lastMatch: boolean;
}

interface Baseline {
  model?: string;
  pairs?: number;
  plantNamed?: string;
  feiCorrect?: string;
  classificationCorrect?: string;
  dateCorrect?: string;
  inventedDates?: number;
  saidConfident?: number;
}

export interface EvalTrace {
  summary: {
    ranAt?: string;
    truthRows: number;
    drugs: number;
    zetaris?: { queries: number; ms: number };
    upstream: { plantFound: string; lastInspectionMatch: string };
    baseline: Baseline | null;
  };
  rows: EvalRow[];
  baseline?: unknown[];
}

function isEval(x: unknown): x is EvalTrace {
  const o = x as EvalTrace;
  return Boolean(o && o.summary && o.summary.upstream && Array.isArray(o.rows));
}

/** "52/59 (88%)" -> {n:52, d:59, share:0.88} */
function ratio(s: string | undefined | null): { n: number; d: number; share: number; text: string } | null {
  if (!s) return null;
  const m = /(\d+)\s*\/\s*(\d+)/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const d = Number(m[2]);
  return { n, d, share: d ? n / d : 0, text: `${n} of ${d}` };
}

function Bar({ r, tone }: { r: ReturnType<typeof ratio>; tone: "up" | "base" }) {
  if (!r) return <span className="ev-bar ev-bar--na">Not measured yet</span>;
  return (
    <span className={`ev-bar ev-bar--${tone}`}>
      <span className="ev-bar__track" aria-hidden="true">
        <span style={{ width: `${Math.max(r.share * 100, r.n ? 1.5 : 0)}%` }} />
      </span>
      <span className="ev-bar__v num">
        <strong>{Math.round(r.share * 100)}%</strong> <span className="muted">{r.text}</span>
      </span>
    </span>
  );
}

function lastText(s: string | null): string {
  if (!s) return "none on file";
  const m = /^([A-Z]{3})\s+(\d{4}-\d{2}-\d{2})$/.exec(s);
  return m ? `${m[1]}, ${fmtDate(m[2])}` : s;
}

export function EvalCompare({ full = false }: { full?: boolean }) {
  const s = useApi<EvalTrace>("/api/eval", isEval);
  const [all, setAll] = useState(false);

  if (s.status === "loading") {
    return (
      <div className="evc" aria-busy="true" aria-label="Loading the accuracy check">
        <div className="evc-grid">
          {[0, 1].map((i) => (
            <div className="evc-col" key={i}>
              <span className="skel" style={{ width: 160, height: 18 }} />
              {[0, 1, 2, 3].map((j) => (
                <span key={j} className="skel skel-line" style={{ width: "90%", height: 16, marginTop: 22 }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (s.status !== "ready") {
    return (
      <div className={`notice${s.status === "error" ? " notice--error" : ""}`}>
        <span className="notice__mark" aria-hidden="true">{s.status === "error" ? "!" : "i"}</span>
        <h3>{s.status === "error" ? "The accuracy check did not load" : "The accuracy check is not on this copy yet"}</h3>
        <p>
          {s.status === "error"
            ? s.message
            : "It compares Upstream's trace with ground truth computed separately from FDA's raw files, and with the same model answering from memory."}
        </p>
      </div>
    );
  }

  const { summary, rows } = s.data;
  const b = summary.baseline;
  const up = summary.upstream;
  const nFei = rows.filter((r) => r.upstreamFei).length;
  const feiUp = rows.length ? { n: nFei, d: rows.length, share: nFei / rows.length, text: `${nFei} of ${rows.length}` } : ratio(up.plantFound);
  const lines: { k: string; up: ReturnType<typeof ratio>; base: ReturnType<typeof ratio> }[] = [
    { k: "Named the right plant", up: ratio(up.plantFound), base: ratio(b?.plantNamed) },
    { k: "Gave the plant's FEI number", up: feiUp, base: ratio(b?.feiCorrect) },
    { k: "Right last inspection classification", up: ratio(up.lastInspectionMatch), base: ratio(b?.classificationCorrect) },
    { k: "Right inspection date", up: ratio(up.lastInspectionMatch), base: ratio(b?.dateCorrect) },
  ];
  const shown = all ? rows : rows.slice(0, 8);

  return (
    <div className="evc">
      <div className="evc-grid">
        <div className="evc-col evc-col--base">
          <h3 className="evc-h">
            {b?.model ? b.model.replace(/^nvidia\//, "") : "Nemotron Ultra"}, answering alone
          </h3>
          <p className="evc-sub">The same model, asked which plant makes each product and what FDA found there, with no tools.</p>
          <ul className="evc-lines">
            {lines.map((l) => (
              <li key={l.k}>
                <span className="evc-k">{l.k}</span>
                {b ? <Bar r={l.base} tone="base" /> : <span className="ev-bar ev-bar--na">Being run</span>}
              </li>
            ))}
          </ul>
          {b ? (
            <p className="evc-foot">
              It said it was confident {b.saidConfident ?? "every"} times out of {b.pairs ?? "every"}
              {typeof b.inventedDates === "number" ? `, and gave ${b.inventedDates} inspection dates that do not exist` : ""}.
            </p>
          ) : (
            <p className="evc-foot">The no-tools baseline has not been published to this copy yet.</p>
          )}
        </div>
        <div className="evc-col evc-col--up">
          <h3 className="evc-h">Upstream, reading FDA through Zetaris</h3>
          <p className="evc-sub">
            The trace&apos;s own answer for {summary.truthRows} product-plant pairs across {summary.drugs} drugs
            {summary.zetaris ? `, ${summary.zetaris.queries} queries in ${fmtMs(summary.zetaris.ms)}` : ""}.
          </p>
          <ul className="evc-lines">
            {lines.map((l) => (
              <li key={l.k}>
                <span className="evc-k">{l.k}</span>
                <Bar r={l.up} tone="up" />
              </li>
            ))}
          </ul>
          <p className="evc-foot">Every answer cites the FDA row it came from, so a miss can be checked rather than trusted.</p>
        </div>
      </div>
      <p className="evc-truth small muted">
        Ground truth comes from separate Python code over FDA&apos;s raw files, not from Upstream&apos;s queries.
        {summary.ranAt ? ` Run ${fmtDate(summary.ranAt)}.` : ""}
      </p>

      {full && rows.length ? (
        <div className="evc-rows">
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Upstream against ground truth, product by product</caption>
              <thead>
                <tr>
                  <th scope="col">Drug and labeler</th>
                  <th scope="col">Plant on the label</th>
                  <th scope="col">FDA&apos;s last inspection</th>
                  <th scope="col">Upstream said</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <span className="strong">{drugTitle(r.drug.replace(/\s+injection.*$/i, ""))}</span>
                      <span className="muted small evc-block">{r.labeler}</span>
                    </td>
                    <td>
                      {r.plant}
                      {r.fei ? <span className="muted small evc-block num">FEI {r.fei}</span> : null}
                    </td>
                    <td className="num">{lastText(r.truthLast)}</td>
                    <td className="num">{r.upstreamFei ? lastText(r.upstreamLast) : "Plant not found"}</td>
                    <td>
                      {r.lastMatch ? (
                        <span className="tag tag--outline">Matches</span>
                      ) : (
                        <span className="tag tag--ink">Differs</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 8 ? (
            <button type="button" className="btn btn--small evc-more" onClick={() => setAll((a) => !a)} aria-expanded={all}>
              {all ? "Show the first 8" : `Show all ${rows.length} pairs`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
