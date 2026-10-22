"use client";

// The bezel, unrolled: every FDA action at our plants since 2022, one column per month. Tap a column, or focus the
// chart and use the arrow keys, to read that month's actions.
import { useMemo, useRef, useState } from "react";
import { countryName, firmCase } from "../lib/format";
import { KIND_WORD, fmtIso, toneOf } from "../chronograph/model";
import type { ChronoEvent, ChronoPlant } from "../chronograph/types";
import "./unrolled.css";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KORD: ChronoEvent["k"][] = ["oai", "wl", "inj", "sz", "ia", "vai", "nai"];

interface Item {
  p: ChronoPlant;
  e: ChronoEvent;
}

export function Unrolled({ plants, asOf }: { plants: ChronoPlant[]; asOf: string }) {
  const months = useMemo(() => {
    const y1 = +asOf.slice(0, 4);
    const m1 = +asOf.slice(5, 7) - 1;
    const out: { key: string; y: number; m: number; items: Item[] }[] = [];
    for (let y = 2022; y <= y1; y++) for (let m = 0; m < 12; m++) if (y < y1 || m <= m1) out.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, y, m, items: [] });
    const idx = new Map(out.map((o, i) => [o.key, i]));
    for (const p of plants)
      for (const e of p.events) {
        const i = idx.get(e.d.slice(0, 7));
        if (i !== undefined) out[i].items.push({ p, e });
      }
    for (const o of out) o.items.sort((a, b) => KORD.indexOf(a.e.k) - KORD.indexOf(b.e.k) || a.e.d.localeCompare(b.e.d));
    return out;
  }, [plants, asOf]);

  const busiest = useMemo(() => {
    let b = 0;
    months.forEach((m, i) => {
      const n = m.items.filter((x) => x.e.k !== "nai" && x.e.k !== "vai").length;
      const bn = months[b].items.filter((x) => x.e.k !== "nai" && x.e.k !== "vai").length;
      if (n > bn) b = i;
    });
    return b;
  }, [months]);
  const [cur, setCur] = useState(busiest);
  const svgRef = useRef<SVGSVGElement>(null);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const m of months) for (const x of m.items) t[x.e.k] = (t[x.e.k] ?? 0) + 1;
    return t;
  }, [months]);

  const n = months.length;
  const W = 1000;
  const colW = W / n;
  const STEP = 9.5;
  const maxStack = Math.max(6, ...months.map((m) => m.items.length));
  const H = 40 + maxStack * STEP + 34;
  const base = H - 34;

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return;
    const x = new DOMPoint(clientX, 0).matrixTransform(m.inverse()).x;
    setCur(Math.max(0, Math.min(n - 1, Math.floor(x / colW))));
  };

  const sel = months[cur];
  const year = (y: number) => months.findIndex((m) => m.y === y && m.m === 0);

  return (
    <div className="unr">
      <svg
        ref={svgRef}
        className="unr-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label="FDA actions at our plants by month"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={cur}
        aria-valuetext={`${MON[sel.m]} ${sel.y}: ${sel.items.length} FDA records`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons) pick(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setCur(Math.min(n - 1, cur + 1));
          else if (e.key === "ArrowLeft") setCur(Math.max(0, cur - 1));
          else if (e.key === "PageUp") setCur(Math.min(n - 1, cur + 12));
          else if (e.key === "PageDown") setCur(Math.max(0, cur - 12));
          else if (e.key === "Home") setCur(0);
          else if (e.key === "End") setCur(n - 1);
          else return;
          e.preventDefault();
        }}
      >
        <rect x={cur * colW} y={14} width={colW} height={base - 14 + 4} className="unr-cur" />
        {[2022, 2023, 2024, 2025, 2026].map((y) => {
          const i = year(y);
          if (i < 0) return null;
          return (
            <g key={y}>
              <line x1={i * colW} x2={i * colW} y1={20} y2={base + 16} className="unr-yr" />
              <text x={i * colW + 6} y={base + 28} className="unr-yl">
                {y}
              </text>
            </g>
          );
        })}
        <line x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} className="unr-ax" />
        {months.map((m, i) => (
          <g key={m.key} transform={`translate(${(i + 0.5) * colW},0)`}>
            <line x1={0} x2={0} y1={base} y2={base + (m.m % 3 === 0 ? 7 : 4)} className="unr-tk" />
            {m.items.map((x, j) => {
              const y = base - 7 - j * STEP;
              const k = x.e.k;
              return (
                <g key={j} transform={`translate(0,${y})`} className={`unr-m unr-m--${toneOf(k)}`}>
                  {k === "oai" ? <path d="M0 -4.6 L4.6 0 L0 4.6 L-4.6 0 Z" /> : null}
                  {k === "wl" || k === "inj" || k === "sz" ? <path d="M0 -4.4 L4.6 3.8 L-4.6 3.8 Z" /> : null}
                  {k === "ia" ? <rect x={-3.8} y={-3.8} width={7.6} height={7.6} /> : null}
                  {k === "vai" ? <path d="M0 -4 L4 0 L0 4 L-4 0 Z" className="o" /> : null}
                  {k === "nai" ? <circle r={3} className="o" /> : null}
                </g>
              );
            })}
          </g>
        ))}
        <text x={(cur + 0.5) * colW} y={10} textAnchor={cur < 4 ? "start" : cur > n - 5 ? "end" : "middle"} className="unr-curl">
          {MON[sel.m]} {sel.y}
        </text>
      </svg>
      <div className="unr-key" aria-hidden="true">
        <span><i className="k k--signal k--oai" />OAI {totals.oai ?? 0}</span>
        <span><i className="k k--signal k--wl" />Warning letter {(totals.wl ?? 0) + (totals.inj ?? 0) + (totals.sz ?? 0)}</span>
        <span><i className="k k--border" />Import alert {totals.ia ?? 0}</span>
        <span><i className="k k--caution" />VAI {totals.vai ?? 0}</span>
        <span><i className="k k--clear" />NAI {totals.nai ?? 0}</span>
      </div>
      <div className="unr-read" aria-live="polite">
        <h3>
          {MON[sel.m]} {sel.y}
          <span>
            {sel.items.length ? `${sel.items.length} record${sel.items.length === 1 ? "" : "s"} at our plants` : "Nothing at our plants this month"}
          </span>
        </h3>
        {sel.items.length ? (
          <ul>
            {sel.items.map((x, i) => (
              <li key={i} className={`unr-i unr-i--${toneOf(x.e.k)}`}>
                <span className="unr-d">{fmtIso(x.e.d)}</span>
                <span className="unr-k">{KIND_WORD[x.e.k]}</span>
                <button
                  type="button"
                  className="unr-p"
                  onClick={() => x.p.fei && window.dispatchEvent(new CustomEvent("upstream:plant", { detail: { fei: x.p.fei } }))}
                >
                  {firmCase(x.p.name)}, {countryName(x.p.iso)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="unr-hint">Tap a month, or focus the chart and use the arrow keys. A plant name opens it on the night map.</p>
      </div>
    </div>
  );
}
