"use client";

import Link from "next/link";
import { useApi } from "./lib/useApi";
import { countryName, dayNumber, fmtDate, fmtPct } from "./lib/format";
import { drugTitle } from "./lib/drug";
import { toneOfKind } from "./lib/trace";
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

function isBacktest(x: unknown): x is BacktestSummary {
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

function isCounter(e: BacktestSummary["examples"][number]): boolean {
  return /counter-example/i.test(e.note ?? "") || e.events.some((x) => x.kind === "other");
}

function eventTone(kind: string) {
  if (kind === "shortage_posted") return "anchor";
  return toneOfKind(kind);
}

/** A small ruler for one back-test example: the signals against the posting. */
export function MiniRuler({ events, posted }: { events: { date: string; kind: string; label: string }[]; posted: string }) {
  const W = 600;
  const H = 40;
  const P = dayNumber(posted);
  const sig = events.filter((e) => e.kind !== "shortage_posted");
  const ds = sig.map((e) => dayNumber(e.date));
  const lo = Math.min(P - 60, ...ds) - 24;
  const hi = Math.max(P + 30, ...ds) + 24;
  const x = (d: number) => 8 + ((d - lo) / (hi - lo)) * (W - 16);
  const before = sig.filter((e) => dayNumber(e.date) <= P && toneOfKind(e.kind) === "signal");
  const first = before.length ? Math.min(...before.map((e) => dayNumber(e.date))) : null;
  return (
    <svg className="mini-ruler" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={4} x2={W - 4} y1={20} y2={20} className="mr-axis" />
      {first !== null ? <line x1={x(first)} x2={x(P)} y1={20} y2={20} className="mr-lead" /> : null}
      <line x1={x(P)} x2={x(P)} y1={3} y2={37} className="mr-posted" />
      {sig.map((e, i) => (
        <circle key={i} cx={x(dayNumber(e.date))} cy={20} r={5.5} className={`mr-dot mr-dot--${toneOfKind(e.kind)}`} />
      ))}
    </svg>
  );
}

function Placeholder() {
  return (
    <div className="bt-placeholder">
      <div className="bt-pair" aria-hidden="true">
        {["Dated by when it was public", "Dated by when the inspection closed"].map((k) => (
          <div className="bt-col bt-col--ghost" key={k}>
            <span className="bt-col__k">{k}</span>
            <span className="bt-col__v">–</span>
            <span className="bt-col__s">share of shortages with an FDA action at a named plant before the posting</span>
          </div>
        ))}
      </div>
      <div className="notice">
        <span className="notice__mark" aria-hidden="true">i</span>
        <h3>The back-test results are not on this copy yet</h3>
        <p>
          The run reads FDA&apos;s shortage history against products that never went short. Its numbers appear here,
          with the caveats, once the run is published to this server.
        </p>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="bt-pair" aria-busy="true" aria-label="Loading the back-test">
      {[0, 1].map((i) => (
        <div className="bt-col" key={i}>
          <span className="skel" style={{ width: 180, height: 14 }} />
          <span className="skel" style={{ width: 110, height: 44, marginTop: 10 }} />
          <span className="skel skel-line" style={{ width: "86%" }} />
          <span className="skel skel-line" style={{ width: "60%" }} />
        </div>
      ))}
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="notice notice--error">
      <span className="notice__mark" aria-hidden="true">!</span>
      <h3>The back-test did not load</h3>
      <p>{message} Reload the page to try again.</p>
    </div>
  );
}

function ArmCol({ a, b, name }: { a: Arm; b: BacktestSummary; name: string }) {
  const lift = liftOf(a);
  const lead = leadOf(b, a);
  return (
    <div className="bt-col">
      <span className="bt-col__k">{a.label ?? name}</span>
      <span className="bt-col__v num">{fmtPct(a.share)}</span>
      <span className="bt-col__s">
        of shortages with a plant we could place had an FDA action there before the posting
        {a.episodesWithSignal ? ` (${a.episodesWithSignal.replace(/\s*\(.*\)\s*$/, "")})` : ""}.
      </span>
      <dl className="bt-col__facts">
        <div>
          <dt>Against controls</dt>
          <dd className="num">
            {lift !== null ? `${lift.toFixed(lift < 10 ? 2 : 1).replace(/0$/, "")} times` : "n/a"}, {fmtP(a.p)}
          </dd>
        </div>
        {a.caseProducts ? (
          <div>
            <dt>Products</dt>
            <dd className="num">
              {a.caseProducts} short, {a.controlProducts} controls
            </dd>
          </div>
        ) : null}
        {lead ? (
          <div>
            <dt>Median lead</dt>
            <dd className="num">
              {Math.round(lead.median)} days, middle half {lead.iqr[0]} to {lead.iqr[1]}
            </dd>
          </div>
        ) : null}
      </dl>
      {a.dating ? <p className="bt-col__dating">{a.dating}</p> : null}
      {a.reading ? <p className="bt-col__reading">{a.reading}</p> : null}
    </div>
  );
}

function Pair({ b }: { b: BacktestSummary }) {
  return (
    <div className="bt-pair">
      <ArmCol a={b.strict} b={b} name="Strict" />
      <ArmCol a={b.endDated} b={b} name="End-dated" />
    </div>
  );
}

export function BacktestHome() {
  const s = useApi<BacktestSummary>("/api/backtest", isBacktest);
  if (s.status === "loading") return <Loading />;
  if (s.status === "missing") return <Placeholder />;
  if (s.status === "error") return <Failed message={s.message} />;
  const b = s.data;
  return (
    <div className="bt-home">
      {b.conclusion ? <p className="bt-conclusion">{b.conclusion}</p> : null}
      <Pair b={b} />
      <p className="bt-home__more">
        <span className="muted small">
          {b.cases.n} shortages first posted from 2022, {b.controls.n} control products that never went short.
        </span>{" "}
        <Link href="/backtest">The method, worked examples and caveats</Link>
      </p>
    </div>
  );
}

function LeadBoxes({ b }: { b: BacktestSummary }) {
  const arms = [
    { k: "Dated by when it was public", a: b.strict, tone: "signal" },
    { k: "Dated by when the inspection closed", a: b.endDated, tone: "quiet" },
  ].filter((x) => leadOf(b, x.a));
  const exLeads = b.examples
    .map((e) => {
      const P = dayNumber(e.posted);
      const pre = e.events.filter((x) => x.kind !== "inspection_oai" && toneOfKind(x.kind) === "signal" && dayNumber(x.date) <= P);
      return pre.length ? { d: P - Math.min(...pre.map((x) => dayNumber(x.date))), m: e.molecule } : null;
    })
    .filter((x): x is { d: number; m: string } => x !== null);
  const maxV = Math.max(300, ...arms.map((x) => leadOf(b, x.a)!.iqr[1]), ...exLeads.map((x) => x.d));
  const span = Math.ceil((maxV * 1.1) / 100) * 100;
  const pos = (d: number) => `${Math.max(0, Math.min(100, (d / span) * 100))}%`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(span * t));
  return (
    <div className="bt-leads">
      {arms.map(({ k, a, tone }) => {
        const L = leadOf(b, a)!;
        return (
          <div className={`bt-lead bt-lead--${tone}`} key={k}>
            <span className="bt-lead__k">{k}</span>
            <div className="bt-lead__track" role="img" aria-label={`${k}: median ${L.median} days, middle half ${L.iqr[0]} to ${L.iqr[1]} days before the posting`}>
              <span className="bt-lead__axis" />
              <span className="bt-lead__iqr" style={{ left: pos(L.iqr[0]), width: `calc(${pos(L.iqr[1])} - ${pos(L.iqr[0])})` }} />
              <span className="bt-lead__med" style={{ left: pos(L.median) }}>
                <span className="num">{Math.round(L.median)} days</span>
              </span>
            </div>
          </div>
        );
      })}
      {exLeads.length ? (
        <div className="bt-lead bt-lead--ex">
          <span className="bt-lead__k">Worked examples, first public action</span>
          <div className="bt-lead__track">
            <span className="bt-lead__axis" />
            {exLeads.map((x, i) => (
              <span key={i} className="bt-lead__ex" style={{ left: pos(x.d) }}>
                <span className="bt-lead__exl">{drugTitle(x.m).split(" ")[0]}, {x.d}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="bt-lead bt-lead--scale" aria-hidden="true">
        <span />
        <div className="bt-lead__ticks">
          {ticks.map((t, i) => (
            <span key={t} style={{ left: `${(i / 4) * 100}%` }} className="num">
              {t}
            </span>
          ))}
        </div>
      </div>
      <p className="small muted bt-leads__note">Days before FDA posted the shortage. Boxes span the middle half of cases; the line is the median.</p>
    </div>
  );
}

export function BacktestFull() {
  const s = useApi<BacktestSummary>("/api/backtest", isBacktest);
  if (s.status === "loading")
    return (
      <section className="section">
        <div className="wrap">
          <Loading />
        </div>
      </section>
    );
  if (s.status === "missing" || s.status === "error") {
    return (
      <section className="section" aria-labelledby="bt-res">
        <div className="wrap">
          <div className="section-head">
            <h2 id="bt-res">Results</h2>
            <p className="lede">Strict and end-dated, side by side, against the control products.</p>
          </div>
          {s.status === "missing" ? <Placeholder /> : <Failed message={s.message} />}
        </div>
      </section>
    );
  }
  const b = s.data;
  const strictLift = liftOf(b.strict);
  const endLift = liftOf(b.endDated);

  return (
    <>
      <section className="section" aria-labelledby="bt-set">
        <div className="wrap">
          <div className="section-head">
            <h2 id="bt-set">The case set, fixed before the run</h2>
            <p className="lede">{b.question ?? "When FDA posted a shortage, had FDA already acted against a plant on the label?"}</p>
          </div>
          <div className="bt-setgrid">
            <ol className="bt-funnel">
              <li>
                <span className="bt-funnel__n num">{b.cases.n}</span>
                <span>shortages in the window</span>
              </li>
              <li>
                <span className="bt-funnel__n num">{b.cases.withPlant}</span>
                <span>with a manufacturing plant we could place by FEI</span>
              </li>
              <li>
                <span className="bt-funnel__n num">{b.cases.withSignal}</span>
                <span>with an FDA action at that plant in the two years before, by either dating</span>
              </li>
            </ol>
            <dl className="bt-def">
              <div>
                <dt>Window</dt>
                <dd>{windowText(b.window)}</dd>
              </div>
              {b.signalDefinition ? (
                <div>
                  <dt>What counts as a signal</dt>
                  <dd>{b.signalDefinition}</dd>
                </div>
              ) : null}
              {b.cases.note ? (
                <div>
                  <dt>Who drops out</dt>
                  <dd>{b.cases.note}</dd>
                </div>
              ) : null}
              <div>
                <dt>Built</dt>
                <dd>
                  {fmtDate(b.builtAt)}
                  {b.source ? `, by ${b.source}` : ""}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="bt-res">
        <div className="wrap">
          <div className="section-head">
            <h2 id="bt-res">Strict and end-dated, side by side</h2>
            <p className="lede">
              The strict count only uses what FDA had published by the posting date
              {strictLift !== null ? `, and it shows no lift (${strictLift} times the controls, ${fmtP(b.strict.p)})` : ""}.
              The end-dated count uses hindsight
              {endLift !== null ? `, and shows ${endLift} times the controls (${fmtP(b.endDated.p)})` : ""}.
            </p>
          </div>
          <Pair b={b} />
        </div>
      </section>

      <section className="section" aria-labelledby="bt-lead">
        <div className="wrap">
          <div className="section-head">
            <h2 id="bt-lead">How long before the posting</h2>
            <p className="lede">
              For the shortages that had a prior action, the gap between the action and FDA&apos;s posting. Wide spread,
              and a median of about three months either way.
            </p>
          </div>
          <LeadBoxes b={b} />
        </div>
      </section>

      <section className="section" aria-labelledby="bt-ctl">
        <div className="wrap">
          <div className="section-head">
            <h2 id="bt-ctl">Controls and the base rate</h2>
            <p className="lede">
              FDA finds problems at many plants whose products never go short. The controls say how often, so a signal
              is read against the base rate, not on its own.
            </p>
          </div>
          <div className="bt-base">
            <div className="bt-base__row">
              <span className="bt-base__k">Shortages, dated by when it was public</span>
              <span className="bt-base__bar"><span style={{ width: fmtPct(b.strict.share, 1) }} /></span>
              <span className="bt-base__v num">{fmtPct(b.strict.share)}</span>
            </div>
            <div className="bt-base__row bt-base__row--end">
              <span className="bt-base__k">Shortages, dated by inspection close</span>
              <span className="bt-base__bar"><span style={{ width: fmtPct(b.endDated.share, 1) }} /></span>
              <span className="bt-base__v num">{fmtPct(b.endDated.share)}</span>
            </div>
            <div className="bt-base__row bt-base__row--ctl">
              <span className="bt-base__k">Controls, {b.controls.n} products never short</span>
              <span className="bt-base__bar"><span style={{ width: fmtPct(b.controls.share, 1) }} /></span>
              <span className="bt-base__v num">{fmtPct(b.controls.share, 1)}</span>
            </div>
          </div>
          <div className="bt-notes">
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
      </section>

      {b.examples.length ? (
        <section className="section" aria-labelledby="bt-ex">
          <div className="wrap">
            <div className="section-head">
              <h2 id="bt-ex">Worked examples, each on its own ruler</h2>
              <p className="lede">The actions at the plant and the day FDA posted the shortage. One is a counter-example, on purpose.</p>
            </div>
            <ul className="bt-examples">
              {b.examples.map((e, i) => (
                <li key={i} className={`panel panel-pad bt-ex${isCounter(e) ? " bt-ex--counter" : ""}`}>
                  {isCounter(e) ? <span className="tag tag--ink bt-ex__flag">Counter-example</span> : null}
                  <div className="bt-ex__head">
                    <h3>{e.slug ? <Link href={`/case/${e.slug}`}>{drugTitle(e.molecule)}</Link> : drugTitle(e.molecule)}</h3>
                    <span className="muted small">
                      {e.labeler ? `${e.labeler}, made at ` : ""}
                      {e.plant}, {countryName(e.country)}
                    </span>
                  </div>
                  <MiniRuler events={e.events} posted={e.posted} />
                  <ol className="bt-ex__events">
                    {e.events.map((x, j) => (
                      <li key={j} className={`bt-ex__ev bt-ex__ev--${eventTone(x.kind)}`}>
                        <span className={`dot dot--${eventTone(x.kind)}`} aria-hidden="true" />
                        <span className="num bt-ex__date">{fmtDate(x.date)}</span>
                        <span>{x.label}</span>
                      </li>
                    ))}
                  </ol>
                  {e.note ? <p className="bt-ex__note">{e.note}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="section" aria-labelledby="bt-cav">
        <div className="wrap">
          <div className="section-head">
            <h2 id="bt-cav">Caveats</h2>
            <p className="lede">What these numbers can&apos;t tell you, in the run&apos;s own words.</p>
          </div>
          <ol className="bt-caveats">
            {b.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
          {b.conclusion ? <p className="bt-conclusion bt-conclusion--end">{b.conclusion}</p> : null}
        </div>
      </section>
    </>
  );
}
