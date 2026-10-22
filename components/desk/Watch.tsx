"use client";

import Link from "next/link";
import { useApi } from "../lib/useApi";
import { fmtDateLong, fmtDays, fmtInt, fmtMs, fmtStamp } from "../lib/format";
import { DrugName } from "../CaseBits";
import { shortHospital } from "../lib/trace";
import "./watch.css";

interface Flag {
  molecule: string;
  display?: string;
  minDays: number | null;
  systemDays?: number | null;
  hospital: string;
  state: "act" | "watch" | string;
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

function isWatch(x: unknown): x is WatchRun {
  const o = x as WatchRun;
  return Boolean(o && Array.isArray(o.flagged) && typeof o.drugs === "number");
}

function useWatch() {
  return useApi<WatchRun>("/api/watch", isWatch);
}

function name(f: Flag): string {
  const d = (f.display ?? f.molecule).trim();
  // Combination products arrive cut at 60 characters; keep the first three names.
  const parts = d.split(/,\s*/);
  return parts.length > 3 ? `${parts.slice(0, 3).join(", ")} and others` : d;
}

export function WatchSummary() {
  const s = useWatch();
  if (s.status === "loading") {
    return (
      <div className="watch-sum" aria-busy="true" aria-label="Loading the overnight watch">
        <span className="skel" style={{ height: 22, width: "92%" }} />
        <span className="skel" style={{ height: 22, width: "70%", marginTop: 10 }} />
        <div className="watch-stats">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skel" style={{ height: 44 }} />
          ))}
        </div>
      </div>
    );
  }
  if (s.status !== "ready") {
    return (
      <div className={`notice${s.status === "error" ? " notice--error" : ""}`}>
        <span className="notice__mark" aria-hidden="true">{s.status === "error" ? "!" : "i"}</span>
        <h3>{s.status === "error" ? "The overnight watch did not load" : "No overnight watch on this copy yet"}</h3>
        <p>
          {s.status === "error"
            ? s.message
            : "The watch walks the whole formulary each night in chunks and writes this brief. It appears here after its first run."}
        </p>
      </div>
    );
  }
  const w = s.data;
  const act = w.flagged.filter((f) => f.state === "act").length;
  const watch = w.flagged.length - act;
  return (
    <div className="watch-sum">
      {w.brief ? <p className="watch-brief">{w.brief}</p> : null}
      <p className="watch-by small muted">
        Ran {fmtStamp(w.ranAt)}
        {w.briefModel ? `. Summary written by ${w.briefModel.replace(/^nvidia\//, "")} from the flags below; the flags themselves come from Zetaris queries.` : "."}
      </p>
      <dl className="watch-stats">
        <div>
          <dt>Drugs checked</dt>
          <dd className="num">{fmtInt(w.drugs)}</dd>
        </div>
        <div>
          <dt>Act today</dt>
          <dd className="num">{act}</dd>
        </div>
        <div>
          <dt>Watch</dt>
          <dd className="num">{watch}</dd>
        </div>
        <div>
          <dt>Quiet</dt>
          <dd className="num">{fmtInt(w.quiet)}</dd>
        </div>
      </dl>
    </div>
  );
}

function FlagRow({ f }: { f: Flag }) {
  const href = f.slug ? `/case/${f.slug}` : `/desk?q=${encodeURIComponent(`Why is ${f.molecule} short, and what do we do?`)}`;
  return (
    <li className="flag">
      <div className="flag-main">
        <DrugName molecule={name(f)} className="flag-name" />
        <p className="flag-h">{f.headline}</p>
        <p className="flag-sig small muted">{f.signal}</p>
      </div>
      <div className="flag-days">
        <span className="flag-days__n num">{fmtDays(f.minDays)}</span>
        <span className="small muted">days at {shortHospital(f.hospital)}</span>
        {typeof f.systemDays === "number" ? <span className="small muted num">{fmtDays(f.systemDays)} system-wide</span> : null}
      </div>
      <div className="flag-go">
        {f.slug ? (
          <Link href={href} className="btn btn--small">
            Open the case
          </Link>
        ) : (
          <a href={href} className="btn btn--small btn--quiet">
            Ask about it
          </a>
        )}
      </div>
    </li>
  );
}

export function WatchList() {
  const s = useWatch();
  if (s.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading flagged drugs">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="skel" style={{ height: 72, marginBottom: 8 }} />
        ))}
      </div>
    );
  }
  if (s.status !== "ready") return null;
  const w = s.data;
  const act = w.flagged.filter((f) => f.state === "act").sort((a, b) => (a.minDays ?? 1e9) - (b.minDays ?? 1e9));
  const watch = w.flagged.filter((f) => f.state !== "act").sort((a, b) => (a.minDays ?? 1e9) - (b.minDays ?? 1e9));
  return (
    <div className="watch-list">
      <div className="watch-group">
        <h3>
          Act today <span className="muted num">{act.length}</span>
        </h3>
        <p className="small muted watch-group__d">On FDA&apos;s shortage list, or an FDA action at a plant on our labels, and short on our shelf.</p>
        <ul className="flags">
          {act.slice(0, 8).map((f, i) => (
            <FlagRow key={i} f={f} />
          ))}
        </ul>
        {act.length > 8 ? (
          <details className="more">
            <summary>Show {act.length - 8} more to act on</summary>
            <ul className="flags">
              {act.slice(8).map((f, i) => (
                <FlagRow key={i} f={f} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div className="watch-group">
        <h3>
          Watch <span className="muted num">{watch.length}</span>
        </h3>
        <p className="small muted watch-group__d">A weaker signal, or stock that is fine for now.</p>
        <details className="more">
          <summary>Show the {watch.length} drugs on watch</summary>
          <ul className="flags">
            {watch.map((f, i) => (
              <FlagRow key={i} f={f} />
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

export function WatchEngine() {
  const s = useWatch();
  if (s.status !== "ready") return null;
  const w = s.data;
  const m = w.markovian;
  return (
    <dl className="watch-engine">
      <div>
        <dt>Chunks</dt>
        <dd className="num">
          {w.chunks}
          {m ? ` of ${m.batchSize} drugs, ${m.runs} ${m.runs === 1 ? "run" : "runs"}` : ""}
        </dd>
      </div>
      {m ? (
        <div>
          <dt>Prompt per chunk</dt>
          <dd className="num">
            {m.promptTokensMin} to {m.promptTokensMax} tokens
          </dd>
        </div>
      ) : null}
      <div>
        <dt>Zetaris queries</dt>
        <dd className="num">{w.queries ?? "n/a"}</dd>
      </div>
      <div>
        <dt>Wall time</dt>
        <dd className="num">{fmtMs(w.ms)}</dd>
      </div>
      <div>
        <dt>Tokens</dt>
        <dd className="num">
          {w.tokens.measured ? `${fmtInt(w.tokens.measured)} measured` : `${fmtInt(w.tokens.estimated ?? 0)} estimated`}
        </dd>
      </div>
      <div>
        <dt>Data as of</dt>
        <dd className="num">{w.asOf ? fmtDateLong(w.asOf) : "n/a"}</dd>
      </div>
    </dl>
  );
}
