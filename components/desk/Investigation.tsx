"use client";

// The ask box as a typed request slip. While Upstream works, each step it finishes is filed as a card in
// the open folder; when the answer arrives, the folder is laid out on the desk as the full record.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Case, Step } from "../../src/agent/types";
import { EvidenceProvider } from "../Evidence";
import { RecordDesk } from "../record/RecordDesk";
import { buildDesk } from "../record/model";
import { BoxStamp, Stamp } from "../record/bits";
import { drugTitle, slugFor, tallText } from "../lib/drug";
import { fmtDate, fmtMs, plural } from "../lib/format";
import { dataSystems } from "../lib/sources";
import { lineageLine } from "../../src/lib/lineage";
import { EXAMPLES } from "../examples";
import "./investigation.css";

type Mode = "live" | "replay";
type Saved = Case & { slug?: string };

interface Clarify {
  question: string | null;
  options: { label: string; intent: string }[];
  term: string | null;
  generic: string | null;
  onFormulary: boolean;
  suggestions: string[];
}

/** The overnight report, cut down to what the desk says when a buyer asks for the morning brief. */
export interface BriefSummary {
  ranAt: string;
  drugs: number;
  act: number;
  watch: number;
  quiet: number;
  brief: string | null;
  top: { name: string; days: number | null; hospital: string; slug: string | null }[];
}

interface Decision {
  intent: string;
  risk: string;
  reason: string | null;
  clarification: string | null;
  contractId?: string | null;
}

type Run =
  | { k: "idle" }
  | { k: "running"; q: string; decision: Decision | null; steps: Step[]; mode: Mode | null; t0: number }
  | { k: "done"; q: string; decision: Decision | null; steps: Step[]; mode: Mode; c: Saved; t0: number; t1: number }
  | { k: "refused"; q: string; decision: Decision | null; reason: string }
  | { k: "clarify"; q: string; decision: Decision | null; ask: Clarify }
  | { k: "brief"; q: string; decision: Decision | null }
  | { k: "unrecorded"; q: string; decision: Decision | null; drug: string; reason: string }
  | { k: "error"; q: string; message: string };

// Scout's clarification offers intents; each becomes a question a buyer could file.
const ASK_FOR: Record<string, string> = {
  "shortage.investigate": "Why is carboplatin short, and what do we do?",
  "stock.days_on_hand": "How many days of propofol do we have left?",
  "memory.recall_decisions": "What did we decide last time heparin was short?",
};

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// A finished answer is kept for the tab's session, so Back from the full file puts it straight back on the desk.
const KEEP = "upstream.desk.";
function keep(run: Extract<Run, { k: "done" }>) {
  try {
    window.sessionStorage.setItem(KEEP + run.q, JSON.stringify({ decision: run.decision, steps: run.steps, mode: run.mode, c: run.c }));
  } catch {
    /* a full or blocked store only costs a replay */
  }
}
function kept(q: string): Extract<Run, { k: "done" }> | null {
  try {
    const raw = window.sessionStorage.getItem(KEEP + q);
    if (!raw) return null;
    const v = JSON.parse(raw) as { decision: Decision | null; steps: Step[]; mode: Mode; c: Saved };
    return { k: "done", q, decision: v.decision, steps: v.steps, mode: v.mode, c: v.c, t0: 0, t1: 0 };
  } catch {
    return null;
  }
}

function StepCard({ s, i, total }: { s: Step; i: number; total: number | null }) {
  return (
    <li className={`inv-card inv-card--${s.status}`} style={{ "--i": i, "--r": `${((i * 37) % 7) * 0.25 - 0.75}deg` } as CSSProperties}>
      <div className="inv-card__top">
        <span className="inv-card__n">
          {String(i + 1).padStart(2, "0")}
          {total ? ` of ${total}` : ""}
        </span>
        <BoxStamp tone={s.status === "ok" ? "carbon" : "amber"} tilt={-3}>
          {s.status === "ok" ? "FILED" : s.status.toUpperCase()}
        </BoxStamp>
      </div>
      <h4>{s.title}</h4>
      <p className="inv-card__f">{tallText(s.finding)}</p>
      <p className="inv-card__m">
        {s.queryIds.length ? lineageLine(dataSystems(s.sources).length, s.queryIds.length, s.ms) : fmtMs(s.ms)}, {s.rows.toLocaleString("en-US")} rows
        {s.queryIds.length ? `, ${s.queryIds.slice(0, 3).join(" ")}` : ""}
      </p>
    </li>
  );
}

