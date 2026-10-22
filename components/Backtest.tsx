"use client";

// The back-test as a study record: the case set fixed before the run, strict and end-dated results on facing pages,
// the lead-time distribution, the controls, four worked examples on red-thread rulers and the caveats as footnotes.
// Pages pass the summary in (server-read, so the first paint is complete); without it, it is fetched from /api/backtest.
import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useApi } from "./lib/useApi";
import { countryName, dayNumber, fmtDate, fmtPct } from "./lib/format";
import { drugTitle } from "./lib/drug";
import { findingOf } from "./BacktestFinding";
import "./backtest.css";

interface Arm {
  label?: string;
  dating?: string;
  episodesWithSignal?: string;
  share: number;
  caseProducts?: string;
  controlProducts?: string;
  liftVsControl?: number;
  lift?: number;
  p: number;
  leadDays?: { median: number; iqr: [number, number] };
  reading?: string;
}

export interface BacktestSummary {
  builtAt: string;
  source?: string;
  question?: string;
  window: string | { from?: string; to?: string } | null;
  signalDefinition?: string;
  cases: { n: number; withPlant: number; withSignal: number; note?: string };
  strict: Arm;
  endDated: Arm;
  leadDays?: { median: number; iqr: [number, number] };
  controls: { n: number; share: number; note?: string };
  ppv?: { all?: string; injectables?: string; note?: string };
  recalls?: { cases?: string; controls?: string; note?: string };
  examples: {
    molecule: string;
    slug?: string;
    labeler?: string;
    plant: string;
    country: string;
    fei?: string;
    posted: string;
    events: { date: string; kind: string; label: string }[];
    note?: string;
  }[];
  caveats: string[];
  conclusion?: string;
}

export function isBacktest(x: unknown): x is BacktestSummary {
  const o = x as BacktestSummary;
  return Boolean(o && typeof o === "object" && o.cases && o.strict && o.endDated);
}

export function windowText(w: BacktestSummary["window"]): string {
  if (!w) return "FDA's shortage history";
  if (typeof w === "string") return w;
  return w.from && w.to ? `${fmtDate(w.from)} to ${fmtDate(w.to)}` : "FDA's shortage history";
}

export function fmtP(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "p not computed";
  if (p < 0.001) return "p < 0.001";
  return `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(p < 0.1 ? 3 : 2)}`;
}

function liftOf(a: Arm): number | null {
  const l = a.liftVsControl ?? a.lift;
  return typeof l === "number" && Number.isFinite(l) ? l : null;
}

function leadOf(b: BacktestSummary, a: Arm) {
  return a.leadDays ?? b.leadDays ?? null;
}

/** "13 of 209 products (6.2%)" -> {n, d} */
function ofText(s: string | undefined): { n: number; d: number } | null {
  const m = s ? /(\d+)\s+of\s+(\d+)/.exec(s) : null;
  return m ? { n: Number(m[1]), d: Number(m[2]) } : null;
}

const pct1 = (x: { n: number; d: number } | null) => (x ? `${((x.n / x.d) * 100).toFixed(1)}%` : "n/a");

export function Finding({ b, lead }: { b: BacktestSummary; lead?: string }) {
  const f = findingOf(b);
  if (!f) return b.conclusion ? <>{b.conclusion}</> : null;
  return (
    <>
      {lead ? <span>{lead}</span> : null} {f.strict} {f.close}
      {f.close2} {f.end}
    </>
  );
}

function isCounter(e: BacktestSummary["examples"][number]): boolean {
  return /counter-example/i.test(e.note ?? "") || e.events.some((x) => x.kind === "other");
}

type Tone = "signal" | "border" | "caution" | "post" | "other";
function toneOf(kind: string): Tone {
  if (kind === "shortage_posted") return "post";
  if (kind === "import_alert") return "border";
  if (kind === "inspection_vai") return "caution";
  if (kind === "other") return "other";
  return "signal";
}

