"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Case, Evidence as Ev } from "../src/agent/types";
import { fmtMs, fmtStamp } from "./lib/format";
import { sourceName } from "./lib/sources";
import "./evidence.css";

type Queries = Case["queries"];

interface Ctx {
  open: (id: string, trail?: string[]) => void;
  has: (id: string) => boolean;
}

const EvidenceCtx = createContext<Ctx | null>(null);

function prettySql(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\s(FROM|LEFT JOIN|INNER JOIN|JOIN|WHERE|GROUP BY|ORDER BY|UNION ALL|HAVING|LIMIT|AND|OR)\s/g, "\n$1 ")
    .replace(/\n(AND|OR) /g, "\n  $1 ")
    .trim();
}

export function EvidenceProvider({
  evidence,
  queries,
  children,
}: {
  evidence: Record<string, Ev>;
  queries: Queries;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<{ id: string; trail: string[] } | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((id: string, trail?: string[]) => {
    opener.current = (document.activeElement as HTMLElement) ?? null;
    setState({ id, trail: trail && trail.length ? trail : [id] });
  }, []);
  const has = useCallback((id: string) => Boolean(evidence[id] || queries[id]), [evidence, queries]);
  const close = useCallback(() => {
    setState(null);
    requestAnimationFrame(() => opener.current?.focus());
  }, []);

  return (
    <EvidenceCtx.Provider value={{ open, has }}>
      {children}
      {state ? (
        <Drawer
          id={state.id}
          trail={state.trail}
          evidence={evidence}
          queries={queries}
          onPick={(id) => setState((s) => (s ? { ...s, id } : s))}
          onClose={close}
        />
      ) : null}
    </EvidenceCtx.Provider>
  );
}

function Drawer({
  id,
  trail,
  evidence,
  queries,
  onPick,
  onClose,
}: {
  id: string;
  trail: string[];
  evidence: Record<string, Ev>;
  queries: Queries;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const ev = evidence[id];
  const derived = ev?.queryId === "derived";
  const q = ev && !derived ? queries[ev.queryId] : undefined;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>("button, a[href], summary, [tabindex='0']");
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="ev-layer" role="presentation">
      <button type="button" className="ev-scrim" aria-label="Close evidence" onClick={onClose} tabIndex={-1} />
      <div
        className="ev-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ev-title"
        ref={panel}
        tabIndex={-1}
      >
        <div className="ev-head">
          <div className="ev-id num">{id}</div>
          <button type="button" className="ev-close" onClick={onClose}>
            <span className="sr-only">Close evidence</span>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {trail.length > 1 ? (
          <div className="ev-trail" role="group" aria-label="Rows this sentence cites">
            {trail.map((t) => (
              <button
                key={t}
                type="button"
                className={`ev-trail__btn num${t === id ? " is-on" : ""}`}
                aria-pressed={t === id}
                onClick={() => onPick(t)}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}

        {!ev && queries[id] ? (
          <div className="ev-body">
            <h2 id="ev-title">Zetaris query {id}</h2>
            <p className="ev-where">
              {queries[id].rows.toLocaleString("en-US")} rows in {fmtMs(queries[id].ms)}
            </p>
            <h3 className="ev-sub">Where it was read</h3>
            <ul className="ev-sources">
              {queries[id].sources.map((s) => (
                <li key={s}>
                  <span>{sourceName(s)}</span>
                  <span className="muted small">{s}</span>
                </li>
              ))}
            </ul>
            <dl className="facts ev-meta">
              <dt>Mode</dt>
              <dd>
                <span className={`mode${queries[id].mode === "live" ? " mode--live" : ""}`}>
                  {queries[id].mode === "live" ? "Ran live on Zetaris" : "Replayed from a recorded Zetaris query"}
                </span>
              </dd>
              <dt>Ran</dt>
              <dd>{fmtStamp(queries[id].ranAt)}</dd>
            </dl>
            <details className="ev-sql" open>
              <summary>SQL sent to Zetaris</summary>
              <pre tabIndex={0}>{prettySql(queries[id].sql)}</pre>
            </details>
          </div>
        ) : !ev ? (
          <div className="ev-body">
            <h2 id="ev-title">This row is not in the case file</h2>
            <p className="muted">
              The citation {id} has no matching row in this recording. The verifier drops sentences that cite rows it
              cannot find, so this chip should not appear; if it does, the recording is incomplete.
            </p>
          </div>
        ) : (
          <div className="ev-body">
            <h2 id="ev-title">{ev.label}</h2>
            <p className="ev-where">
              {derived ? (
                <>Computed by Upstream from rows already in this case. No query ran for it.</>
              ) : (
                <>
                  Row {ev.row + 1} of query <span className="num strong">{ev.queryId}</span>
                  {q ? <>, {q.rows.toLocaleString("en-US")} rows in {fmtMs(q.ms)}</> : null}
                </>
              )}
            </p>

            <h3 className="ev-sub">Fields</h3>
            <dl className="ev-fields">
              {Object.entries(ev.fields).map(([k, v]) => (
                <div key={k} className="ev-field">
                  <dt>{k.replace(/_/g, " ")}</dt>
                  <dd className="num">{v === null || v === "" ? <span className="muted">empty</span> : String(v)}</dd>
                </div>
              ))}
            </dl>

            {q ? (
              <>
                <h3 className="ev-sub">Where it was read</h3>
                <ul className="ev-sources">
                  {q.sources.map((s) => (
                    <li key={s}>
                      <span>{sourceName(s)}</span>
                      <span className="muted small">{s}</span>
                    </li>
                  ))}
                </ul>
                <dl className="facts ev-meta">
                  <dt>Mode</dt>
                  <dd>
                    <span className={`mode${q.mode === "live" ? " mode--live" : ""}`}>
                      {q.mode === "live" ? "Ran live on Zetaris" : "Replayed from a recorded Zetaris query"}
                    </span>
                  </dd>
                  <dt>Ran</dt>
                  <dd>{fmtStamp(q.ranAt)}</dd>
                </dl>
                <details className="ev-sql" open>
                  <summary>SQL sent to Zetaris</summary>
                  <pre tabIndex={0}>{prettySql(q.sql)}</pre>
                </details>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** A citation chip. Opens the row behind a claim. */
export function Cite({ id, trail, label }: { id: string; trail?: string[]; label?: string }) {
  const ctx = useContext(EvidenceCtx);
  if (!ctx || !ctx.has(id)) return <span className="cite cite--static num">{id}</span>;
  return (
    <button
      type="button"
      className="cite num"
      onClick={() => ctx.open(id, trail)}
      aria-label={label ? `${label}: open evidence ${id}` : `Open evidence ${id}`}
    >
      {id}
    </button>
  );
}

export function Cites({ ids, label }: { ids: string[]; label?: string }) {
  if (!ids.length) return null;
  return (
    <span className="cites">
      {ids.map((id) => (
        <Cite key={id} id={id} trail={ids} label={label} />
      ))}
    </span>
  );
}

/** Wraps any element so a click opens its evidence; used by the trace nodes. */
export function useEvidence(): Ctx | null {
  return useContext(EvidenceCtx);
}
