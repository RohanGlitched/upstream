"use client";

// The ask box as a typed request slip. While Upstream works, each step it finishes is filed as a card in
// the open folder; when the answer arrives, the folder is laid out on the desk as the full record.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Case, Step } from "../../src/agent/types";
import { EvidenceProvider } from "../Evidence";
import { RecordDesk } from "../record/RecordDesk";
import { buildDesk } from "../record/model";
import { BoxStamp, Stamp } from "../record/bits";
import { drugTitle, slugFor, tallText } from "../lib/drug";
import { fmtMs } from "../lib/format";
import { EXAMPLES } from "../examples";
import "./investigation.css";

type Mode = "live" | "replay";

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
  | { k: "done"; q: string; decision: Decision | null; steps: Step[]; mode: Mode; c: Case; t0: number; t1: number }
  | { k: "refused"; q: string; decision: Decision | null; reason: string }
  | { k: "unrecorded"; q: string; decision: Decision | null; drug: string; reason: string }
  | { k: "error"; q: string; message: string };

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
        {fmtMs(s.ms)}, {s.rows.toLocaleString("en-US")} rows{s.queryIds.length ? `, ${s.queryIds.slice(0, 3).join(" ")}` : ""}
      </p>
    </li>
  );
}

export function Investigation({ initial, onFile }: { initial?: string; onFile?: number }) {
  const [q, setQ] = useState(initial ?? "");
  const [run, setRun] = useState<Run>({ k: "idle" });
  const ctl = useRef<AbortController | null>(null);
  const started = useRef(false);
  const live = useRef<HTMLDivElement>(null);

  const go = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text) return;
    ctl.current?.abort();
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
            case "case":
              finished = true;
              setRun({ k: "done", q: text, decision, steps: [...steps], mode: (m.mode as Mode) ?? mode ?? "replay", c: m.case as Case, t0, t1: performance.now() });
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

  // Start a question that arrived in the address bar. The timer survives React's double-invoked effects in
  // development: the first is cleared before it fires, the second runs.
  useEffect(() => {
    if (!initial || started.current) return;
    const t = window.setTimeout(() => {
      started.current = true;
      go(initial);
    }, 0);
    return () => window.clearTimeout(t);
  }, [initial, go]);

  const busy = run.k === "running";
  const today = "22 OCT 2026";

  return (
    <div className="inv">
      <form
        className={`inv-slip${run.k === "refused" ? " is-refused" : ""}`}
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
          <div>
            <span className="inv-fl">Date</span>
            <span className="inv-fv">{today}</span>
          </div>
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
        {run.k === "refused" ? <Stamp className="inv-refused" tone="red" big="REFUSED" bottom="NO CONTRACT ISSUED" top="SCOUT" w={190} h={96} /> : null}
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
                  setQ(x);
                  go(x);
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
  const model = useMemo(() => (run.k === "done" ? buildDesk(run.c, slugFor(run.c.molecule)) : null), [run]);
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
            <RecordDesk m={model} as="h2" signHref={run.mode === "replay" ? `/case/${model.slug}#memo` : undefined}>
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
