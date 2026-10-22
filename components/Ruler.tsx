"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RulerEvent, RulerModel } from "./lib/trace";
import { dayNumber, fmtDate, fmtDateLong } from "./lib/format";
import { useEvidence } from "./Evidence";
import "./ruler.css";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

const LANE_H = 46;
const CHAR_W = 7.1;

interface Placed {
  e: RulerEvent;
  x: number;
  lane: number | null;
  align: "left" | "right";
  w: number;
}

function priority(e: RulerEvent): number {
  if (e.kind === "shortage_posted") return 0;
  if (e.tone === "signal") return 1;
  return 2;
}

function layout(model: RulerModel, width: number, maxLanes: number) {
  const dates = model.events.map((e) => dayNumber(e.date));
  if (model.posted) dates.push(dayNumber(model.posted));
  const today = dayNumber(model.today);
  let lo = Math.min(...dates);
  let hi = Math.max(...dates);
  const span0 = Math.max(hi - lo, 60);
  const pad = Math.max(24, span0 * 0.06);
  lo -= pad;
  hi += pad;
  // A long quiet stretch before today is drawn as a break, so the signals keep their room.
  const broken = today - hi > Math.max(150, (hi - lo) * 0.35);
  if (!broken) hi = Math.max(hi, today + pad * 0.5);
  const innerL = 6;
  const mainR = broken ? width * 0.84 : width - 6;
  const xOf = (d: number) => innerL + ((d - lo) / (hi - lo)) * (mainR - innerL);
  const todayX = broken ? width - 8 : xOf(today);
  const breakX = broken ? width * 0.885 : null;

  const lanes: [number, number][][] = Array.from({ length: maxLanes }, () => []);
  const order = model.events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => priority(a.e) - priority(b.e) || a.e.date.localeCompare(b.e.date));
  const placed: Placed[] = new Array(model.events.length);
  for (const { e, i } of order) {
    const x = xOf(dayNumber(e.date));
    const text = Math.max(e.label.length, fmtDate(e.date).length + 2);
    const w = text * CHAR_W + 16;
    const align: "left" | "right" = x + w > width ? "right" : "left";
    const a = align === "left" ? x - 1 : x - w + 1;
    const b = a + w;
    let lane: number | null = null;
    for (let L = 0; L < maxLanes; L++) {
      if (lanes[L].every(([p, q]) => b + 10 < p || a > q + 10)) {
        lane = L;
        lanes[L].push([a, b]);
        break;
      }
    }
    placed[i] = { e, x, lane, align, w };
  }
  const used = Math.max(1, ...placed.map((p) => (p.lane === null ? 0 : p.lane + 1)));
  const years: { x: number; y: number }[] = [];
  const y0 = new Date(lo * 86_400_000).getUTCFullYear();
  const y1 = new Date(hi * 86_400_000).getUTCFullYear();
  const step = y1 - y0 > 8 ? 2 : 1;
  for (let y = y0 + 1; y <= y1; y += step) {
    const d = Math.round(Date.UTC(y, 0, 1) / 86_400_000);
    const x = xOf(d);
    if (x > innerL + 20 && x < mainR - 10) years.push({ x, y });
  }
  return { placed, used, xOf, todayX, breakX, mainR, years };
}

function Lead({ x1, x2, y, label, tone }: { x1: number; x2: number; y: number; label: string; tone: string }) {
  return (
    <g className={`rl-lead rl-lead--${tone}`}>
      <path d={`M${x1} ${y - 6}V${y}H${x2}V${y - 6}`} />
      <text x={x2 - 2} y={y + 17} textAnchor="end">
        {label}
      </text>
    </g>
  );
}

