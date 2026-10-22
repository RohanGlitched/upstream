// The overnight watch as a printed report on tractor-feed green-bar, and the run itself as a strip of
// chunks. Server-rendered from data/watch/latest.json, so the morning's numbers paint with the page.
import Link from "next/link";
import type { CSSProperties } from "react";
import { BoxStamp } from "../record/bits";
import { fmtInt, fmtMs } from "../lib/format";
import { drugTitle } from "../lib/drug";
import "./printout.css";

export interface Flag {
  molecule: string;
  display?: string;
  minDays: number | null;
  systemDays?: number | null;
  hospital: string;
  state: string;
  signal: string;
  headline: string;
  slug?: string;
}

export interface WatchRun {
  ranAt: string;
  asOf?: string;
  drugs: number;
  chunks: number;
  ms: number;
  queries?: number;
  tokens: { estimated?: number; measured?: number };
  brief?: string;
  briefModel?: string;
  flagged: Flag[];
  quiet: number;
  markovian?: { runs: number; batchSize: number; promptTokensMin: number; promptTokensMax: number };
}

function name(f: Flag): string {
  const d = (f.display ?? f.molecule).trim();
  const parts = d.split(/,\s*/);
  return drugTitle(parts.length > 3 ? `${parts.slice(0, 3).join(", ")} and others` : d);
}
const days = (d: number | null | undefined) => (d === null || d === undefined ? "  n/a" : (d < 10 ? d.toFixed(1) : String(Math.round(d))).padStart(5, " "));