function EvGlyph({ kind, size = 14 }: { kind: string; size?: number }) {
  const t = toneOf(kind);
  return (
    <svg className={`bt-g bt-g--${t}`} width={size} height={size} viewBox="-7 -7 14 14" aria-hidden="true">
      {kind === "inspection_oai" || kind === "oai_letter" ? <path d="M0 -5.5 L5.5 0 L0 5.5 L-5.5 0 Z" className={kind === "oai_letter" ? "o" : undefined} /> : null}
      {kind === "warning_letter" ? <path d="M0 -5 L5.2 4.4 L-5.2 4.4 Z" /> : null}
      {kind === "import_alert" ? <rect x={-4.2} y={-4.2} width={8.4} height={8.4} /> : null}
      {kind === "shortage_posted" ? <rect x={-1.6} y={-6.5} width={3.2} height={13} /> : null}
      {kind === "other" ? <path d="M-6 1 Q-3 -3 0 1 T6 1" className="w" /> : null}
    </svg>
  );
}

/** One worked example on its own red-thread ruler: the plant's record hung from the thread, the posting stamped on it. */
export function MiniRuler({ events, posted, counter = false }: { events: { date: string; kind: string; label: string }[]; posted: string; counter?: boolean }) {
  const W = 640;
  const H = 104;
  const P = dayNumber(posted);
  const ds = events.map((e) => dayNumber(e.date));
  const lo = Math.min(P - 60, ...ds) - 28;
  const hi = Math.max(P + 30, ...ds) + 28;
  const x = (d: number) => 16 + ((d - lo) / (hi - lo)) * (W - 32);
  const AX = 58;
  const sig = events.filter((e) => e.kind !== "shortage_posted" && e.kind !== "other" && dayNumber(e.date) <= P);
  const first = sig.length ? Math.min(...sig.map((e) => dayNumber(e.date))) : null;
  const months: { d: number; y: boolean; label: string }[] = [];
  const d0 = new Date(lo * 86_400_000);
  for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1; ; m++) {
    if (m > 11) {
      m = 0;
      y++;
    }
    const d = Math.round(Date.UTC(y, m, 1) / 86_400_000);
    if (d > hi) break;
    months.push({ d, y: m === 0, label: m === 0 ? String(y) : "" });
  }
  // The thread sags a little between the clips, like the batch record's.
  const pts = [16, ...ds.map(x).sort((a, b) => a - b), W - 16];
  let thread = `M${pts[0]},${AX}`;
  for (let i = 1; i < pts.length; i++) thread += ` Q${((pts[i - 1] + pts[i]) / 2).toFixed(1)},${AX + Math.min(9, (pts[i] - pts[i - 1]) / 18)} ${pts[i].toFixed(1)},${AX}`;
  return (
    <svg className={`bt-ruler${counter ? " is-counter" : ""}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${events.length} records, posting on ${fmtDate(posted)}`}>
      {first !== null ? (
        <g className="bt-ruler__dim">
          <line x1={x(first)} x2={x(P)} y1={16} y2={16} />
          <path d={`M${x(first)},16 l7,-3.5 v7 Z M${x(P)},16 l-7,-3.5 v7 Z`} />
          <line x1={x(first)} x2={x(first)} y1={10} y2={AX - 6} className="ext" />
          <text x={(x(first) + x(P)) / 2} y={11} textAnchor="middle">
            {P - first} days
          </text>
        </g>
      ) : null}
      <rect x={10} y={AX + 6} width={W - 20} height={22} className="bt-ruler__scale" />
      {months.map((m) => (
        <g key={m.d}>
          <line x1={x(m.d)} x2={x(m.d)} y1={AX + 6} y2={AX + (m.y ? 22 : 12)} className={m.y ? "yt" : "mt"} />
          {m.label ? (
            <text x={x(m.d) + 4} y={AX + 23} className="yl">
              {m.label}
            </text>
          ) : null}
        </g>
      ))}
      <path d={thread} className="bt-ruler__thread" />
      <line x1={x(P)} x2={x(P)} y1={26} y2={AX + 30} className="bt-ruler__post" />
      <text x={x(P) + 5} y={34} className="bt-ruler__postl">
        Posted
      </text>
      {events
        .filter((e) => e.kind !== "shortage_posted")
        .map((e, i) => {
          const cx = x(dayNumber(e.date));
          return (
            <g key={i} transform={`translate(${cx.toFixed(1)},${AX})`} className={`bt-clip bt-clip--${toneOf(e.kind)}`}>
              <line x1={0} x2={0} y1={0} y2={-10} />
              <g transform="translate(0,-17)">
                {e.kind === "inspection_oai" || e.kind === "oai_letter" ? <path d="M0 -6 L6 0 L0 6 L-6 0 Z" className={e.kind === "oai_letter" ? "o" : undefined} /> : null}
                {e.kind === "warning_letter" ? <path d="M0 -5.5 L6 4.8 L-6 4.8 Z" /> : null}
                {e.kind === "import_alert" ? <rect x={-4.6} y={-4.6} width={9.2} height={9.2} /> : null}
                {e.kind === "other" ? <path d="M-7 1 Q-3.5 -4 0 1 T7 1" className="w" /> : null}
              </g>
              <text y={-28} textAnchor="middle" className="n">
                {events.indexOf(e) + 1}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

function Squares({ total, filled, placed, label }: { total: number; filled: number; placed?: number; label: string }) {
  const items: ReactNode[] = [];
  for (let i = 0; i < total; i++) {
    const cls = i < filled ? "is-sig" : placed !== undefined && i >= placed ? "is-out" : "";
    items.push(<i key={i} className={cls} />);
  }
  return (
    <span className="bt-sq" role="img" aria-label={label}>
      {items}
    </span>
  );
}

function Note({ n }: { n: number }) {
  return (
    <sup className="bt-fn">
      <a href={`#fn-${n}`} id={`fnref-${n}`} aria-label={`Footnote ${n}`}>
        {n}
      </a>
    </sup>
  );
}

function Page({ a, b, name, folio, side, children }: { a: Arm; b: BacktestSummary; name: string; folio: number; side: "l" | "r"; children?: ReactNode }) {
  const lift = liftOf(a);
  const lead = leadOf(b, a);
  const eps = ofText(a.episodesWithSignal);
  const cp = ofText(a.caseProducts);
  const ctl = ofText(a.controlProducts);
  const maxShare = Math.max(cp ? cp.n / cp.d : 0, ctl ? ctl.n / ctl.d : 0, 0.16);
  return (
    <article className={`bt-page bt-page--${side}`} aria-labelledby={`bt-page-${side}`}>
      <header className="bt-page__head">
        <h3 id={`bt-page-${side}`}>{a.label ?? name}</h3>
        <span className="bt-folio">p. {folio}</span>
      </header>
      <p className="bt-page__fig">
        <span className="bt-big">{fmtPct(a.share)}</span>
        <span>
          of the shortages with a plant we could place had an FDA action there before the posting
          {children}
        </span>
      </p>
      {eps ? (
        <div className="bt-page__sq">
          <Squares total={eps.d} filled={eps.n} label={`${eps.n} of ${eps.d} shortages`} />
          <p className="bt-cap">
            {eps.n} of {eps.d} shortages, one square each
          </p>
        </div>
      ) : null}
      {cp && ctl ? (
        <div className="bt-page__vs">
          <p className="bt-cap">By product, against products that never went short</p>
          <div className="bt-bar">
            <span className="bt-bar__k">Short</span>
            <span className="bt-bar__t">
              <span className="is-case" style={{ width: `${((cp.n / cp.d) / maxShare) * 100}%` }} />
            </span>
            <span className="bt-bar__v">
              {((cp.n / cp.d) * 100).toFixed(1)}%<small> {cp.n}/{cp.d}</small>
            </span>
          </div>
          <div className="bt-bar">
            <span className="bt-bar__k">Controls</span>
            <span className="bt-bar__t">
              <span className="is-ctl" style={{ width: `${((ctl.n / ctl.d) / maxShare) * 100}%` }} />
            </span>
            <span className="bt-bar__v">
              {((ctl.n / ctl.d) * 100).toFixed(1)}%<small> {ctl.n}/{ctl.d}</small>
            </span>
          </div>
        </div>
      ) : null}
      <dl className="bt-page__dl">
        <div>
          <dt>Against controls</dt>
          <dd>
            <strong>{lift !== null ? `${lift.toFixed(2).replace(/0$/, "")}×` : "n/a"}</strong> {fmtP(a.p)}
          </dd>
        </div>
        {lead ? (
          <div>
            <dt>Median lead</dt>
            <dd>
              <strong>{Math.round(lead.median)} days</strong> middle half {lead.iqr[0]} to {lead.iqr[1]}
            </dd>
          </div>
        ) : null}
      </dl>
      {side === "r" ? (
        <p className="bt-page__hind">
          <span>Hindsight.</span> An inspection counts from the day it closed, but FDA classified it OAI later, sometimes after
          the shortage was posted. A buyer on the day could not have known.
        </p>
      ) : null}
      {a.dating ? (
        <p className="bt-page__rule">
          <span>Dating rule.</span> {a.dating}
        </p>
      ) : null}
      {a.reading ? <p className="bt-page__reading">{a.reading}</p> : null}
    </article>
  );
}

function Leads({ b }: { b: BacktestSummary }) {
  const arms = [
    { k: "Dated by when it was public", a: b.strict, cls: "strict" },
    { k: "Dated by when the inspection closed", a: b.endDated, cls: "end" },
  ].filter((x) => leadOf(b, x.a));
  const ex = b.examples
    .map((e) => {
      const P = dayNumber(e.posted);
      const pre = e.events.filter((x) => x.kind !== "shortage_posted" && x.kind !== "other" && dayNumber(x.date) <= P);
      return pre.length ? { d: P - Math.min(...pre.map((x) => dayNumber(x.date))), e } : null;
    })
    .filter((x): x is { d: number; e: BacktestSummary["examples"][number] } => x !== null);
  const maxV = Math.max(300, ...arms.map((x) => leadOf(b, x.a)!.iqr[1]), ...ex.map((x) => x.d));
  const span = Math.ceil((maxV * 1.08) / 50) * 50;
  const pos = (d: number) => `${100 - Math.max(0, Math.min(100, (d / span) * 100))}%`;
  const ticks: number[] = [];
  for (let t = 0; t <= span; t += 50) ticks.push(t);
  const items = [
    ...arms.map((x) => {
      const L = leadOf(b, x.a)!;
      return { id: x.cls, text: `${x.k}: median ${Math.round(L.median)} days before the posting; the middle half of cases from ${L.iqr[1]} to ${L.iqr[0]} days before.` };
    }),
    ...ex.map((x) => ({
      id: `ex-${x.e.molecule}`,
      text: `${drugTitle(x.e.molecule)}: the first FDA action at ${x.e.plant} came ${x.d} days before FDA posted the shortage on ${fmtDate(x.e.posted)}.`,
    })),
  ];
  const [cur, setCur] = useState(items[0]?.id ?? "");
  const curItem = items.find((i) => i.id === cur) ?? items[0];
  return (
    <div className="bt-leads">
      <div className="bt-leads__plot">
        <div className="bt-leads__post" style={{ left: "100%" }}>
          <span>FDA posts the shortage</span>
        </div>
        {arms.map((x) => {
          const L = leadOf(b, x.a)!;
          return (
            <div className={`bt-leads__row bt-leads__row--${x.cls}`} key={x.cls}>
              <span className="bt-leads__k">{x.k}</span>
              <div className="bt-leads__track">
                <button
                  type="button"
                  className={`bt-leads__box${cur === x.cls ? " is-cur" : ""}`}
                  style={{ left: pos(L.iqr[1]), width: `calc(${pos(L.iqr[0])} - ${pos(L.iqr[1])})` }}
                  onClick={() => setCur(x.cls)}
                  onFocus={() => setCur(x.cls)}
                  onMouseEnter={() => setCur(x.cls)}
                  aria-label={`${x.k}: median ${Math.round(L.median)} days`}
                >
                  <span className="bt-leads__med" style={{ left: `calc(${((L.iqr[1] - L.median) / Math.max(1, L.iqr[1] - L.iqr[0])) * 100}% - 1px)` }} />
                </button>
                <span className="bt-leads__mv" style={{ left: pos(L.median) }}>
                  {Math.round(L.median)} days
                </span>
              </div>
            </div>
          );
        })}
        {ex.length ? (
          <div className="bt-leads__row bt-leads__row--ex">
            <span className="bt-leads__k">The four worked examples, first action</span>
            <div className="bt-leads__track">
              {ex.map((x, i) => (
                <button
                  type="button"
                  key={x.e.molecule}
                  className={`bt-leads__pin${cur === `ex-${x.e.molecule}` ? " is-cur" : ""}${isCounter(x.e) ? " is-counter" : ""}`}
                  style={{ left: pos(x.d) }}
                  onClick={() => setCur(`ex-${x.e.molecule}`)}
                  onFocus={() => setCur(`ex-${x.e.molecule}`)}
                  onMouseEnter={() => setCur(`ex-${x.e.molecule}`)}
                  aria-label={`${drugTitle(x.e.molecule)}, ${x.d} days`}
                >
                  <span className={`bt-leads__pinl${i % 2 ? " is-low" : ""}`}>{drugTitle(x.e.molecule).split(/[\s(']/)[0]}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="bt-leads__axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ left: pos(t) }}>
              {t}
            </span>
          ))}
        </div>
        <p className="bt-leads__unit">Days before FDA posted the shortage</p>
      </div>
      <p className="bt-leads__read" aria-live="polite">
        {curItem?.text}
      </p>
    </div>
  );
}

function BacktestBody({ b }: { b: BacktestSummary }) {
  const strictLift = liftOf(b.strict);
  const endLift = liftOf(b.endDated);
  const placedOut = b.cases.n - b.cases.withPlant;
  // Footnote marks point at the caveats by position; a mark is dropped when the run has fewer caveats.
  const N = (n: number) => (b.caveats.length >= n ? <Note n={n} /> : null);
  return (
    <>
      <section className="bt-sec" aria-labelledby="bt-set">
        <div className="wrap">
          <div className="bt-sheet bt-sheet--grid">
            <header className="bt-sheet__head">
              <h2 id="bt-set">
                The case set, fixed before the run
                {N(1)}
              </h2>
              <span className="bt-folio">p. 2</span>
            </header>
            <div className="bt-set">
              <div className="bt-set__sq">
                <Squares
                  total={b.cases.n}
                  filled={b.cases.withSignal}
                  placed={b.cases.withPlant}
                  label={`${b.cases.n} shortages: ${b.cases.withPlant} with a plant placed, ${b.cases.withSignal} with a prior FDA action`}
                />
                <ul className="bt-set__key">
                  <li>
                    <i className="is-sig" />
                    <span>
                      <strong>{b.cases.withSignal}</strong> with an FDA action at a named plant in the two years before, by either dating
                    </span>
                  </li>
                  <li>
                    <i />
                    <span>
                      <strong>{b.cases.withPlant - b.cases.withSignal}</strong> with a plant we could place, and no prior action
                    </span>
                  </li>
                  <li>
                    <i className="is-out" />
                    <span>
                      <strong>{placedOut}</strong> whose labels name no plant we can place
                      {N(6)}
                    </span>
                  </li>
                </ul>
              </div>
              <dl className="bt-def">
                <div>
                  <dt>The question</dt>
                  <dd>{b.question ?? "When FDA posted a shortage, had FDA already acted against a plant on the label?"}</dd>
                </div>
                <div>
                  <dt>Window</dt>
                  <dd>
                    {windowText(b.window)}
                    {N(4)}
                  </dd>
                </div>
                {b.signalDefinition ? (
                  <div>
                    <dt>What counts as a signal</dt>
                    <dd>
                      {b.signalDefinition}
                      {N(5)}
                    </dd>
                  </div>
                ) : null}
                {b.cases.note ? (
                  <div>
                    <dt>Who drops out</dt>
                    <dd>{b.cases.note}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section className="bt-sec bt-sec--spread" aria-labelledby="bt-res">
        <div className="wrap">
          <header className="bt-head">
            <h2 id="bt-res">Strict and end-dated, on facing pages</h2>
            <p>
              The strict count uses only what FDA had published by the posting date
              {strictLift !== null ? `, and it shows no lift: ${strictLift} times the controls, ${fmtP(b.strict.p)}` : ""}. The
              end-dated count uses hindsight about which inspections became OAI
              {endLift !== null ? `, and shows ${endLift} times the controls, ${fmtP(b.endDated.p)}` : ""}.
              {N(3)}
            </p>
          </header>
          <div className="bt-spread">
            <Page a={b.strict} b={b} name="Strict" folio={3} side="l" />
            <Page a={b.endDated} b={b} name="End-dated" folio={4} side="r">
              {N(2)}
            </Page>
          </div>
        </div>
      </section>

      <section className="bt-sec" aria-labelledby="bt-lead">
        <div className="wrap">
          <header className="bt-head">
            <h2 id="bt-lead">How long before the posting</h2>
            <p>
              For shortages that had a prior action, the gap between the first action and FDA&apos;s posting. Wide, and a median
              of about three months either way. Select a box or a pin to read it.
            </p>
          </header>
          <div className="bt-sheet bt-sheet--grid bt-sheet--pad">
            <Leads b={b} />
          </div>
        </div>
      </section>

      <section className="bt-sec bt-sec--board" aria-labelledby="bt-ctl">
        <div className="wrap">
          <header className="bt-head">
            <h2 id="bt-ctl">Controls and the base rate</h2>
            <p>
              FDA finds problems at many plants whose products never go short. The controls say how often, so a signal is read
              against the base rate and not on its own. The comparison is product against product: a shortage can cover several
              products, and the controls are products.
            </p>
          </header>
          <div className="bt-sheet bt-sheet--pad">
            <BaseRate b={b} />
            <div className="bt-notes3">
              {b.controls.note ? (
                <div>
                  <h3>How the controls were drawn</h3>
                  <p>{b.controls.note}</p>
                </div>
              ) : null}
              {b.ppv ? (
                <div>
                  <h3>If it were used as an alarm</h3>
                  <p>
                    {b.ppv.all ? `Precision across all products: ${b.ppv.all}. ` : ""}
                    {b.ppv.injectables ? `Injectables: ${b.ppv.injectables}. ` : ""}
                    {b.ppv.note}
                  </p>
                </div>
              ) : null}
              {b.recalls ? (
                <div>
                  <h3>Recalls carry little information</h3>
                  <p>
                    {b.recalls.cases ? `Shortage products: ${b.recalls.cases}. ` : ""}
                    {b.recalls.controls ? `Controls: ${b.recalls.controls}. ` : ""}
                    {b.recalls.note}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {b.examples.length ? (
        <section className="bt-sec bt-sec--board" aria-labelledby="bt-ex">
          <div className="wrap">
            <header className="bt-head">
              <h2 id="bt-ex">Four worked examples, each on its own thread</h2>
              <p>
                The actions at the plant hang from the thread; FDA&apos;s posting is the red rule. One is a counter-example, on
                purpose: a trail is not a cause.
              </p>
            </header>
            <ol className="bt-examples">
              {b.examples.map((e, i) => {
                const counter = isCounter(e);
                return (
                  <li key={i} className={`bt-ex${counter ? " bt-ex--counter" : ""}`}>
                    {counter ? <span className="bt-ex__stamp">Counter-example</span> : null}
                    <header className="bt-ex__head">
                      <h3>{e.slug ? <Link href={`/case/${e.slug}`}>{drugTitle(e.molecule)}</Link> : drugTitle(e.molecule)}</h3>
                      <p>
                        {e.labeler ? `${e.labeler}, made at ` : ""}
                        {e.plant}, {countryName(e.country)}
                        {e.fei ? (
                          <>
                            {" "}
                            <span className="bt-type">FEI {e.fei}</span>
                          </>
                        ) : null}
                      </p>
                    </header>
                    <MiniRuler events={e.events} posted={e.posted} counter={counter} />
                    <ol className="bt-ex__events">
                      {e.events.map((x, j) => (
                        <li key={j} className={`bt-ex__ev bt-ex__ev--${toneOf(x.kind)}`}>
                          <span className="bt-ex__n">{j + 1}</span>
                          <EvGlyph kind={x.kind} />
                          <span className="bt-ex__date">{fmtDate(x.date)}</span>
                          <span>{x.label}</span>
                        </li>
                      ))}
                    </ol>
                    {e.note ? <p className="bt-ex__note">{e.note}</p> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      ) : null}

      <section className="bt-sec" aria-labelledby="bt-cav">
        <div className="wrap">
          <div className="bt-sheet bt-sheet--pad bt-sheet--foot">
            <header className="bt-sheet__head">
              <h2 id="bt-cav">Notes</h2>
              <span className="bt-folio">p. 5</span>
            </header>
            <ol className="bt-footnotes">
              {b.caveats.map((c, i) => (
                <li key={i} id={`fn-${i + 1}`}>
                  <span>{c}</span>{" "}
                  <a href={`#fnref-${i + 1}`} className="bt-back" aria-label={`Back to the text for note ${i + 1}`}>
                    back
                  </a>
                </li>
              ))}
            </ol>
            {b.conclusion || findingOf(b) ? (
              <p className="bt-finding">
                <Finding b={b} lead="Finding." />
              </p>
            ) : null}
            <p className="bt-source">
              Built {fmtDate(b.builtAt)}
              {b.source ? `. ${b.source}` : ""}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

/** Shortage products against products that never went short, per product, under each dating rule. The per-shortage
 *  shares are shown beside them but not set against the controls: they count a different unit. */
function BaseRate({ b }: { b: BacktestSummary }) {
  const arms = [
    { k: "Dated by when it was public", a: b.strict, cls: "strict" },
    { k: "Dated by when the inspection closed (hindsight)", a: b.endDated, cls: "end" },
  ].map((x) => ({ ...x, cp: ofText(x.a.caseProducts), ctl: ofText(x.a.controlProducts), eps: ofText(x.a.episodesWithSignal), lift: liftOf(x.a) }));
  const max = Math.max(0.16, ...arms.flatMap((x) => [x.cp, x.ctl].map((v) => (v ? v.n / v.d : 0))));
  const top = Math.ceil(max * 20) / 20;
  const ticks = Array.from({ length: Math.round(top / 0.05) + 1 }, (_, i) => i * 0.05);
  const w = (v: { n: number; d: number } | null) => `${v ? (v.n / v.d / top) * 100 : 0}%`;
  return (
    <div className="bt-base" style={{ "--ticks": ticks.length - 1 } as CSSProperties}>
      {arms.map((x) => (
        <div className={`bt-base__grp bt-base__grp--${x.cls}`} key={x.cls}>
          <h3 className="bt-base__h">
            {x.k}
            <span>
              {x.lift !== null ? `${x.lift.toFixed(2).replace(/0$/, "")}× the controls, ` : ""}
              {fmtP(x.a.p)}
            </span>
          </h3>
          {[
            { k: "Shortage products", v: x.cp, cls: x.cls },
            { k: "Products that never went short", v: x.ctl, cls: "ctl" },
          ].map((r) => (
            <div className={`bt-base__row bt-base__row--${r.cls}`} key={r.k}>
              <span className="bt-base__k">{r.k}</span>
              <span className="bt-base__bar">
                <span style={{ width: w(r.v) }} />
              </span>
              <span className="bt-base__v">
                {pct1(r.v)}
                {r.v ? (
                  <small>
                    {" "}
                    {r.v.n}/{r.v.d}
                  </small>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ))}
      <div className="bt-base__scale" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${(t / top) * 100}%` }}>
            {Math.round(t * 100)}%
          </span>
        ))}
      </div>
      <p className="bt-base__per">
        <b>Per shortage</b>, which has no control to set it against:{" "}
        {arms
          .filter((x) => x.eps)
          .map((x) => `${x.eps!.n} of ${x.eps!.d} shortages (${fmtPct(x.a.share)}) ${x.cls === "strict" ? "dated strictly" : "dated by the close"}`)
          .join("; ")}
        .
      </p>
    </div>
  );
}

function Placeholder() {
  return (
    <div className="bt-sheet bt-sheet--pad bt-missing">
      <h3>The back-test results are not on this copy yet</h3>
      <p>
        The run reads FDA&apos;s shortage history against products that never went short. Its numbers appear here, with the
        caveats, once the run is published to this server.
      </p>
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="bt-sheet bt-sheet--pad bt-missing">
      <h3>The back-test did not load</h3>
      <p>{message} Reload the page to try again.</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="bt-home bt-home--loading" aria-busy="true" aria-label="Loading the back-test">
      <span className="bt-skel" />
      <span className="bt-skel bt-skel--s" />
    </div>
  );
}

/** The home page's summary: the finding and the two counts, as a study-record slip. */
function HomeBody({ b }: { b: BacktestSummary }) {
  const eS = ofText(b.strict.episodesWithSignal);
  const eE = ofText(b.endDated.episodesWithSignal);
  return (
    <div className="bt-home">
      <div className="bt-home__pages">
        {[
          { a: b.strict, e: eS, lift: liftOf(b.strict) },
          { a: b.endDated, e: eE, lift: liftOf(b.endDated) },
        ].map(({ a, e, lift }, i) => (
          <div className={`bt-home__page${i ? " is-r" : ""}`} key={i}>
            <span className="bt-home__k">{a.label}</span>
            <span className="bt-big">{fmtPct(a.share)}</span>
            {e ? <Squares total={e.d} filled={e.n} label={`${e.n} of ${e.d} shortages`} /> : null}
            <span className="bt-home__s">
              {e ? `${e.n} of ${e.d} shortages` : ""}
              {lift !== null ? `, ${lift}× the controls, ${fmtP(a.p)}` : ""}
            </span>
          </div>
        ))}
      </div>
      {b.conclusion || findingOf(b) ? (
        <p className="bt-home__c">
          <Finding b={b} />
        </p>
      ) : null}
      <p className="bt-home__more">
        <Link href="/backtest">The method, the worked examples and the caveats</Link>
        <span>
          {b.cases.n} shortages first posted from 2022, {b.controls.n} control products that never went short.
        </span>
      </p>
    </div>
  );
}

function HomeFetch() {
  const s = useApi<BacktestSummary>("/api/backtest", isBacktest);
  if (s.status === "loading") return <Loading />;
  if (s.status === "missing") return <Placeholder />;
  if (s.status === "error") return <Failed message={s.message} />;
  return <HomeBody b={s.data} />;
}

export function BacktestHome({ data }: { data?: BacktestSummary | null } = {}) {
  return data ? <HomeBody b={data} /> : <HomeFetch />;
}

function FullFetch() {
  const s = useApi<BacktestSummary>("/api/backtest", isBacktest);
  if (s.status === "ready") return <BacktestBody b={s.data} />;
  return (
    <section className="bt-sec">
      <div className="wrap">{s.status === "loading" ? <Loading /> : s.status === "missing" ? <Placeholder /> : <Failed message={s.message} />}</div>
    </section>
  );
}

export function BacktestFull({ data }: { data?: BacktestSummary | null } = {}) {
  return data ? <BacktestBody b={data} /> : <FullFetch />;
}
