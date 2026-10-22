"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Case, Step } from "../../src/agent/types";
import { EvidenceProvider, Cites } from "../Evidence";
import { TraceAndRuler } from "../Trace";
import { buildRuler, buildTrace } from "../lib/trace";
import { drugTitle, slugFor, tallText } from "../lib/drug";
import { fmtMs } from "../lib/format";
import { EXAMPLES } from "../examples";
import "../ask.css";
import "./investigation.css";

type Mode = "live" | "replay";

interface Decision {
  intent: string;
  risk: string;
  reason: string | null;
  clarification: string | null;
}

type Run =
  | { k: "idle" }
  | { k: "running"; q: string; decision: Decision | null; steps: Step[]; mode: Mode | null }
  | { k: "done"; q: string; decision: Decision | null; steps: Step[]; mode: Mode; c: Case }
  | { k: "refused"; q: string; decision: Decision | null; reason: string }
  | { k: "unrecorded"; q: string; decision: Decision | null; drug: string; reason: string }
  | { k: "error"; q: string; message: string };

const COLUMNS: { key: Step["key"][]; label: string }[] = [
  { key: ["stock"], label: "Our shelf" },
  { key: ["chain"], label: "Labels and plants" },
  { key: ["signals"], label: "What FDA recorded" },
  { key: ["fda_shortage"], label: "FDA's shortage list" },
  { key: ["market", "interchange", "data_quality", "memory"], label: "Options and checks" },
];

const KNOWN = ["carboplatin", "lidocaine", "cisplatin", "methotrexate", "fentanyl"];

function StepCard({ s, i }: { s: Step; i: number }) {
  return (
    <li className={`inv-step inv-step--${s.status}`} style={{ animationDelay: "0ms" }}>
      <span className="inv-step__n num">{i + 1}</span>
      <div>
        <h4>{s.title}</h4>
        <p className="inv-step__f">{tallText(s.finding)}</p>
        <p className="inv-step__m small muted num">
          {fmtMs(s.ms)}, {s.rows.toLocaleString("en-US")} rows
          {s.queryIds.length ? `, ${s.queryIds.join(" ")}` : ""}
        </p>
      </div>
    </li>
  );
}