export function Investigation({ initial, onFile, date, brief }: { initial?: string; onFile?: number; date?: string; brief?: BriefSummary | null }) {
  const params = useSearchParams();
  const urlQ = params.get("q")?.slice(0, 400) ?? initial ?? "";
  const [q, setQ] = useState(urlQ);
  const [run, setRun] = useState<Run>({ k: "idle" });
  const ctl = useRef<AbortController | null>(null);
  const last = useRef<string | null>(null);
  const live = useRef<HTMLDivElement>(null);

  const go = useCallback(async (question: string, opts: { restore?: boolean } = {}) => {
    const text = question.trim();
    if (!text) return;
    last.current = text;
    ctl.current?.abort();
    if (opts.restore) {
      const done = kept(text);
      if (done) {
        setRun(done);
        return;
      }
    }
    const ac = new AbortController();
    ctl.current = ac;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("q", text);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* the address bar is a convenience only */
    }
    let decision: Decision | null = null;
    const steps: Step[] = [];
    let mode: Mode | null = null;
    const t0 = performance.now();
    setRun({ k: "running", q: text, decision, steps: [], mode, t0 });
    requestAnimationFrame(() => live.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const r = await fetch("/api/investigate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
        signal: ac.signal,
      });
      if (!r.ok || !r.body) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        setRun({ k: "error", q: text, message: body?.error ?? `The server answered ${r.status}.` });
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let m: Record<string, unknown>;
          try {
            m = JSON.parse(line);
          } catch {
            continue;
          }
          switch (m.type) {
            case "decision":
              decision = {
                intent: String(m.intent),
                risk: String(m.risk),
                reason: (m.reason as string) ?? null,
                clarification: (m.clarification as string) ?? null,
                contractId: (m.contractId as string) ?? null,
              };
              setRun({ k: "running", q: text, decision, steps: [...steps], mode, t0 });
              break;
            case "step":
              steps.push(m.step as Step);
              mode = (m.mode as Mode) ?? mode;
              setRun({ k: "running", q: text, decision, steps: [...steps], mode, t0 });
              break;
            case "case": {
              finished = true;
              const done: Extract<Run, { k: "done" }> = { k: "done", q: text, decision, steps: [...steps], mode: (m.mode as Mode) ?? mode ?? "replay", c: m.case as Saved, t0, t1: performance.now() };
              setRun(done);
              keep(done);
              break;
            }
            case "clarify":
              finished = true;
              setRun({ k: "clarify", q: text, decision, ask: m as unknown as Clarify });
              break;
            case "brief":
              finished = true;
              setRun({ k: "brief", q: text, decision });
              break;
            case "refused":
              finished = true;
              setRun({ k: "refused", q: text, decision, reason: String(m.reason) });
              break;
            case "unrecorded":
              finished = true;
              setRun({ k: "unrecorded", q: text, decision, drug: String(m.drug ?? ""), reason: String(m.reason) });
              break;
            case "error":
              finished = true;
              setRun({ k: "error", q: text, message: String(m.message) });
              break;
          }
        }
      }
      if (!finished) setRun({ k: "error", q: text, message: "The stream ended before Upstream sent an answer." });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setRun({ k: "error", q: text, message: "The request did not reach the server. Check the connection and try again." });
    }
  }, []);

  // Start (or put back) the question in the address bar whenever it changes: on arrival, and on Back from the
  // full file. The timer survives React's double-invoked effects in development: the first is cleared before it
  // fires, the second runs. A question this desk filed itself is already running and is not filed twice.
  useEffect(() => {
    if (!urlQ || urlQ === last.current) return;
    const t = window.setTimeout(() => {
      setQ(urlQ);
      go(urlQ, { restore: true });
    }, 0);
    return () => window.clearTimeout(t);
  }, [urlQ, go]);

  const busy = run.k === "running";
  const today = date ? fmtDate(date).toUpperCase() : "";
  const ask = (text: string) => {
    setQ(text);
    go(text);
  };

  return (
    <div className="inv">
      <form
        className={`inv-slip${run.k === "refused" || run.k === "clarify" ? " is-stamped" : ""}`}
        aria-labelledby="inv-slip-h"
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
      >
        <div className="inv-slip__head">
          <h2 id="inv-slip-h">Request for investigation</h2>
          <span className="inv-slip__no">Form UP-2</span>
        </div>
        <div className="inv-slip__grid">
          <div>
            <span className="inv-fl">From</span>
            <span className="inv-fv">Pharmacy purchasing</span>
          </div>
          {today ? (
            <div>
              <span className="inv-fl">Date</span>
              <span className="inv-fv">{today}</span>
            </div>
          ) : null}
          <div>
            <span className="inv-fl">Answer by</span>
            <span className="inv-fv">Upstream, with every row cited</span>
          </div>
        </div>
        <label htmlFor="desk-q" className="inv-q">
          <span className="inv-q__q" aria-hidden="true">
            Q.
          </span>
          <span className="sr-only">Your question</span>
          <textarea
            id="desk-q"
            value={q}
            rows={2}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                go(q);
              }
            }}
            placeholder="Why is carboplatin short, and what do we do?"
            autoComplete="off"
            maxLength={400}
            required
          />
        </label>
        <div className="inv-slip__foot">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Investigating" : "File the request"}
          </button>
          <span className="inv-slip__note">Scout reads it first. It answers why and what to do; it refuses orders, stock changes and dosing advice.</span>
        </div>
        {run.k === "refused" ? <Stamp className="inv-stamp" tone="red" big="REFUSED" bottom="NO CONTRACT ISSUED" top="SCOUT" w={190} h={96} /> : null}
        {run.k === "clarify" ? <Stamp className="inv-stamp" tone="amber" big="CLARIFY" bottom="NO CONTRACT YET" top="SCOUT ASKS" w={190} h={96} /> : null}
      </form>

      <div className="inv-recent">
        <p className="inv-recent__h">Requests a buyer filed this week</p>
        <ul>
          {EXAMPLES.map((x) => (
            <li key={x}>
              <a
                href={`/desk?q=${encodeURIComponent(x)}`}
                onClick={(e) => {
                  e.preventDefault();
                  ask(x);
                }}
              >
                {x}
              </a>
            </li>
          ))}
        </ul>
        {onFile ? (
          <p className="inv-recent__n">
            {onFile} drugs have a recorded investigation on this copy. <Link href="/case">See the cabinet</Link>.
          </p>
        ) : null}
      </div>

      <div ref={live} className="inv-out" aria-live="polite" aria-busy={busy}>
        {run.k === "running" || run.k === "done" ? <Folder run={run} /> : null}

        {run.k === "unrecorded" ? (
          <div className="notice">
            <span className="notice__mark" aria-hidden="true">i</span>
            <h3>{run.drug ? `No recording for ${drugTitle(run.drug)} on this copy` : "No recording for this question"}</h3>
            <p>
              {run.reason} <Link href="/case">See the drugs on file</Link>.
            </p>
          </div>
        ) : null}

        {run.k === "clarify" ? <ClarifyNote ask={run.ask} onAsk={ask} /> : null}

        {run.k === "brief" ? <BriefNote b={brief ?? null} /> : null}

        {run.k === "refused" ? (
          <div className="notice notice--error">
            <span className="notice__mark" aria-hidden="true">!</span>
            <h3>Scout refused this request</h3>
            <p>{run.reason}</p>
          </div>
        ) : null}

        {run.k === "error" ? (
          <div className="notice notice--error">
            <span className="notice__mark" aria-hidden="true">!</span>
            <h3>The investigation stopped</h3>
            <p>
              {run.message}{" "}
              <button type="button" className="btn btn--quiet btn--small" onClick={() => go(run.q)}>
                Run it again
              </button>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Folder({ run }: { run: Extract<Run, { k: "running" } | { k: "done" }> }) {
  const done = run.k === "done";
  const total = done ? run.steps.length : null;
  // The recording's own file name is the address of its page; a live answer falls back to the molecule's.
  const model = useMemo(() => (run.k === "done" ? buildDesk(run.c, run.c.slug ?? slugFor(run.c.molecule)) : null), [run]);
  const ms = run.steps.reduce((a, s) => a + s.ms, 0);
  return (
    <div className={`inv-folder${done ? " is-done" : ""}`}>
      <div className="inv-folder__tab">
        <span>{run.q}</span>
      </div>
      <div className="inv-folder__body">
        <div className="inv-folder__head">
          {run.decision ? (
            <div className="inv-contract">
              <BoxStamp tone="carbon" tilt={-2}>
                CONTRACT ISSUED
              </BoxStamp>
              <span>
                Scout read this as <b>{run.decision.intent}</b>, {run.decision.risk} risk
                {run.decision.contractId ? <>, contract {run.decision.contractId.slice(-8)}</> : null}
              </span>
            </div>
          ) : (
            <div className="inv-contract is-wait">Scout is reading the request</div>
          )}
          {run.mode ? (
            <span className={`mode${run.mode === "live" ? " mode--live" : ""}`}>{run.mode === "live" ? "Live: querying Zetaris now" : "Replay of a recorded investigation"}</span>
          ) : null}
        </div>
        {done ? (
          <details className="inv-filed">
            <summary>
              {run.steps.length} documents filed, {fmtMs(ms)} of queries
            </summary>
            <ol className="inv-cards">
              {run.steps.map((s, i) => (
                <StepCard key={i} s={s} i={i} total={total} />
              ))}
            </ol>
          </details>
        ) : (
          <ol className="inv-cards">
            {run.steps.map((s, i) => (
              <StepCard key={i} s={s} i={i} total={null} />
            ))}
            <li className="inv-card inv-card--pending" aria-label="The next step is running" style={{ "--i": run.steps.length } as CSSProperties}>
              <div className="inv-card__top">
                <span className="inv-card__n">{String(run.steps.length + 1).padStart(2, "0")}</span>
              </div>
              <p className="inv-typing">
                Reading<span className="inv-caret" aria-hidden="true" />
              </p>
            </li>
          </ol>
        )}
      </div>
      {done && model ? (
        <div className="inv-result">
          <EvidenceProvider evidence={run.c.evidence} queries={run.c.queries}>
            <RecordDesk m={model} as="h2" lede={null} signHref={run.mode === "replay" ? `/case/${model.slug}#memo` : undefined}>
              {run.mode === "replay" ? (
                <Link href={`/case/${model.slug}`} className="rd-go">
                  Open the full file
                </Link>
              ) : null}
            </RecordDesk>
          </EvidenceProvider>
        </div>
      ) : null}
    </div>
  );
}

function ClarifyNote({ ask, onAsk }: { ask: Clarify; onAsk: (q: string) => void }) {
  const named = ask.term ? cap(ask.term) : null;
  const drug = ask.generic ?? ask.term;
  let head: string;
  if (named && ask.generic && ask.onFormulary) head = `${named} is sold as ${ask.generic}, which is on Corvale's formulary`;
  else if (named && ask.generic) head = `${named} (${ask.generic}) is not on Corvale's formulary`;
  else if (named && ask.suggestions.length) head = `\u201c${ask.term}\u201d is not a drug on Corvale's formulary`;
  else head = "Scout could not tell which drug this asks about";
  const intents = ask.options.filter((o) => ASK_FOR[o.intent]);
  let lead: string;
  if (ask.suggestions.length) {
    lead = ask.generic && ask.onFormulary ? " Ask about it by its generic name:" : ` The closest ${ask.suggestions.length === 1 ? "name" : "names"} on the formulary${drug ? ` to ${drug}` : ""}:`;
  } else lead = intents.length ? " Upstream answers questions like these:" : " Name a drug on the formulary, for example carboplatin.";
  return (
    <div className="notice notice--clarify">
      <span className="notice__mark" aria-hidden="true">
        ?
      </span>
      <h3>{head}</h3>
      <p>
        Scout asks rather than guesses, so it issued no contract and nothing ran.{lead}
      </p>
      {ask.suggestions.length || intents.length ? (
        <ul className="inv-try">
          {ask.suggestions.length
            ? ask.suggestions.map((n) => (
                <li key={n}>
                  <button type="button" className="btn btn--quiet btn--small" onClick={() => onAsk(`Why is ${n} short, and what do we do?`)}>
                    {cap(n)}
                  </button>
                </li>
              ))
            : intents.map((o) => (
                <li key={o.intent}>
                  <button type="button" className="btn btn--quiet btn--small" onClick={() => onAsk(ASK_FOR[o.intent])}>
                    {ASK_FOR[o.intent]}
                  </button>
                </li>
              ))}
        </ul>
      ) : null}
    </div>
  );
}

function BriefNote({ b }: { b: BriefSummary | null }) {
  if (!b) {
    return (
      <div className="notice">
        <span className="notice__mark" aria-hidden="true">
          i
        </span>
        <h3>No overnight report on this copy yet</h3>
        <p>The watch prints the morning brief here after its first run.</p>
      </div>
    );
  }
  return (
    <div className="inv-brief">
      <p className="inv-brief__k">
        The morning brief, printed {fmtDate(b.ranAt.slice(0, 10))} at {b.ranAt.slice(11, 16)} UTC
      </p>
      <p className="inv-brief__n">
        {b.drugs} drugs checked: <b className="is-act">{b.act} act today</b>, <b className="is-watch">{b.watch} on watch</b>, {b.quiet} quiet.
      </p>
      {b.brief ? <p className="inv-brief__s">{b.brief}</p> : null}
      {b.top.length ? (
        <ol className="inv-brief__top">
          {b.top.map((t) => (
            <li key={t.name + t.hospital}>
              {t.slug ? <Link href={`/case/${t.slug}`}>{t.name}</Link> : <span>{t.name}</span>}
              <span>
                {t.days === null ? "no count" : plural(t.days, "day")} at {t.hospital.replace(/^Corvale /, "")}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <a className="rd-go" href="#report-h">
        Read the whole overnight report
      </a>
    </div>
  );
}
