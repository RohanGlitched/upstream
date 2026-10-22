// The overnight watch as a printed report on tractor-feed green-bar, and the run itself as a strip of
// chunks. Server-rendered from data/watch/latest.json, so the morning's numbers paint with the page.
import Link from "next/link";
import type { CSSProperties } from "react";
import { BoxStamp } from "../record/bits";
import { fmtInt, fmtMs } from "../lib/format";
import { productName, slugFor } from "../lib/drug";
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

/** The line as a buyer names the product ("Sterile water for injection", not "Water"). */
export function flagName(f: Flag): string {
  return productName(f.display ?? f.molecule);
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
        {/* The printer's header lines. Each field keeps together and wraps whole at phone width. */}
        <div className="po-pre" aria-hidden="true">
          <p>
            <span>CORVALE HEALTH</span> <span>DEPT OF PHARMACY</span> <span className="po-pre__r">PAGE 1</span>
          </p>
          <p>
            <span>OVERNIGHT FORMULARY WATCH</span>{" "}
            <span className="po-pre__r">
              RUN {w.ranAt.slice(0, 10)} {w.ranAt.slice(11, 16)}
            </span>
          </p>
          <p>
            <span>DATA AS OF {w.asOf ?? w.ranAt.slice(0, 10)}</span> <span>{w.drugs} DRUGS</span> <span>{w.chunks} CHUNKS</span> <span>{w.queries ?? "-"} QUERIES</span>
          </p>
        </div>
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
  // The recording's file is named for the whole molecule ("sterile-water"), or for its first word on older files.
  const slugOf = (f: Flag) => {
    if (f.slug && cases.has(f.slug)) return f.slug;
    const whole = slugFor(f.molecule);
    if (cases.has(whole)) return whole;
    const first = whole.split("-")[0];
    return cases.has(first) ? first : null;
  };
  const Row = ({ f, i }: { f: Flag; i: number }) => {
    const slug = slugOf(f);
    const low = f.minDays !== null && f.minDays < 7;
    return (
      <li className={`po-row${f.state === "act" ? " is-act" : ""}`} style={{ "--i": i } as CSSProperties}>
        <span className={`po-days${low ? " is-low" : ""}`}>{days(f.minDays)}</span>
        <span className="po-what">
          <b>{flagName(f)}</b>
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

/** The run as one square per drug checked, coloured by the verdict the watch reached. The squares fill in as
 *  the strip scrolls into view (where the browser supports scroll-driven animation; elsewhere it is drawn whole). */
export function RunStrip({ w }: { w: WatchRun }) {
  const m = w.markovian;
  const per = m?.batchSize ?? Math.ceil(w.drugs / Math.max(1, w.chunks));
  const act = w.flagged.filter((f) => f.state === "act").length;
  const watch = w.flagged.length - act;
  const quiet = Math.max(0, w.drugs - act - watch);
  const last = w.drugs - per * (w.chunks - 1);
  const cells = [...Array(act).fill("act"), ...Array(watch).fill("watch"), ...Array(quiet).fill("quiet")] as string[];
  return (
    <div className="strip">
      <figure className="strip-sheet">
        <ol className="strip-cells" role="img" aria-label={`${w.drugs} drugs checked: ${act} act today, ${watch} on watch, ${quiet} quiet`}>
          {cells.map((v, i) => (
            <li key={i} className={`is-${v}`} style={{ "--i": i } as CSSProperties} />
          ))}
        </ol>
        <figcaption className="strip-key">
          <span className="is-act">
            <i aria-hidden="true" /> {act} act today
          </span>
          <span className="is-watch">
            <i aria-hidden="true" /> {watch} on watch
          </span>
          <span className="is-quiet">
            <i aria-hidden="true" /> {quiet} quiet
          </span>
          <span className="strip-key__n">One square per drug, {w.drugs} in all, grouped by verdict</span>
        </figcaption>
      </figure>
      <dl className="strip-facts">
        <div>
          <dt>Chunks</dt>
          <dd>
            {w.chunks}{" "}
            <small>
              of {per} drugs{last > 0 && last !== per ? `, the last of ${last}` : ""}
            </small>
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