export function Ruler({ model, stage }: { model: RulerModel; stage: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  const ev = useEvidence();

  useIso(() => {
    const el = host.current;
    if (!el) return;
    const set = () => setWidth(Math.max(320, el.getBoundingClientRect().width));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!model.events.length && !model.posted) {
    return (
      <div className="ruler ruler--empty">
        <p className="muted small">
          FDA has not posted a shortage for this drug, and no FDA action at its plants falls in the window, so there is
          nothing to put on a ruler.
        </p>
      </div>
    );
  }

  const maxLanes = width < 700 ? 3 : 4;
  const L = layout(model, width, maxLanes);
  const top = L.used * LANE_H + 6;
  const axisY = top + 18;
  const hasInsp = Boolean(model.inspectionLead);
  const height = axisY + 54 + (model.lead ? 34 : 0) + (hasInsp ? 34 : 0);
  const postedX = model.posted ? L.xOf(dayNumber(model.posted)) : null;
  const on6 = stage >= 6;
  const on7 = stage >= 7;

  const summary = summaryLine(model);

  return (
    <div className={`ruler${on6 ? " is-on" : ""}${on7 ? " is-done" : ""}`}>
      <div className="ruler-head">
        <h3 className="ruler-title">Lead-time ruler</h3>
        <p className="ruler-sum">{summary}</p>
      </div>

      <div className="ruler-canvas" ref={host} style={{ height }} aria-hidden="true">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {/* the axis, quiet before the posting, a band while FDA lists the shortage */}
          <line className="rl-axis" x1={4} x2={L.mainR} y1={axisY} y2={axisY} />
          {postedX !== null && model.stillListed ? (
            <line
              className="rl-band"
              x1={postedX}
              x2={L.breakX !== null ? L.mainR : L.todayX}
              y1={axisY}
              y2={axisY}
            />
          ) : null}
          {L.breakX !== null ? (
            <g className="rl-break">
              <line className="rl-axis" x1={L.mainR + 14} x2={L.todayX} y1={axisY} y2={axisY} />
              {model.stillListed ? <line className="rl-band" x1={L.mainR + 14} x2={L.todayX} y1={axisY} y2={axisY} /> : null}
              <path d={`M${L.breakX - 9} ${axisY + 7}l6 -14M${L.breakX - 1} ${axisY + 7}l6 -14`} />
            </g>
          ) : null}
          {L.years.map((y) => (
            <g key={y.y} className="rl-year">
              <line x1={y.x} x2={y.x} y1={axisY - 4} y2={axisY + 4} />
              <text x={y.x} y={axisY + 20} textAnchor="middle">
                {y.y}
              </text>
            </g>
          ))}
          {postedX !== null ? (
            <line className="rl-posted" x1={postedX} x2={postedX} y1={top - 6} y2={axisY + 30} />
          ) : null}
          {L.placed.map((p, i) => {
            const labelBottom = p.lane === null ? axisY - 10 : top - p.lane * LANE_H - 6;
            return (
              <g key={p.e.key} className={`rl-ev rl-ev--${p.e.tone}`} style={{ transitionDelay: `${i * 70}ms` }}>
                {p.lane !== null ? <line className="rl-leader" x1={p.x} x2={p.x} y1={labelBottom} y2={axisY} /> : null}
                <circle cx={p.x} cy={axisY} r={p.e.kind === "shortage_posted" ? 6.5 : 5} />
              </g>
            );
          })}
          <g className="rl-today">
            <circle cx={L.todayX} cy={axisY} r={4.5} />
            <text x={L.todayX} y={axisY + 20} textAnchor="end">
              Today, {fmtDate(model.today)}
            </text>
          </g>
          {on7 && model.lead && postedX !== null ? (
            <Lead
              x1={L.xOf(dayNumber(model.lead.from))}
              x2={postedX}
              y={axisY + 52}
              label={model.lead.label}
              tone="signal"
            />
          ) : null}
          {on7 && model.inspectionLead && postedX !== null ? (
            <Lead
              x1={L.xOf(dayNumber(model.inspectionLead.from))}
              x2={postedX}
              y={axisY + 52 + (model.lead ? 34 : 0)}
              label={model.inspectionLead.label}
              tone="quiet"
            />
          ) : null}
        </svg>

        {L.placed.map((p, i) => {
          if (p.lane === null) return null;
          const bottom = top - p.lane * LANE_H - 6;
          const style: React.CSSProperties = {
            top: bottom - 38,
            transitionDelay: `${i * 70}ms`,
            ...(p.align === "left" ? { left: p.x - 1 } : { right: width - p.x - 1 }),
          };
          return (
            <div key={p.e.key} className={`rl-label rl-label--${p.e.tone} rl-label--${p.align}`} style={style}>
              <span className="rl-label__t">{p.e.label}</span>
              <span className="rl-label__d num">{fmtDate(p.e.date)}</span>
            </div>
          );
        })}
      </div>

      <ol className="ruler-list">
        {model.events.map((e) => (
          <li key={e.key} className={`rl-item rl-item--${e.tone}`}>
            <span className="rl-item__date num">{fmtDate(e.date)}</span>
            <span className="rl-item__body">
              <span className="rl-item__t">{e.label}</span>
              <span className="rl-item__d">
                {e.detail}
                {e.before !== null && e.kind !== "shortage_posted" ? (
                  <span className={`rl-item__lead num${e.before > 0 ? " is-before" : ""}`}>
                    {" "}
                    {e.before > 0
                      ? `${e.before} days before the posting.`
                      : e.before === 0
                        ? "The same day as the posting."
                        : `${-e.before} days after the posting.`}
                  </span>
                ) : null}
              </span>
              {e.evidence && ev ? (
                <button type="button" className="cite num rl-item__cite" onClick={() => ev.open(e.evidence!)}>
                  {e.evidence}
                </button>
              ) : null}
            </span>
          </li>
        ))}
        <li className="rl-item rl-item--today">
          <span className="rl-item__date num">{fmtDate(model.today)}</span>
          <span className="rl-item__body">
            <span className="rl-item__t">Today</span>
            <span className="rl-item__d">
              {model.posted && model.stillListed
                ? `Still on FDA's shortage list, ${model.months} months after it was posted.`
                : model.posted
                  ? "FDA no longer lists it as current."
                  : "FDA has not posted a shortage for this drug."}
            </span>
          </span>
        </li>
      </ol>
    </div>
  );
}

export function summaryLine(model: RulerModel): string {
  const out: string[] = [];
  if (model.posted) {
    if (model.lead) {
      out.push(`${model.lead.days} days before FDA posted the shortage on ${fmtDateLong(model.posted)}, FDA had already issued ${leadNoun(model)}.`);
    } else {
      out.push(`FDA posted the shortage on ${fmtDateLong(model.posted)}. No public FDA action at our plants came in the two years before it.`);
    }
    if (model.stillListed && model.months !== null) out.push(`It is still listed, ${model.months} months on.`);
  } else {
    out.push("FDA has not posted a shortage for this drug.");
  }
  return out.join(" ");
}

function leadNoun(model: RulerModel): string {
  const e = model.events.find((x) => x.date === model.lead?.from && x.tone === "signal" && x.kind !== "inspection_oai");
  if (!e) return "an action against one of our plants";
  if (e.kind === "oai_letter") return "its OAI classification letter to the plant";
  if (e.kind === "warning_letter") return "a warning letter to the plant";
  if (e.kind === "import_alert") return "an import alert on the plant";
  return `a ${e.label.toLowerCase()}`;
}