export function ReportHead({ w }: { w: WatchRun }) {
  const act = w.flagged.filter((f) => f.state === "act").length;
  const watch = w.flagged.length - act;
  return (
    <div className="po po--head">
      <div className="po-holes po-holes--l" aria-hidden="true" />
      <div className="po-holes po-holes--r" aria-hidden="true" />
      <div className="po-in">
        <pre className="po-pre" aria-hidden="true">
          {`CORVALE HEALTH  DEPT OF PHARMACY            PAGE 1
OVERNIGHT FORMULARY WATCH            RUN ${w.ranAt.slice(0, 10)} ${w.ranAt.slice(11, 16)}
DATA AS OF ${w.asOf ?? w.ranAt.slice(0, 10)}   ${w.drugs} DRUGS   ${w.chunks} CHUNKS   ${w.queries ?? "-"} QUERIES
`}
        </pre>
        <dl className="po-counts">
          <div className="is-act">
            <dt>Act today</dt>
            <dd>{act}</dd>
          </div>
          <div className="is-watch">
            <dt>On watch</dt>
            <dd>{watch}</dd>
          </div>
          <div>
            <dt>Quiet</dt>
            <dd>{w.quiet}</dd>
          </div>
        </dl>
        {w.brief ? (
          <p className="po-brief">
            <span className="po-k">SUMMARY.</span> {w.brief}
          </p>
        ) : null}
        <p className="po-by">
          Summary typed by {w.briefModel?.replace(/^nvidia\//, "") ?? "the model"} from the flags; the flags themselves come from Zetaris queries.
        </p>
      </div>
    </div>
  );
}

export function ReportBody({ w, cases }: { w: WatchRun; cases: Set<string> }) {
  const act = w.flagged.filter((f) => f.state === "act").sort((a, b) => (a.minDays ?? 1e9) - (b.minDays ?? 1e9));
  const watch = w.flagged.filter((f) => f.state !== "act").sort((a, b) => (a.minDays ?? 1e9) - (b.minDays ?? 1e9));
  const slugOf = (f: Flag) => {
    if (f.slug && cases.has(f.slug)) return f.slug;
    const s = f.molecule.toLowerCase().match(/[a-z0-9-]+/)?.[0] ?? "";
    return cases.has(s) ? s : null;
  };
  const Row = ({ f, i }: { f: Flag; i: number }) => {
    const slug = slugOf(f);
    const low = f.minDays !== null && f.minDays < 7;
    return (
      <li className={`po-row${f.state === "act" ? " is-act" : ""}`} style={{ "--i": i } as CSSProperties}>
        <span className={`po-days${low ? " is-low" : ""}`}>{days(f.minDays)}</span>
        <span className="po-what">
          <b>{name(f)}</b>
          <span>
            {f.hospital.replace(/^Corvale /, "")}
            {typeof f.systemDays === "number" ? `, ${f.systemDays < 10 ? f.systemDays.toFixed(1) : Math.round(f.systemDays)} days system-wide` : ""}
          </span>
        </span>
        <span className="po-sig">{f.signal}</span>
        <span className="po-go">
          {slug ? (
            <Link href={`/case/${slug}`}>Open the file</Link>
          ) : (
            <Link href={`/desk?q=${encodeURIComponent(`Why is ${f.molecule} short, and what do we do?`)}`}>Ask</Link>
          )}
        </span>
      </li>
    );
  };
  return (
    <div className="po po--body">
      <div className="po-holes po-holes--l" aria-hidden="true" />
      <div className="po-holes po-holes--r" aria-hidden="true" />
      <div className="po-in">
        <h3 className="po-h">
          <BoxStamp tone="red">ACT TODAY</BoxStamp> <span>{act.length} drugs, shortest shelf first. On FDA&apos;s list or with an FDA action at a plant on our labels, and short on a shelf.</span>
        </h3>
        <div className="po-cols" aria-hidden="true">
          <span>DAYS</span>
          <span>DRUG, SHELF</span>
          <span>WHAT FDA HOLDS</span>
          <span />
        </div>
        <ol className="po-rows">
          {act.map((f, i) => (
            <Row key={f.molecule + i} f={f} i={i} />
          ))}
        </ol>
        <h3 className="po-h">
          <BoxStamp tone="amber">ON WATCH</BoxStamp> <span>{watch.length} drugs. A weaker signal, or stock that is fine for now.</span>
        </h3>
        <details className="po-more">
          <summary>Feed the next {watch.length} lines</summary>
          <ol className="po-rows">
            {watch.map((f, i) => (
              <Row key={f.molecule + i} f={f} i={i} />
            ))}
          </ol>
        </details>
        <pre className="po-end" aria-hidden="true">{`*** END OF REPORT ***   ${w.quiet} QUIET DRUGS NOT PRINTED`}</pre>
      </div>
    </div>
  );
}

export function RunStrip({ w }: { w: WatchRun }) {
  const m = w.markovian;
  const per = m?.batchSize ?? Math.ceil(w.drugs / Math.max(1, w.chunks));
  const flaggedPerChunk = Array.from({ length: w.chunks }, (_, i) => {
    const from = i * per;
    const to = Math.min(w.drugs, from + per);
    return { from, to, n: to - from };
  });
  return (
    <div className="strip">
      <ol className="strip-chunks" aria-label={`${w.chunks} chunks of ${per} drugs`}>
        {flaggedPerChunk.map((c, i) => (
          <li key={i} style={{ "--i": i } as CSSProperties}>
            <span className="strip-n">{String(i + 1).padStart(2, "0")}</span>
            <span className="strip-bar" style={{ "--h": `${(c.n / per) * 100}%` } as CSSProperties} />
            <span className="strip-c">{c.n}</span>
          </li>
        ))}
      </ol>
      <dl className="strip-facts">
        <div>
          <dt>Chunks</dt>
          <dd>
            {w.chunks} <small>of {per} drugs</small>
          </dd>
        </div>
        {m ? (
          <div>
            <dt>Prompt per chunk</dt>
            <dd>
              {m.promptTokensMin}&ndash;{m.promptTokensMax} <small>tokens, flat</small>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Zetaris queries</dt>
          <dd>{w.queries ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Wall time</dt>
          <dd>{fmtMs(w.ms)}</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>
            {fmtInt(w.tokens.measured || w.tokens.estimated || 0)} <small>{w.tokens.measured ? "measured" : "estimated"}</small>
          </dd>
        </div>
      </dl>
    </div>
  );
}