function Progress({ steps, done }: { steps: Step[]; done: boolean }) {
  return (
    <ol className="inv-cols" aria-label="Investigation progress">
      {COLUMNS.map((col) => {
        const hits = steps.filter((s) => col.key.includes(s.key));
        const on = hits.length > 0;
        return (
          <li key={col.label} className={`inv-col${on ? " is-on" : ""}`}>
            <span className="inv-col__l">{col.label}</span>
            {on ? (
              <span className="inv-col__f">{tallText(hits[hits.length - 1].finding)}</span>
            ) : done ? (
              <span className="inv-col__f muted">Nothing to report</span>
            ) : (
              <span className="skel" style={{ height: 12, width: "80%", marginTop: 8 }} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Investigation({ initial }: { initial?: string }) {
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
    setRun({ k: "running", q: text, decision, steps: [], mode });
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
              decision = { intent: String(m.intent), risk: String(m.risk), reason: (m.reason as string) ?? null, clarification: (m.clarification as string) ?? null };
              setRun({ k: "running", q: text, decision, steps: [...steps], mode });
              break;
            case "step":
              steps.push(m.step as Step);
              mode = (m.mode as Mode) ?? mode;
              setRun({ k: "running", q: text, decision, steps: [...steps], mode });
              break;
            case "case":
              finished = true;
              setRun({ k: "done", q: text, decision, steps: [...steps], mode: (m.mode as Mode) ?? mode ?? "replay", c: m.case as Case });
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

  useEffect(() => {
    if (initial && !started.current) {
      started.current = true;
      go(initial);
    }
    return () => ctl.current?.abort();
  }, [initial, go]);

  const busy = run.k === "running";

  return (
    <div className="inv">
      <div className="ask">
        <h2 className="ask-title" id="desk-ask-title">
          Ask about a drug on our formulary
        </h2>
        <form
          className="ask-form"
          aria-labelledby="desk-ask-title"
          onSubmit={(e) => {
            e.preventDefault();
            go(q);
          }}
        >
          <label htmlFor="desk-q" className="sr-only">
            Your question
          </label>
          <input
            id="desk-q"
            className="ask-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Why is carboplatin short, and what do we do?"
            autoComplete="off"
            maxLength={400}
            required
          />
          <button type="submit" className="btn btn--primary ask-go" disabled={busy}>
            {busy ? "Investigating" : "Investigate"}
          </button>
        </form>
        <div className="ask-examples">
          <span className="muted small">Recorded on this copy: {KNOWN.map((k) => drugTitle(k)).join(", ")}.</span>
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
        </div>
      </div>

      <div ref={live} className="inv-out" aria-live="polite" aria-busy={busy}>
        {run.k === "idle" ? (
          <div className="inv-empty">
            <p>
              Ask why a drug is short. Upstream reads our three hospitals and FDA&apos;s files step by step, and each step
              appears here as it finishes.
            </p>
          </div>
        ) : null}

        {run.k !== "idle" ? (
          <div className="inv-head">
            <p className="inv-q">&ldquo;{run.q}&rdquo;</p>
            <div className="inv-badges">
              {"decision" in run && run.decision ? (
                <span className="inv-decision">
                  Scout read this as <strong>{run.decision.intent}</strong>, {run.decision.risk} risk
                </span>
              ) : run.k === "running" ? (
                <span className="inv-decision muted">Scout is reading the question</span>
              ) : null}
              {(run.k === "running" || run.k === "done") && run.mode ? (
                <span className={`mode${run.mode === "live" ? " mode--live" : ""}`}>
                  {run.mode === "live" ? "Live: querying Zetaris now" : "Replay of a recorded investigation"}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {run.k === "running" || run.k === "done" ? (
          <>
            <Progress steps={run.steps} done={run.k === "done"} />
            {run.k === "done" ? (
              <details className="more inv-done">
                <summary>
                  Show the {run.steps.length} steps ({fmtMs(run.steps.reduce((a, s) => a + s.ms, 0))} of queries)
                </summary>
                <ol className="inv-steps">
                  {run.steps.map((s, i) => (
                    <StepCard key={i} s={s} i={i} />
                  ))}
                </ol>
              </details>
            ) : null}
            <ol className="inv-steps" hidden={run.k === "done"}>
              {run.k === "running" && run.steps.map((s, i) => (
                <StepCard key={i} s={s} i={i} />
              ))}
              {run.k === "running" ? (
                <li className="inv-step inv-step--pending" aria-label="Next step running">
                  <span className="inv-step__n inv-spin" aria-hidden="true" />
                  <div>
                    <span className="skel" style={{ height: 14, width: 220 }} />
                    <span className="skel skel-line" style={{ width: "70%" }} />
                  </div>
                </li>
              ) : null}
            </ol>
          </>
        ) : null}

        {run.k === "done" ? <Result c={run.c} mode={run.mode} /> : null}

        {run.k === "refused" ? (
          <div className="notice notice--error">
            <span className="notice__mark" aria-hidden="true">!</span>
            <h3>Scout refused this request</h3>
            <p>{run.reason}</p>
          </div>
        ) : null}

        {run.k === "unrecorded" ? (
          <div className="notice">
            <span className="notice__mark" aria-hidden="true">i</span>
            <h3>{run.drug ? `No recording for ${drugTitle(run.drug)} on this copy` : "No recording for this question"}</h3>
            <p>
              {run.reason} Try one of the recorded drugs: {KNOWN.map((k) => drugTitle(k)).join(", ")}.
            </p>
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

function Result({ c, mode }: { c: Case; mode: Mode }) {
  const trace = buildTrace(c);
  const ruler = buildRuler(c);
  const slug = slugFor(c.molecule);
  const opts = [...c.options].sort((a, b) => a.rank - b.rank).slice(0, 3);
  return (
    <EvidenceProvider evidence={c.evidence} queries={c.queries}>
      <div className="inv-result">
        <div className="inv-result__head">
          <h3 className="inv-result__title">{c.explanation ? tallText(c.explanation.headline) : `${drugTitle(c.molecule)}: no verified explanation`}</h3>
          {mode === "replay" && slug ? (
            <Link href={`/case/${slug}`} className="btn btn--primary">
              Open the full case
            </Link>
          ) : null}
        </div>
        <div className="panel inv-trace">
          <TraceAndRuler trace={trace} ruler={ruler} />
        </div>
        <div className="inv-result__grid">
          {c.explanation ? (
            <div>
              <h4 className="inv-sub">Why</h4>
              <ul className="why">
                {c.explanation.sentences.slice(0, 4).map((s, i) => (
                  <li key={i}>
                    <span>{tallText(s.text)}</span>
                    <Cites ids={s.cites} />
                  </li>
                ))}
              </ul>
              {c.explanation.sentences.length > 4 ? (
                <p className="small muted inv-moretext">
                  {c.explanation.sentences.length - 4} more verified sentences in the full case.
                </p>
              ) : null}
            </div>
          ) : null}
          <div>
            <h4 className="inv-sub">First options</h4>
            <ol className="inv-opts">
              {opts.map((o, i) => (
                <li key={i}>
                  <span className="strong">{tallText(o.title)}</span>
                  <span className="small muted">Needs the {o.needs}.</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </EvidenceProvider>
  );
}
