// The sections of an investigation, as plain server components. Citation chips are the only interactive parts.
import type { Case, OptionLine, StockLine } from "../../src/agent/types";
import { Cite, Cites } from "../Evidence";
import { sourceName } from "../lib/sources";
import { countryName, firmCase, fmtDate, fmtDays, fmtInt, fmtMs, fmtStamp, fmtTime, ndc542 } from "../lib/format";
import { tallText } from "../lib/drug";
import { toneOfHealth, HEALTH_WORD } from "../lib/trace";
import "./case.css";

const HOSPITALS = ["Corvale General", "Corvale East", "Corvale Lakeside"] as const;

const KIND_WORD: Record<OptionLine["kind"], string> = {
  transfer: "Transfer between our hospitals",
  alternate_manufacturer: "Same product, another maker",
  alternate_concentration: "Another concentration or vial size",
  interchange: "Approved therapeutic interchange",
  iv_to_po: "IV to oral",
};

function DaysBar({ days, max = 30 }: { days: number | null; max?: number }) {
  const pct = days === null ? 0 : Math.max(2, Math.min(100, (days / max) * 100));
  return (
    <span className={`days-bar${days !== null && days >= 14 ? " is-fine" : ""}`} aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
      <i style={{ left: `${(14 / max) * 100}%` }} />
    </span>
  );
}

