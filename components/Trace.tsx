"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RulerModel, TraceModel, TraceRow, ShelfNode, RowPlant } from "./lib/trace";
import { HEALTH_WORD, toneOfHealth } from "./lib/trace";
import { countryName, firmCase, fmtDate, fmtDays } from "./lib/format";
import { useEvidence } from "./Evidence";
import { Ruler } from "./Ruler";
import "./trace.css";

/** Stages of the draw-in: shelf, NDCs, labelers, plants, FDA actions, ruler, lead. */
export const STAGES = 7;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A carton-style bar pattern derived from the NDC digits. Decorative; the number beside it is the data. */
function Barcode({ code }: { code: string }) {
  const digits = code.replace(/\D/g, "");
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  bars.push({ x, w: 1 });
  x += 2;
  for (const ch of digits) {
    const d = Number(ch);
    const w1 = 1 + (d % 3 === 0 ? 1 : 0);
    const w2 = 1 + (d % 2);
    bars.push({ x, w: w1 });
    x += w1 + 1 + (d % 2);
    bars.push({ x, w: w2 });
    x += w2 + 1 + ((d >> 1) % 2);
  }
  bars.push({ x, w: 1 });
  x += 1;
  return (
    <svg className="barcode" viewBox={`0 0 ${x} 10`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={10} />
      ))}
    </svg>
  );
}

function stageClass(stage: number, k: number) {
  return stage >= k ? " is-on" : "";
}

function ShelfCard({ s, stage, max }: { s: ShelfNode; stage: number; max: number }) {
  const ev = useEvidence();
  const days = s.days;
  const pct = days === null ? 0 : Math.max(2, Math.min(100, (days / max) * 100));
  const fine = days !== null && days >= 14;
  const body = (
    <>
      <span className="tn-title">{s.short}</span>
      <span className="shelf-days">
        <span className="shelf-days__n num">{fmtDays(days)}</span>
        <span className="shelf-days__u"> days left</span>
      </span>
      <span className={`shelf-bar${fine ? " is-fine" : ""}`} aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
        <i style={{ left: `${(14 / max) * 100}%` }} />
      </span>
      <span className="tn-meta num">
        {Math.round(s.onHand).toLocaleString("en-US")} {s.unit}s on hand, {Math.round(s.dailyUse * 10) / 10} a day
      </span>
    </>
  );
  const first = s.evidence[0];
  return ev && first ? (
    <button
      type="button"
      className={`tn tn-shelf${stageClass(stage, 1)}`}
      data-tn={`h:${s.hospital}`}
      onClick={() => ev.open(first, s.evidence)}
      aria-label={`${s.hospital}: ${fmtDays(days)} days left. Open the stock rows.`}
    >
      {body}
    </button>
  ) : (
    <div className={`tn tn-shelf${stageClass(stage, 1)}`} data-tn={`h:${s.hospital}`}>
      {body}
    </div>
  );
}

