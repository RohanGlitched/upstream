"use client";

// Nemotron alone against Upstream, as a graded answer sheet. Two papers answer the same questions about the same
// products; ground truth comes from separate code over FDA's raw files. Red is the grader's pen on a wrong answer,
// carbon blue is what Upstream read from FDA. Pass `data` for a complete first paint; without it, /api/eval is fetched.
import { useState } from "react";
import { useApi } from "./lib/useApi";
import { fmtDate, fmtMs } from "./lib/format";
import { drugTitle } from "./lib/drug";
import "./backtest.css";

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

interface BaselineRow {
  drug: string;
  labeler: string;
  said?: { plant?: string | null; city?: string | null; country?: string | null; fei?: string | null; classification?: string | null; end_date?: string | null; confident?: boolean };
  plantOk?: boolean;
  feiOk?: boolean;
  classOk?: boolean;
  dateOk?: boolean;
  inventedDate?: boolean;
  confident?: boolean;
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

export function isEval(x: unknown): x is EvalTrace {
  const o = x as EvalTrace;
  return Boolean(o && o.summary && o.summary.upstream && Array.isArray(o.rows));
}

/** "52/59 (88%)" -> {n:52, d:59} */
function ratio(s: string | undefined | null): { n: number; d: number } | null {
  const m = s ? /(\d+)\s*\/\s*(\d+)/.exec(s) : null;
  return m ? { n: Number(m[1]), d: Number(m[2]) } : null;
}

function lastText(s: string | null | undefined): string {
  if (!s) return "none on file";
  const m = /^([A-Z]{3})\s+(\d{4}-\d{2}-\d{2})$/.exec(s);
  return m ? `${m[1]}, ${fmtDate(m[2])}` : s;
}

function firm(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name;
}

/** A row of grader's marks: one tick or cross per question. */
function Marks({ r, tone }: { r: { n: number; d: number } | null; tone: "up" | "base" }) {
  if (!r) return <span className="evg-na">Not measured</span>;
  const items = [];
  for (let i = 0; i < r.d; i++) items.push(<i key={i} className={i < r.n ? "ok" : "no"} />);
  return (
    <span className={`evg-marks evg-marks--${tone}`} role="img" aria-label={`${r.n} of ${r.d} right`}>
      {items}
    </span>
  );
}

function Line({ k, r, tone }: { k: string; r: { n: number; d: number } | null; tone: "up" | "base" }) {
  return (
    <li className="evg-line">
      <span className="evg-k">{k}</span>
      <span className={`evg-score${r && r.n === 0 ? " is-zero" : ""}`}>
        {r ? (
          <>
            <strong>{r.n}</strong>
            <span>/{r.d}</span>
          </>
        ) : (
          "n/a"
        )}
      </span>
      <Marks r={r} tone={tone} />
    </li>
  );
}

function Sheet({ data, full }: { data: EvalTrace; full: boolean }) {
  const [all, setAll] = useState(false);
  const { summary, rows } = data;
  const b = summary.baseline;
  const up = summary.upstream;
  const nFei = rows.filter((r) => r.upstreamFei).length;
  const base = (data.baseline ?? []) as BaselineRow[];
  const byKey = new Map(base.map((x) => [`${x.drug}|${x.labeler}`, x]));
  const seen = new Set<string>();
  const paired = rows.filter((r) => {
    const k = `${r.drug}|${r.labeler}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const shown = all ? paired : paired.slice(0, 8);
  const model = b?.model ? b.model.replace(/^nvidia\//, "") : "nemotron-3-ultra";

  return (
    <div className="evg">
      <div className="evg-pair">
        <article className="evg-paper evg-paper--base" aria-labelledby="evg-base">
          <header className="evg-paper__head">
            <div>
              <span className="evg-field">Name</span>
              <h3 id="evg-base" className="evg-type">
                {model}
              </h3>
            </div>
            <div>
              <span className="evg-field">Tools</span>
              <span className="evg-type">none, answering from memory</span>
            </div>
          </header>
          <ul className="evg-lines">
            <Line k="Named the right plant" r={ratio(b?.plantNamed)} tone="base" />
            <Line k="Gave the plant's FEI" r={ratio(b?.feiCorrect)} tone="base" />
            <Line k="Right last classification" r={ratio(b?.classificationCorrect)} tone="base" />
            <Line k="Right inspection date" r={ratio(b?.dateCorrect)} tone="base" />
          </ul>
          {b ? (
            <p className="evg-note">
              Said it was confident {b.saidConfident ?? "every"} times out of {b.pairs ?? "every"}
              {typeof b.inventedDates === "number" ? `, and gave ${b.inventedDates} inspection dates that are not in FDA's file` : ""}.
            </p>
          ) : (
            <p className="evg-note">The no-tools baseline has not been published to this copy yet.</p>
          )}
          {b ? (
            <span className="evg-stamp evg-stamp--red" aria-hidden="true">
              Not on FDA&apos;s record
            </span>
          ) : null}
        </article>

        <article className="evg-paper evg-paper--up" aria-labelledby="evg-up">
          <header className="evg-paper__head">
            <div>
              <span className="evg-field">Name</span>
              <h3 id="evg-up" className="evg-type">
                Upstream
              </h3>
            </div>
            <div>
              <span className="evg-field">Tools</span>
              <span className="evg-type">
                FDA through Zetaris{summary.zetaris ? `, ${summary.zetaris.queries} queries in ${fmtMs(summary.zetaris.ms)}` : ""}
              </span>
            </div>
          </header>
          <ul className="evg-lines">
            <Line k="Found the plant on the label" r={ratio(up.plantFound)} tone="up" />
            <Line k="Placed it by FEI" r={rows.length ? { n: nFei, d: rows.length } : null} tone="up" />
            <Line k="Right last inspection" r={ratio(up.lastInspectionMatch)} tone="up" />
            <Line k="Right inspection date" r={ratio(up.lastInspectionMatch)} tone="up" />
          </ul>
          <p className="evg-note">
            {summary.truthRows} product and plant pairs across {summary.drugs} drugs. Every answer cites the FDA row it came
            from, so a miss can be checked rather than trusted.
          </p>
          <span className="evg-stamp evg-stamp--blue" aria-hidden="true">
            Checked against FDA
          </span>
        </article>
      </div>
      <p className="evg-truth">
        Ground truth comes from separate Python code over FDA&apos;s raw files, not from Upstream&apos;s queries.
        {summary.ranAt ? ` Marked ${fmtDate(summary.ranAt)}.` : ""}
      </p>

      {full && paired.length ? (
        <div className="evg-sheet">
          <header className="evg-sheet__head">
            <h3>The answer sheet, marked</h3>
            <p>
              Each product once. Struck through in red: what the model said that FDA&apos;s file does not show. In blue: what
              Upstream read from FDA.
            </p>
          </header>
          <div className="evg-table" role="table" aria-label="Answers by product">
            <div className="evg-tr evg-tr--h" role="row">
              <span role="columnheader">Product and labeler</span>
              <span role="columnheader">Nemotron, from memory</span>
              <span role="columnheader">FDA&apos;s record</span>
              <span role="columnheader">Upstream</span>
            </div>
            {shown.map((r, i) => {
              const s = byKey.get(`${r.drug}|${r.labeler}`);
              const said = s?.said;
              return (
                <div className="evg-tr" role="row" key={i}>
                  <span role="cell" className="evg-prod">
                    <strong>{drugTitle(r.drug.replace(/\s+(injection|tablet|capsule|solution).*$/i, ""))}</strong>
                    <span>{r.labeler}</span>
                  </span>
                  <span role="cell" className="evg-said">
                    {said ? (
                      <>
                        <span className={s?.plantOk ? "is-ok" : "is-x"}>{said.plant ? firm(said.plant) : "no plant named"}</span>
                        <span className={`evg-type ${s?.feiOk ? "is-ok" : "is-x"}`}>FEI {said.fei ?? "none"}</span>
                        <span className="evg-said__last">
                          <span className={s?.classOk ? "is-ok" : "is-x"}>{said.classification ?? "?"}</span>,{" "}
                          <span className={s?.dateOk ? "is-ok" : "is-x"}>{said.end_date ? fmtDate(said.end_date) : "no date"}</span>
                          {s?.inventedDate ? <em className="evg-margin">no such inspection</em> : null}
                        </span>
                      </>
                    ) : (
                      <span className="evg-na">Not asked</span>
                    )}
                  </span>
                  <span role="cell" className="evg-truthc">
                    <span>{firm(r.plant)}</span>
                    {r.fei ? <span className="evg-type">FEI {r.fei}</span> : null}
                    <span>{lastText(r.truthLast)}</span>
                  </span>
                  <span role="cell" className={`evg-upc${r.lastMatch ? "" : " is-miss"}`}>
                    <span className="evg-tick" aria-hidden="true" />
                    <span>{r.upstreamFei ? lastText(r.upstreamLast) : "Plant not found"}</span>
                    {!r.lastMatch ? <em className="evg-margin">differs</em> : null}
                  </span>
                </div>
              );
            })}
          </div>
          {paired.length > 8 ? (
            <button type="button" className="evg-more" onClick={() => setAll((a) => !a)} aria-expanded={all}>
              {all ? "Show the first 8" : `Show all ${paired.length} products`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Fetch({ full }: { full: boolean }) {
  const s = useApi<EvalTrace>("/api/eval", isEval);
  if (s.status === "ready") return <Sheet data={s.data} full={full} />;
  if (s.status === "loading") {
    return (
      <div className="evg evg--loading" aria-busy="true" aria-label="Loading the accuracy check">
        <div className="evg-pair">
          <div className="evg-paper" />
          <div className="evg-paper" />
        </div>
      </div>
    );
  }
  return (
    <div className="evg-missing">
      <h3>{s.status === "error" ? "The accuracy check did not load" : "The accuracy check is not on this copy yet"}</h3>
      <p>
        {s.status === "error"
          ? s.message
          : "It compares Upstream's trace with ground truth computed separately from FDA's raw files, and with the same model answering from memory."}
      </p>
    </div>
  );
}

export function EvalCompare({ full = false, data }: { full?: boolean; data?: EvalTrace | null }) {
  return data ? <Sheet data={data} full={full} /> : <Fetch full={full} />;
}