export function StockSection({ c }: { c: Case }) {
  const max = Math.max(30, ...c.stock.map((s) => s.days ?? 0));
  return (
    <div className="stock">
      {HOSPITALS.map((h) => {
        const lines = c.stock.filter((s) => s.hospital === h);
        if (!lines.length) return null;
        const on = lines.reduce((a, s) => a + s.onHand, 0);
        const use = lines.reduce((a, s) => a + s.dailyUse, 0);
        const days = use > 0 ? on / use : null;
        const derived = Object.values(c.evidence).find((e) => e.queryId === "derived" && e.fields?.hospital === h);
        return (
          <div className="stock-h" key={h}>
            <div className="stock-h__head">
              <h3>{h}</h3>
              <p className="stock-h__sum">
                <span className="stock-h__days num">{fmtDays(days)} days</span> across {lines.length}{" "}
                {lines.length === 1 ? "line" : "lines"}, {fmtInt(on)} {lines[0].unit}s at {Math.round(use * 10) / 10} a day
                {derived ? <Cites ids={[derived.id]} /> : null}
              </p>
              <DaysBar days={days} max={max} />
            </div>
            <ul className="stock-lines">
              {lines.map((s: StockLine) => (
                <li key={s.itemKey}>
                  <span className="stock-l__desc">
                    {tallText(s.description.length > 90 ? s.description.slice(0, 88) + "…" : s.description)}
                  </span>
                  <span className="stock-l__ndc num">
                    NDC {ndc542(s.ndc11)}
                    <span className="muted">, {s.labeler ?? "labeler not found"}</span>
                  </span>
                  <span className="stock-l__nums num">
                    <strong>{fmtDays(s.days)}</strong> days: {Math.round(s.onHand * 10) / 10} on hand, {Math.round(s.dailyUse * 100) / 100} a day
                  </span>
                  <span className="stock-l__match small muted">NDC {s.ndcMatch}</span>
                  <Cite id={s.evidence} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="small muted stock-note">The mark on each bar is two weeks of supply.</p>
    </div>
  );
}

export function OptionsSection({ c }: { c: Case }) {
  const opts = [...c.options].sort((a, b) => a.rank - b.rank);
  if (!opts.length) {
    return (
      <div className="notice">
        <span className="notice__mark" aria-hidden="true">i</span>
        <h3>No options found</h3>
        <p>No sister hospital can spare stock, and P&amp;T has no approved interchange on file for these items.</p>
      </div>
    );
  }
  const head = opts.slice(0, 6);
  const rest = opts.slice(6);
  const item = (o: OptionLine, i: number) => (
    <li key={i} className="opt">
      <span className="opt-rank num" aria-label={`Rank ${o.rank}`}>
        {o.rank}
      </span>
      <div className="opt-body">
        <span className="opt-kind">{KIND_WORD[o.kind] ?? o.kind}</span>
        <h3 className="opt-title">{tallText(o.title)}</h3>
        <p className="opt-detail">{tallText(o.detail)}</p>
        <p className="opt-why">{o.why}</p>
      </div>
      <div className="opt-side">
        <span className="opt-needs">
          <span className="muted small">Who approves</span>
          <span>{o.needs.charAt(0).toUpperCase() + o.needs.slice(1)}</span>
        </span>
        <Cites ids={o.evidence} label={o.title} />
      </div>
    </li>
  );
  return (
    <>
      <ol className="opts">{head.map(item)}</ol>
      {rest.length ? (
        <details className="more">
          <summary>Show {rest.length} more options</summary>
          <ol className="opts">{rest.map((o, i) => item(o, i + 6))}</ol>
        </details>
      ) : null}
    </>
  );
}

export function MarketSection({ c }: { c: Case }) {
  const rank = (h: string) => (h === "signal" ? 0 : h === "watch" ? 1 : h === "clear" ? 2 : 3);
  const rows = [...c.market].sort(
    (a, b) =>
      Number(b.inOurStock) - Number(a.inOurStock) ||
      Math.min(...a.plants.map((p) => rank(p.health)), 4) - Math.min(...b.plants.map((p) => rank(p.health)), 4) ||
      a.labeler.localeCompare(b.labeler),
  );
  return (
    <div className="market">
      <div className="table-wrap market-table">
        <table className="table">
          <caption className="sr-only">Every labeler of this drug in the same form, with the plants on its label</caption>
          <thead>
            <tr>
              <th scope="col">Labeler and NDC</th>
              <th scope="col">Plants on the label</th>
              <th scope="col">FDA&apos;s shortage list</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => (
              <tr key={i} className={m.inOurStock ? "is-ours" : undefined}>
                <td>
                  <span className="strong">{m.labeler}</span>
                  {m.inOurStock ? <span className="ours">In our stock</span> : null}
                  <span className="block small muted num">
                    NDC {ndc542(m.ndc11)}, {m.dosageForm.toLowerCase()}
                  </span>
                </td>
                <td>
                  {m.plants.length ? (
                    <ul className="mk-plants">
                      {m.plants.map((p, j) => (
                        <li key={j}>
                          <span className={`dot dot--${toneOfHealth(p.health)}`} aria-hidden="true" />
                          <span>
                            {firmCase(p.name)}
                            <span className="block small muted num">
                              {p.country ? countryName(p.country) : "Country not on file"}
                              {p.last ? `, last ${p.last.replace(/(\d{4}-\d{2}-\d{2})/, (d) => fmtDate(d))}` : ""}
                              <span className="sr-only">. {HEALTH_WORD[p.health]}</span>
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="muted">The label names no plant</span>
                  )}
                </td>
                <td>{m.onShortageList ? <span className="tag tag--outline">Listed</span> : <span className="muted">Not listed</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted legend">
        <span><span className="dot dot--signal" /> FDA action in the last 3 years</span>
        <span><span className="dot dot--caution" /> Last inspection OAI, or VAI in 2 years</span>
        <span><span className="dot dot--clear" /> No action in the last 3 years</span>
        <span><span className="dot dot--unknown" /> Can&apos;t be checked</span>
      </p>
    </div>
  );
}

export function FdaListSection({ c }: { c: Case }) {
  const s = c.shortage;
  if (!s.listed) {
    return <p className="muted">FDA does not list this drug as short. The trace still shows what FDA recorded at our plants.</p>;
  }
  return (
    <div className="fdalist">
      <p className="fdalist-sum">
        FDA lists it as <strong>{s.status}</strong>, first posted {fmtDate(s.firstPosting)}.{" "}
        {s.ourNdcsListed.length ? `${s.ourNdcsListed.length} of our NDCs are on the listing.` : "None of our NDCs are on the listing."}
      </p>
      <ul className="fdalist-co">
        {s.companies.map((x, i) => (
          <li key={i}>
            <span className="strong">{x.company}</span>
            <span className="small muted">
              {x.status}, updated {fmtDate(x.updated)}
            </span>
            {x.info ? <span className="fdalist-info">{x.info}</span> : null}
            <Cite id={x.evidence} />
          </li>
        ))}
      </ul>
      {s.reasons.length ? (
        <p className="small muted fdalist-reasons">Reasons companies gave FDA: {s.reasons.join("; ").toLowerCase()}.</p>
      ) : null}
    </div>
  );
}

export function StepsSection({ c }: { c: Case }) {
  return (
    <ol className="steps">
      {c.steps.map((s, i) => (
        <li key={i} className={`step step--${s.status}`}>
          <div className="step-main">
            <h3>{s.title}</h3>
            <p className="step-purpose">{s.purpose}</p>
            <p className="step-finding">
              {s.status === "failed" ? <span className="tag tag--ink">Failed</span> : s.status === "empty" ? <span className="tag tag--outline">No rows</span> : null}{" "}
              {tallText(s.finding)}
            </p>
            {s.error ? <p className="small muted">{s.error}</p> : null}
          </div>
          <dl className="step-meta">
            <div>
              <dt>Time</dt>
              <dd className="num">{fmtMs(s.ms)}</dd>
            </div>
            <div>
              <dt>Rows</dt>
              <dd className="num">{fmtInt(s.rows)}</dd>
            </div>
            <div className="step-src">
              <dt>Read from</dt>
              <dd>{s.sources.map(sourceName).join(", ")}</dd>
            </div>
            {s.queryIds.length ? (
              <div className="step-q">
                <dt>Queries</dt>
                <dd>
                  <Cites ids={s.queryIds} label={s.title} />
                </dd>
              </div>
            ) : null}
          </dl>
        </li>
      ))}
    </ol>
  );
}

const TABLE_HOSPITAL: Record<string, string> = {
  stock_general: "Corvale General stock",
  stock_east: "Corvale East stock",
  stock_lakeside: "Corvale Lakeside cabinet",
};

const RULE_WORD: Record<string, string> = {
  "Primary Key Constraint": "Every row has one unique key",
  "Foreign Key Constraint": "Every NDC is an FDA-listed product",
};

export function DataQualitySection({ c }: { c: Case }) {
  if (!c.dataQuality.length) return <p className="muted">No data-quality rules ran for this case.</p>;
  return (
    <div className="dq">
      <ul className="dq-list">
        {c.dataQuality.map((d, i) => {
          const pass = d.total - d.invalid;
          return (
            <li key={i} className={d.invalid ? "has-fail" : undefined}>
              <span className="dq-t">{TABLE_HOSPITAL[d.table] ?? d.table}</span>
              <span className="dq-r">{RULE_WORD[d.rule] ?? d.rule}</span>
              <span className="dq-bar" aria-hidden="true">
                <span style={{ width: `${(pass / Math.max(1, d.total)) * 100}%` }} />
              </span>
              <span className="dq-n num">
                {d.invalid ? (
                  <>
                    <strong>{d.invalid} fail</strong> of {fmtInt(d.total)}
                  </>
                ) : (
                  <>All {fmtInt(d.total)} pass</>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="small muted">
        These rules come from the foreign keys in Upstream&apos;s semantic layer. A row that fails is reported here and left
        out of the counts; Upstream does not guess what it meant.
      </p>
    </div>
  );
}

export function MemorySection({ c }: { c: Case }) {
  if (!c.memory.length) {
    return (
      <div className="notice">
        <span className="notice__mark" aria-hidden="true">i</span>
        <h3>No past decisions on this drug</h3>
        <p>H-MEM has nothing approved for it yet. The memo below records the first one once a pharmacist approves it.</p>
      </div>
    );
  }
  return (
    <ul className="mem">
      {c.memory.map((m) => {
        const [decision, rationale] = m.text.replace(/^Decision on [^:]+:\s*/, "").split(/\s*Rationale:\s*/);
        return (
          <li key={m.id} className="mem-item">
            <span className="mem-when num">{m.when ? fmtDate(m.when) : "Undated"}</span>
            <div className="mem-body">
              <p className="mem-decision">{tallText(decision.charAt(0).toUpperCase() + decision.slice(1).replace(/\.$/, ""))}.</p>
              {rationale ? <p className="mem-why">{rationale.replace(/\s*Approved by[^.]*\.?$/, "")}</p> : null}
              <p className="mem-by small">
                {m.approvedBy ? `Approved by ${m.approvedBy}` : "No approver recorded"}
                <span className="muted">, recall score {m.score.toFixed(2)}, memory {m.id}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function GateSection({ c }: { c: Case }) {
  const counts = {
    allowed: c.gate.filter((g) => g.decision === "allowed").length,
    approval: c.gate.filter((g) => g.decision === "needs approval").length,
    refused: c.gate.filter((g) => g.decision === "refused").length,
  };
  return (
    <div className="gate">
      <p className="gate-sum">
        Contract <span className="num strong">{c.intent.contractId ?? "none"}</span> for{" "}
        <span className="strong">{c.intent.name}</span>, {c.intent.risk} risk. {counts.allowed} calls allowed,{" "}
        {counts.approval} waiting for approval, {counts.refused} refused.
      </p>
      <div className="table-wrap">
        <table className="table gate-table">
          <caption className="sr-only">Every tool call checked against the contract</caption>
          <thead>
            <tr>
              <th scope="col">Time (UTC)</th>
              <th scope="col">Action</th>
              <th scope="col">Capability</th>
              <th scope="col">Decision</th>
            </tr>
          </thead>
          <tbody>
            {c.gate.map((g, i) => (
              <tr key={i}>
                <td className="num muted">{fmtTime(g.at)}</td>
                <td>
                  {g.action}
                  <span className="block small muted">{g.reason}</span>
                </td>
                <td className="num">{g.capability}</td>
                <td>
                  <span className={`gate-d gate-d--${g.decision.replace(/\s+/g, "-")}`}>{g.decision.charAt(0).toUpperCase() + g.decision.slice(1)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function UsageSection({ c }: { c: Case }) {
  const u = c.usage;
  return (
    <dl className="usage">
      <div>
        <dt>Zetaris queries</dt>
        <dd className="num">{u.zetarisQueries}</dd>
      </div>
      <div>
        <dt>Query time</dt>
        <dd className="num">{fmtMs(u.zetarisMs)}</dd>
      </div>
      <div>
        <dt>Model calls</dt>
        <dd className="num">{u.modelCalls}</dd>
      </div>
      <div>
        <dt>Tokens in and out</dt>
        <dd className="num">
          {fmtInt(u.tokensIn)} and {fmtInt(u.tokensOut)}
        </dd>
      </div>
      <div>
        <dt>Writer</dt>
        <dd className="num">{c.explanation?.model.replace(/^nvidia\//, "") ?? "none"}</dd>
      </div>
      <div>
        <dt>Recorded</dt>
        <dd className="num">
          {u.mode === "live" ? "Live run" : u.mode === "replay" ? "Replayed run" : "Partly live"}, {fmtStamp(c.askedAt)}
        </dd>
      </div>
    </dl>
  );
}