function ActionList({ rp, stage, rk }: { rp: RowPlant; stage: number; rk: string }) {
  const ev = useEvidence();
  const p = rp.plant;
  const cls = `tn tn-act${stageClass(stage, 5)}`;
  if (!p.fei && !p.signals.length) {
    return (
      <div className={cls} data-tn={`a:${rk}:${p.key}`}>
        <span className="tn-cap">What FDA recorded</span>
        <span className="act-none">No FEI on file, so FDA&apos;s inspection records can&apos;t be matched to this plant.</span>
      </div>
    );
  }
  if (!rp.actions.length) {
    return (
      <div className={cls} data-tn={`a:${rk}:${p.key}`}>
        <span className="tn-cap">What FDA recorded</span>
        <span className="tag tag--clear">No FDA action on file</span>
      </div>
    );
  }
  return (
    <div className={cls} data-tn={`a:${rk}:${p.key}`}>
      <span className="tn-cap">What FDA recorded</span>
      <ul className="act-list">
        {rp.actions.map((a) => (
          <li key={a.evidence + a.label}>
            {ev ? (
              <button type="button" className="act-btn" onClick={() => ev.open(a.evidence)}>
                <span className={`tag tag--${a.tone}`}>{a.label}</span>
                <span className="act-date num">{a.detail}</span>
              </button>
            ) : (
              <span className="act-btn">
                <span className={`tag tag--${a.tone}`}>{a.label}</span>
                <span className="act-date num">{a.detail}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {rp.quiet || rp.hidden ? (
        <span className="act-quiet">
          {rp.hidden ? `${rp.hidden} more actions; ` : ""}
          {rp.quiet ? `and ${rp.quiet}` : ""}
        </span>
      ) : null}
    </div>
  );
}

function PlantCard({ rp, stage, rk }: { rp: RowPlant; stage: number; rk: string }) {
  const ev = useEvidence();
  const p = rp.plant;
  const tone = toneOfHealth(p.health);
  const inner = (
    <>
      <span className="tn-cap">Plant on the label</span>
      <span className="tn-title">
        <span className={`dot dot--${tone}`} aria-hidden="true" /> {firmCase(p.name)}
      </span>
      <span className="tn-meta num">
        {p.country ? countryName(p.country) : "Country not on file"}
        {p.fei ? `, FEI ${p.fei}` : ""}
      </span>
      <span className="tn-meta">
        {p.lastClassification
          ? `Last classified ${p.lastClassification.classification}, ${fmtDate(p.lastClassification.endDate)}`
          : p.linkQuality === "registered plant"
            ? "No inspection on file"
            : p.linkQuality === "sponsor only"
              ? "Application holder only; the label names no plant"
              : "Named on the label, not placed in FDA's file"}
      </span>
      <span className={`tn-health tn-health--${tone}`}>{HEALTH_WORD[p.health]}</span>
    </>
  );
  const first = p.evidence[0];
  return ev && first ? (
    <button
      type="button"
      className={`tn tn-plant tn--${tone}${stageClass(stage, 4)}`}
      data-tn={`p:${rk}:${p.key}`}
      onClick={() => ev.open(first, p.evidence)}
    >
      {inner}
    </button>
  ) : (
    <div className={`tn tn-plant tn--${tone}${stageClass(stage, 4)}`} data-tn={`p:${rk}:${p.key}`}>
      {inner}
    </div>
  );
}

function RowView({ r, i, stage }: { r: TraceRow; i: number; stage: number }) {
  const ev = useEvidence();
  const ndc = (
    <>
      <span className="tn-cap">Our NDC</span>
      <Barcode code={r.packageNdc} />
      <span className="tn-title num">{r.packageNdc}</span>
      <span className="tn-meta">{r.listed ? "On FDA's shortage list" : "Not on FDA's list"}</span>
    </>
  );
  return (
    <div className="tr-row" data-row={i}>
      {ev ? (
        <button
          type="button"
          className={`tn tn-ndc${stageClass(stage, 2)}`}
          data-tn={`n:${r.key}`}
          onClick={() => ev.open(r.evidence)}
        >
          {ndc}
        </button>
      ) : (
        <div className={`tn tn-ndc${stageClass(stage, 2)}`} data-tn={`n:${r.key}`}>
          {ndc}
        </div>
      )}
      <div className={`tn tn-lab${stageClass(stage, 3)}`} data-tn={`l:${r.key}`}>
        <span className="tn-cap">Labeler</span>
        <span className="tn-title">{r.labeler}</span>
        <span className="tn-meta">Stocked at {r.hospitals.map((h) => h.replace("Corvale ", "")).join(", ") || "none"}</span>
      </div>
      <div className="tr-plants">
        {r.plants.length ? (
          r.plants.map((rp) => (
            <div className="tr-plant" key={rp.plant.key}>
              <PlantCard rp={rp} stage={stage} rk={r.key} />
              <ActionList rp={rp} stage={stage} rk={r.key} />
            </div>
          ))
        ) : (
          <div className="tr-plant">
            <div className={`tn tn-plant tn-gap${stageClass(stage, 4)}`} data-tn={`p:none-${r.key}`}>
              <span className="tn-cap">Plant on the label</span>
              <span className="tn-title">The label names no plant</span>
              <span className="tn-meta">About a third of labels don&apos;t. Upstream says so instead of guessing.</span>
            </div>
            <div className="tn tn-act tn-act--empty" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}

interface Edge {
  from: string;
  to: string;
  stage: number;
  tone?: string;
}

function edgesFor(m: TraceModel): Edge[] {
  const out: Edge[] = [];
  for (const r of m.rows) {
    for (const h of r.hospitals) out.push({ from: `h:${h}`, to: `n:${r.key}`, stage: 2 });
    out.push({ from: `n:${r.key}`, to: `l:${r.key}`, stage: 3 });
    if (!r.plants.length) out.push({ from: `l:${r.key}`, to: `p:none-${r.key}`, stage: 4, tone: "gap" });
    for (const rp of r.plants) {
      out.push({ from: `l:${r.key}`, to: `p:${r.key}:${rp.plant.key}`, stage: 4, tone: toneOfHealth(rp.plant.health) });
      out.push({ from: `p:${r.key}:${rp.plant.key}`, to: `a:${r.key}:${rp.plant.key}`, stage: 5, tone: rp.actions.some((a) => a.tone === "signal") ? "signal" : undefined });
    }
  }
  return out;
}

function Links({ host, edges, stage, version }: { host: React.RefObject<HTMLDivElement | null>; edges: Edge[]; stage: number; version: number }) {
  const [paths, setPaths] = useState<{ d: string; e: Edge; k: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (getComputedStyle(el).getPropertyValue("--trace-mode").trim() === "stack") {
      setPaths([]);
      return;
    }
    const pos = new Map<string, DOMRect>();
    el.querySelectorAll<HTMLElement>("[data-tn]").forEach((n) => pos.set(n.dataset.tn!, n.getBoundingClientRect()));
    const out: { d: string; e: Edge; k: string }[] = [];
    edges.forEach((e, i) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return;
      const ax = a.right - box.left;
      const ay = a.top - box.top + Math.min(a.height / 2, 30);
      const bx = b.left - box.left;
      const by = b.top - box.top + Math.min(b.height / 2, 30);
      const mx = (ax + bx) / 2;
      out.push({ d: `M${ax.toFixed(1)} ${ay.toFixed(1)} C${mx.toFixed(1)} ${ay.toFixed(1)} ${mx.toFixed(1)} ${by.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`, e, k: `${e.from}>${e.to}>${i}` });
    });
    setSize({ w: box.width, h: box.height });
    setPaths(out);
  }, [host, edges]);

  // Passive effect: the parent's ref is attached only after child layout effects run.
  useEffect(() => {
    measure();
    const raf = requestAnimationFrame(measure);
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [measure, version, host]);

  if (!paths.length) return null;
  return (
    <svg className="tr-links" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
      {paths.map(({ d, e, k }) => (
        <path
          key={k}
          d={d}
          pathLength={1}
          className={`tr-link${e.tone ? ` tr-link--${e.tone}` : ""}${stage >= e.stage ? " is-on" : ""}`}
        />
      ))}
    </svg>
  );
}

export function TraceChain({ model, stage }: { model: TraceModel; stage: number }) {
  const host = useRef<HTMLDivElement>(null);
  const edges = useRef(edgesFor(model));
  const max = Math.max(30, ...model.shelf.map((s) => s.days ?? 0));
  return (
    <div className="trace" ref={host}>
      <div className="trace-heads" aria-hidden="true">
        <span>Our shelf</span>
        <div className="trace-heads__row">
          <span>Our NDCs</span>
          <span>Labeler</span>
          <div className="trace-heads__plant">
            <span>Plant on the label</span>
            <span>What FDA recorded</span>
          </div>
        </div>
      </div>
      <div className="trace-grid">
        <div className="trace-shelf">
          <span className="trace-shelf__cap" aria-hidden="true">
            Our shelf, days left
          </span>
          {model.shelf.map((s) => (
            <ShelfCard key={s.hospital} s={s} stage={stage} max={max} />
          ))}
        </div>
        <div className="trace-rows">
          {model.rows.map((r, i) => (
            <RowView key={r.key} r={r} i={i} stage={stage} />
          ))}
        </div>
      </div>
      <Links host={host} edges={edges.current} stage={stage} version={model.rows.length} />
    </div>
  );
}

/**
 * The trace with its ruler. "auto" draws itself in when it scrolls into view; "controlled" follows the stage the
 * caller passes (the streaming investigation sets it as each step arrives).
 */
export function TraceAndRuler({
  trace,
  ruler,
  mode = "auto",
  stage: given,
  caption,
}: {
  trace: TraceModel;
  ruler: RulerModel;
  mode?: "auto" | "controlled" | "static";
  stage?: number;
  caption?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [auto, setAuto] = useState(mode === "static" ? STAGES : 0);
  const [run, setRun] = useState(0);
  const stage = mode === "controlled" ? (given ?? 0) : auto;

  useEffect(() => {
    if (mode !== "auto") return;
    if (reducedMotion()) {
      setAuto(STAGES);
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      setAuto(0);
      let s = 0;
      timer = setInterval(() => {
        s += 1;
        setAuto(s);
        if (s >= STAGES && timer) {
          clearInterval(timer);
        }
      }, 520);
    };
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      start();
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          start();
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearInterval(timer);
    };
  }, [mode, run]);

  return (
    <div className="trace-figure" ref={box} data-stage={stage}>
      <TraceChain model={trace} stage={stage} />
      <Ruler model={ruler} stage={stage} />
      <div className="trace-foot">
        {caption ? <div className="trace-caption">{caption}</div> : <span />}
        {mode === "auto" ? (
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() => setRun((r) => r + 1)}
            disabled={stage < STAGES}
          >
            Draw the trace again
          </button>
        ) : null}
      </div>
    </div>
  );
}
