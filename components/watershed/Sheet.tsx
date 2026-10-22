"use client";
// The engraved sheet itself: terrain, streams, springs, gauges, reservoirs and the time strip.
// Rendered once per layout; the replay engine changes the dynamic parts in place (data-d attributes).
import { memo } from "react";
import type { Hospital } from "../../src/agent/types";
import type { Frame, StreamState } from "./frame";
import { tlX } from "./frame";
import type { Geo, Line } from "./geometry";
import { at, CAP, centerD, edgesD, r1, ribbonD } from "./geometry";
import type { WsModel, WsPlant } from "./model";
import { dshort, dstr, plantState, unitWord } from "./model";

export type Pick = { kind: "plant" | "labeler" | "hospital"; key: string } | null;

const fmt = (n: number, d = 1) => Number(n).toFixed(d);
const tri = (x: number, y: number, r: number) => `M${r1(x)},${r1(y - r)}L${r1(x + r * 0.87)},${r1(y + r * 0.5)}L${r1(x - r * 0.87)},${r1(y + r * 0.5)}Z`;

export function recoveryOf(info: string | undefined): string {
  if (!info) return "";
  const m = /recovery:?\s*([^;.]+)/i.exec(info);
  if (!m) return "";
  const v = m[1].replace(/\/.*$/, "").trim();
  return v ? `recovery ${v}` : "";
}

function Stops({ id, s, y1, y2 }: { id: string; s: StreamState; y1: number; y2: number }) {
  const [c1, c2, f] = s.stops;
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} y1={r1(y1)} x2={0} y2={r1(y2)}>
      <stop data-d={`${id}:0`} offset={0} style={{ stopColor: c1 }} />
      <stop data-d={`${id}:1`} offset={Math.min(1, f)} style={{ stopColor: c1 }} />
      <stop data-d={`${id}:2`} offset={Math.min(1, f + 0.05)} style={{ stopColor: c2 }} />
      <stop data-d={`${id}:3`} offset={1} style={{ stopColor: c2 }} />
    </linearGradient>
  );
}

function Stream({ L, grad, s, dk, mobile, rid }: { L: Line; grad: string; s: StreamState; dk: string; mobile: boolean; rid: string }) {
  // one ribbon outline, drawn three times by reference: the casing, the dry bed, the water
  return (
    <g>
      <defs><path id={rid} d={ribbonD(L)} /></defs>
      <use href={`#${rid}`} className="ws-casing" />
      <use href={`#${rid}`} className="ws-bed" opacity={s.bed} data-d={`${dk}:bed`} />
      <use href={`#${rid}`} fill={`url(#${grad})`} opacity={s.water} data-d={`${dk}:water`} />
      <path d={ribbonD(L, 0.5)} className="ws-water" opacity={s.low} data-d={`${dk}:low`} />
      <path d={edgesD(L)} className={s.dash ? "ws-edge ws-edge-dry" : "ws-edge"} data-d={`${dk}:edge`} />
      <path d={centerD(L, 0.04)} className="ws-thread" strokeWidth={mobile ? 1.2 : 2} opacity={s.thread} data-d={`${dk}:thread`} />
    </g>
  );
}

interface SheetProps {
  m: WsModel;
  g: Geo;
  f: Frame;
  uid: string;
  onPick: (p: Pick) => void;
}

function SheetImpl({ m, g, f, uid, onPick }: SheetProps) {
  const mob = g.mobile;
  const labIdx = new Map(m.labelers.map((l, i) => [l.key, i]));
  const labRedFirst = [...m.labelers].sort((a, b) => (f.branch[a.key].thread > 0 ? 1 : 0) - (f.branch[b.key].thread > 0 ? 1 : 0));
  const tribOrder = g.tribs.map((t, i) => ({ t, i })).sort((a, b) => (f.trib[a.i].thread > 0 ? 1 : 0) - (f.trib[b.i].thread > 0 ? 1 : 0));
  const hosp = m.hospitals;
  const nBranch = Object.values(g.branches).reduce((a, b) => a + Object.keys(b).length, 0);
  const span = Math.max(1, m.today - m.t0);
  const X = (t: number) => tlX(m, g, t);
  const years: number[] = [];
  for (let y = new Date(m.t0 * 864e5).getUTCFullYear(); Date.UTC(y, 0, 1) / 864e5 <= m.today; y++) years.push(y);
  const yearStep = years.length > 12 ? 2 : 1;
  const monthly = span / 30.44 <= 84;
  const key = (e: React.KeyboardEvent, p: Pick) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(p); } };

  // where each tributary crosses the frontier
  const crossing = (L: Line) => {
    if (g.border === null) return null;
    let best = -1, bd = 1e9;
    L.p.forEach((p, i) => { const d = Math.abs(p[1] - g.border!); if (d < bd) { bd = d; best = i; } });
    return bd < 6 ? { p: L.p[best], w: L.w[best] } : null;
  };

  const stateClass = (tone: string) => (tone === "red" ? "ws-t-red" : tone === "amber" ? "ws-t-amber" : "");

  return (
    <>
      <svg className="ws-base" viewBox={`0 0 ${g.W} ${g.H}`} width={g.W} height={g.H} aria-hidden="true" focusable="false">
        <defs>
          <pattern id={`${uid}mud`} width={6} height={6} patternUnits="userSpaceOnUse">
            <rect width={6} height={6} className="ws-mud" />
            <circle cx={1.5} cy={1.5} r={0.55} className="ws-mud-dot" />
            <circle cx={4.6} cy={4.2} r={0.45} className="ws-mud-dot" />
          </pattern>
          {g.tribs.map((t, i) => (
            <Stops key={i} id={`${uid}t${i}`} s={f.trib[i]} y1={g.springs[t.plant].y} y2={g.gauges[t.lab].y} />
          ))}
          {m.labelers.map((l, i) => {
            const firstH = hosp.find((h) => g.branches[l.key][h.key]);
            return <Stops key={l.key} id={`${uid}l${i}`} s={f.branch[l.key]} y1={g.gauges[l.key].y} y2={firstH ? g.res[firstH.key]!.cy : g.H} />;
          })}
        </defs>
        <g className="ws-terrain">
          <path d={g.terrain.minor} className="ws-contour" />
          <path d={g.terrain.major} className="ws-contour ws-contour-major" />
          {g.terrain.hach.map((d, i) => (
            <path key={i} d={d} className="ws-hach" strokeWidth={[0.45, 0.7, 1][i] * (mob ? 0.6 : 0.8)} />
          ))}
          {g.fog && <path d={g.terrain.stipple} className="ws-stipple" strokeWidth={mob ? 0.9 : 1.1} />}
        </g>
        {g.fog && g.border === null && g.fog.x < g.W / 2 && (
          <path className="ws-fogline" d={`M${r1(g.fog.x + 10)},${r1(g.fog.y + g.fog.h)} C ${r1(g.fog.x + g.fog.w * 0.3)},${r1(g.fog.y + g.fog.h + 14)} ${r1(g.fog.x + g.fog.w * 0.6)},${r1(g.fog.y + g.fog.h - 12)} ${r1(g.W)},${r1(g.fog.y + g.fog.h + 4)}`} />
        )}
        {g.fog && !(g.border === null && g.fog.x < g.W / 2) && (
          <path
            className="ws-fogline"
            d={`M${r1(g.fog.x)},${r1(g.fog.y)} C ${r1(g.fog.x - 18)},${r1(g.fog.y + g.fog.h * 0.3)} ${r1(g.fog.x + 14)},${r1(g.fog.y + g.fog.h * 0.6)} ${r1(g.fog.x - 6)},${r1(g.fog.y + g.fog.h)} L ${r1(g.W)},${r1(g.fog.y + g.fog.h)}`}
          />
        )}
        {g.border !== null && (
          <path d={`M${mob ? g.x0 : g.x0 - 14},${g.border} L${g.fog ? g.fog.x - 10 : g.x1 + 20},${g.border}`} className="ws-frontier" />
        )}
        {hosp.map((h) => {
          const R = g.res[h.key]!;
          const shore = R.shore;
          const sp = (pts: typeof shore) => pts.map((p, i) => (i ? "L" : "M") + r1(p[0]) + "," + r1(p[1])).join("") + "Z";
          const f14 = Math.sqrt(14 / CAP);
          const ring = shore.map((p) => [R.c[0] + (p[0] - R.c[0]) * f14, R.c[1] + (p[1] - R.c[1]) * f14] as [number, number]);
          return (
            <g key={h.key}>
              <path d={sp(shore)} fill={`url(#${uid}mud)`} />
              <path d={sp(ring)} className="ws-ring14" />
              <path data-d={`p:${h.key}:pool`} className="ws-pool" d="" />
              {[0, 1, 2, 3].map((i) => <path key={i} data-d={`p:${h.key}:wl${i}`} className="ws-wl" opacity={0.5 - 0.08 * i} d="" />)}
              <path data-d={`p:${h.key}:ch`} className="ws-water" d="" />
              <path d={sp(shore)} className="ws-shore" />
            </g>
          );
        })}
        {hosp.map((h) => {
          const L = g.outs[h.key]!;
          return (
            <g key={h.key}>
              <path d={ribbonD(L)} className="ws-casing" />
              <path d={ribbonD(L)} className="ws-water" />
              <path d={edgesD(L)} className="ws-edge" />
            </g>
          );
        })}
        {g.canal && (
          <g>
            <path d={ribbonD(g.canal.L)} className="ws-water ws-fade" opacity={0} data-d="canal:water" />
            <path d={edgesD(g.canal.L)} className="ws-canal-edge" />
          </g>
        )}
        {labRedFirst.map((l) => {
          const li = labIdx.get(l.key)!;
          return hosp.map((h) => {
            const b = g.branches[l.key][h.key];
            if (!b) return null;
            return <Stream key={l.key + h.key} L={b.L} grad={`${uid}l${li}`} s={f.branch[l.key]} dk={`b:${li}:${h.key}`} mobile={mob} rid={`${uid}rb${li}_${hosp.indexOf(h)}`} />;
          });
        })}
        {tribOrder.map(({ t, i }) => (
          <Stream key={i} L={t.L} grad={`${uid}t${i}`} s={f.trib[i]} dk={`t:${i}`} mobile={mob} rid={`${uid}rt${i}`} />
        ))}
        {g.canal?.via && (() => {
          // an aqueduct where the canal crosses the middle hospital's outflow
          const out = g.outs[g.canal!.via!]!;
          const cl = g.canal!.L;
          let best = 0, bd = 1e9;
          cl.p.forEach((p, i) => { const d = Math.abs(p[0] - out.p[Math.floor(out.p.length * 0.3)][0]); if (d < bd) { bd = d; best = i; } });
          const q = cl.p[best];
          const w = cl.w[best] + 6;
          return <path d={`M${r1(q[0] - 9)},${r1(q[1] - w / 2)}h18M${r1(q[0] - 9)},${r1(q[1] + w / 2)}h18`} className="ws-bridge" />;
        })()}
      </svg>
      <canvas className="ws-flow" aria-hidden="true" />
      <svg className="ws-over" viewBox={`0 0 ${g.W} ${g.H}`} width={g.W} height={g.H}>
        <g aria-hidden="true">
          {g.countries.map((c) => (
            <text key={c.text} x={r1(c.x)} y={r1(c.y)} className="ws-sc" fontSize={c.size} textAnchor="middle">{c.text}</text>
          ))}
          {g.border !== null && !mob && (
            <>
              <text x={(g.fog ? g.fog.x - 16 : g.x1 + 16)} y={g.border - 9} className="ws-place ws-halo ws-muted" fontSize={14} textAnchor="end">FDA&rsquo;s import frontier</text>
              <text x={(g.fog ? g.fog.x - 16 : g.x1 + 16)} y={g.border + 20} className="ws-sc" fontSize={11} textAnchor="end">United States</text>
            </>
          )}
          {g.border !== null && mob && (
            <text x={g.fog ? g.fog.x - 8 : g.x1} y={g.border + 12} className="ws-sc" fontSize={8.5} textAnchor="end">United States</text>
          )}
          {g.fog && g.fog.x < g.W / 2 && (
            <g>
              <text x={r1(g.fog.x + (mob ? 16 : 24))} y={r1(g.fog.y + (mob ? 14 : 22))} className="ws-sc" fontSize={mob ? 8.5 : 12}>Unsurveyed</text>
              {!mob && <text x={r1(g.fog.x + 24)} y={r1(g.fog.y + 38)} className="ws-data ws-halo" fontSize={10.5}>named on a label, but not placed by FDA&rsquo;s register</text>}
            </g>
          )}
          {g.fog && g.fog.x >= g.W / 2 && (
            <g>
              <text x={r1(g.fog.x + g.fog.w / 2 - (mob ? 7 : 20))} y={r1(g.fog.y + (mob ? 12 : 18))} className="ws-sc" fontSize={mob ? 8.5 : 12} textAnchor="middle">Unsurveyed</text>
              {!mob && (
                <text x={r1(g.fog.x + g.fog.w / 2 - 20)} y={r1(g.fog.y + 34)} className="ws-data ws-halo" fontSize={10.5} textAnchor="middle">
                  <tspan x={r1(g.fog.x + g.fog.w / 2 - 20)}>named on a label, but not</tspan>
                  <tspan x={r1(g.fog.x + g.fog.w / 2 - 20)} dy={13}>placed by FDA&rsquo;s register</tspan>
                </text>
              )}
            </g>
          )}
        </g>

        {/* the transfer canal's label */}
        {g.canal && m.transfer && !mob && (() => {
          const q = at(g.canal.L, 0.5);
          // set against the name of the right-hand reservoir, the way a surveyor letters a cut
          const A = g.res[m.transfer.from]!, B = g.res[m.transfer.to]!;
          const right = A.cx > B.cx ? A : B;
          const lx = mob ? q.x : right.label.x - 14, ly = mob ? q.y + 16 : right.label.y - 4, an = mob ? "middle" : "end";
          return (
            <g aria-hidden="true" data-d="canal:label" className="ws-fade" opacity={0.85}>
              <text x={r1(lx)} y={r1(ly)} className="ws-place ws-halo" fontSize={mob ? 10 : 14} textAnchor={an}>
                {mob ? `Proposed cut, ${m.transfer.units}` : "Proposed cut"}
              </text>
              {!mob && (
                <text x={r1(lx)} y={r1(ly + 16)} className="ws-data ws-halo" fontSize={11} textAnchor={an}>
                  {`${m.transfer.units} ${unitWord(m.unit, m.transfer.units)}, ${m.transfer.from.replace("Corvale ", "")} to ${m.transfer.to.replace("Corvale ", "")}`}
                </text>
              )}
            </g>
          );
        })()}

        {/* gauges at each labeler */}
        <g aria-hidden="true">
          {m.labelers.map((l) => {
            const p = g.gauges[l.key];
            const half = p.w / 2 + 5;
            const left = p.labelSide === "left";
            const ax = p.labelSide === "above" ? p.x : left ? p.x - half - 8 : p.x + half + 8;
            const an = p.labelSide === "above" ? "middle" : left ? "end" : "start";
            const rec = recoveryOf(l.listing?.info);
            const flagText = `Listed short${rec ? ", " + rec : ""}`;
            return (
              <g key={l.key}>
                <path d={`M${r1(p.x - half)},${p.y}L${r1(p.x + half)},${p.y}M${r1(p.x - half)},${p.y - 4}V${p.y + 4}M${r1(p.x + half)},${p.y - 4}V${p.y + 4}`} className="ws-gauge" />
                {!g.gaugeNamed.includes(l.key) ? (
                  <path
                    d={`M${r1(p.x + half + 3)},${p.y - 1}l0,-${mob ? 11 : 13}l${mob ? 8 : 9},3.5l-${mob ? 8 : 9},3.5`}
                    className="ws-flag ws-fade" opacity={f.flag[l.key] ? 1 : 0} data-d={`flag:${labIdx.get(l.key)}`}
                  />
                ) : p.labelSide !== "above" ? (
                  <>
                    <text x={r1(ax)} y={p.y - 12} className="ws-water-t ws-halo" fontSize={19} textAnchor={an}>{l.short}</text>
                    <text x={r1(ax)} y={p.y + 5} className="ws-code ws-halo" fontSize={11} textAnchor={an}>{l.ndcs.length ? `NDC ${l.ndcs[0]}${l.ndcs.length > 1 ? ` +${l.ndcs.length - 1}` : ""}` : "no NDC on record"}</text>
                    <text x={r1(ax)} y={p.y + 20} className="ws-data ws-halo ws-ink" fontSize={11.5} textAnchor={an}>
                      {l.use > 0 ? `${fmt(l.use, 2)} ${unitWord(m.unit)} a day` : "none used now"}
                    </text>
                    <text x={r1(ax)} y={p.y + 35} className="ws-data ws-t-mag ws-halo ws-fade" fontSize={11.5} textAnchor={an} opacity={f.flag[l.key] ? 1 : 0} data-d={`flag:${labIdx.get(l.key)}`}>{flagText}</text>
                  </>
                ) : (
                  <>
                    <text x={r1(ax)} y={r1(p.y - (mob ? 13 : 26))} className="ws-water-t ws-halo" fontSize={mob ? 11.5 : 16} textAnchor="middle">{l.short}</text>
                    {!mob && (
                      <text x={r1(ax)} y={r1(p.y - 12)} className="ws-data ws-halo ws-ink" fontSize={10.5} textAnchor="middle">
                        {l.use > 0 ? `${fmt(l.use, 1)} a day` : "none used now"}
                      </text>
                    )}
                    <path
                      d={`M${r1(p.x + half + 3)},${p.y - 1}l0,-${mob ? 11 : 13}l${mob ? 8 : 9},3.5l-${mob ? 8 : 9},3.5`}
                      className="ws-flag ws-fade" opacity={f.flag[l.key] ? 1 : 0} data-d={`flag:${labIdx.get(l.key)}`}
                    />
                  </>
                )}
              </g>
            );
          })}
        </g>

        {/* stream widths, set along the branches */}
        {!mob && nBranch <= 12 && (
          <g aria-hidden="true">
            {m.labelers.flatMap((l, li) =>
              hosp.map((h, hi) => {
                const b = g.branches[l.key][h.key];
                if (!b) return null;
                const tt = [0.3, 0.55, 0.8][(li + hi) % 3];
                const q = at(b.L, tt);
                let ang = q.ang;
                if (ang > 90) ang -= 180;
                if (ang < -90) ang += 180;
                const off = b.w / 2 + 7;
                const side = li === 0 ? 1 : -1;
                const tx = q.x + q.nx * off * side, ty = q.y + q.ny * off * side;
                return (
                  <text key={l.key + h.key} x={r1(tx)} y={r1(ty)} className="ws-water-t ws-halo" fontSize={13} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${r1(ang)} ${r1(tx)} ${r1(ty)})`}>
                    {fmt(l.hospUse[h.key] ?? 0, 2)}
                  </text>
                );
              }),
            )}
          </g>
        )}

        {/* reservoirs: name, gauge staff, reading */}
        <g aria-hidden="true">
          {hosp.map((h) => {
            const R = g.res[h.key]!;
            const st = R.staff;
            return (
              <g key={h.key}>
                <rect x={st.sx} y={st.y1} width={mob ? 3.5 : 6} height={r1(st.y0 - st.y1)} className="ws-staff" />
                {Array.from({ length: Math.ceil(CAP / 2) }, (_, i) => i * 2).map((d) => (
                  <rect key={d} x={st.sx} y={r1(st.y0 - (d + 1) * st.per)} width={mob ? 3.5 : 6} height={r1(st.per)} className="ws-staff-bar" />
                ))}
                {!mob && [0, 7, 14, 21].map((d) => (
                  <text key={d} x={st.sx + 10} y={r1(st.y0 - d * st.per + 3.5)} className="ws-data" fontSize={10}>{d}</text>
                ))}
                <path data-d={`p:${h.key}:mark`} className="ws-staff-mark" d="" />
                <path data-d={`p:${h.key}:markLine`} className="ws-staff-line" d="" />
                {!mob ? (
                  <>
                    <text x={r1(R.label.x)} y={r1(R.label.y)} className="ws-place ws-halo" fontSize={19}>{h.key}</text>
                    <text x={r1(R.label.x)} y={r1(R.label.y + 37)} className="ws-big ws-halo" fontSize={36}>
                      <tspan data-d={`p:${h.key}:big`}>{h.days === null ? "n/a" : fmt(h.days, 1)}</tspan>
                      <tspan fontSize={13} className="ws-big-unit" dx={6}>days on hand</tspan>
                    </text>
                    <text x={r1(R.label.x)} y={r1(R.label.y + 56)} className="ws-data ws-halo" fontSize={11.5} data-d={`p:${h.key}:stock`}>
                      {`${fmt(h.onHand, 0)} ${unitWord(m.unit)}, ${fmt(h.use, 1)} a day, ${h.source.replace(" cabinet exports", " exports")}`}
                    </text>
                    {(() => {
                      const ox = R.outlet[0] + 16, half = Math.max(1.6, h.use * g.k) / 2;
                      const right = ox + half + 6 + 130 < g.W - 6;
                      return (
                        <text x={r1(right ? ox + half + 6 : ox - half - 6)} y={g.bottom - 12} className="ws-water-t ws-halo" fontSize={12.5} textAnchor={right ? "start" : "end"}>
                          {`to patients, ${fmt(h.use, 1)} a day`}
                        </text>
                      );
                    })()}
                  </>
                ) : (
                  <>
                    <text x={r1(R.label.x)} y={r1(R.label.y)} className="ws-place ws-halo" fontSize={12}>{h.short}</text>
                    <text x={r1(R.label.x)} y={r1(R.label.y + 21)} className="ws-big ws-halo" fontSize={20}>
                      <tspan data-d={`p:${h.key}:big`}>{h.days === null ? "n/a" : fmt(h.days, 1)}</tspan>
                      <tspan fontSize={9} className="ws-big-unit" dx={2}>days</tspan>
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </g>

        {/* springs */}
        <g aria-hidden="true">
          {m.plants.map((p) => <SpringMark key={p.key} p={p} g={g} f={f} stateClass={stateClass} m={m} crossing={crossing} />)}
        </g>

        {/* the time strip along the bottom edge of the sheet */}
        {m.replayable && <g aria-hidden="true" className="ws-strip">
          <rect x={g.tl.x0 - 10} y={g.tl.y - 26} width={g.tl.x1 - g.tl.x0 + 20} height={70} className="ws-strip-bg" />
          <path d={`M${g.tl.x0 - 10},${g.tl.y - 26}L${g.tl.x1 + 10},${g.tl.y - 26}`} className="ws-rule" />
          <rect x={g.tl.x0} y={g.tl.y} width={g.tl.x1 - g.tl.x0} height={mob ? 7 : 8} className="ws-strip-frame" />
          {monthly
            ? (() => {
                const out: React.ReactNode[] = [];
                let n = 0;
                for (const yr of years) for (let mo = 0; mo < 12; mo++) {
                  const a = Date.UTC(yr, mo, 1) / 864e5, b = Date.UTC(yr, mo + 1, 1) / 864e5;
                  if (a < m.t0) continue;
                  if (a > m.today) break;
                  if (n % 2 === 0) out.push(<rect key={`${yr}-${mo}`} x={r1(X(a))} y={g.tl.y} width={r1(X(Math.min(b, m.today)) - X(a))} height={mob ? 7 : 8} className="ws-strip-bar" />);
                  n++;
                }
                return out;
              })()
            : years.map((yr, i) => {
                const a = Date.UTC(yr, 0, 1) / 864e5, b = Math.min(m.today, Date.UTC(yr + 1, 0, 1) / 864e5);
                return i % 2 === 0 ? <rect key={yr} x={r1(X(a))} y={g.tl.y} width={r1(X(b) - X(a))} height={mob ? 7 : 8} className="ws-strip-bar" /> : null;
              })}
          {years.map((yr, i) => {
            const a = Date.UTC(yr, 0, 1) / 864e5;
            if (i % yearStep) return null;
            return (
              <g key={yr}>
                <path d={`M${r1(X(a))},${g.tl.y + (mob ? 7 : 8)}v6`} className="ws-rule" />
                <text x={r1(X(a) + 3)} y={g.tl.y + (mob ? 7 : 8) + 15} className="ws-data" fontSize={mob ? 9 : 11}>{yr}</text>
              </g>
            );
          })}
          <path data-d="tl:listed" className="ws-listed" d={f.listedFrom !== null ? `M${r1(f.listedFrom)},${g.tl.y - 3}L${r1(f.cursorX)},${g.tl.y - 3}` : ""} />
          {(() => {
            const lifts: number[] = [];
            let lastX = -1e9, lift = 0;
            return m.events.map((e, i) => {
              const x = X(e.t);
              lift = x - lastX < (mob ? 7 : 9) ? lift + 1 : 0;
              lastX = x;
              lifts.push(lift);
              const y = g.tl.y - (mob ? 9 : 11) - Math.min(lift, 3) * (mob ? 6 : 8);
              const on = f.glyph[i];
              return <Glyph key={i} kind={e.kind} x={x} y={y} r={mob ? 3.2 : 4} on={on} dk={`g:${i}`} base={g.tl.y} />;
            });
          })()}
          <g data-d="tl:cur" transform={`translate(${r1(f.cursorX)},0)`}>
            <path d={`M0,${g.tl.y - 22}L0,${g.tl.y + (mob ? 10 : 11)}`} className="ws-cursor" />
            <path d={`M-5,${g.tl.y - 26}L5,${g.tl.y - 26}L0,${g.tl.y - 19}Z`} className="ws-cursor-knob" />
          </g>
        </g>}

        {/* hit targets: every feature opens its record */}
        <g className="ws-hits">
          {m.plants.map((p) => {
            const s = g.springs[p.key];
            return (
              <circle
                key={p.key} cx={r1(s.x)} cy={r1(s.y)} r={mob ? 16 : 18} role="button" tabIndex={0}
                aria-label={`${p.unnamed ? p.fullName : p.name}${p.countryName ? ", " + p.countryName : ""}: open its FDA record`}
                onClick={() => onPick({ kind: "plant", key: p.key })} onKeyDown={(e) => key(e, { kind: "plant", key: p.key })}
              />
            );
          })}
          {m.labelers.map((l) => {
            const p = g.gauges[l.key];
            return (
              <rect
                key={l.key} x={r1(p.x - p.w / 2 - 14)} y={p.y - 22} width={r1(p.w + 28)} height={44} role="button" tabIndex={0}
                aria-label={`${l.name}: ${fmt(l.use, 2)} ${unitWord(m.unit)} a day; open the label record`}
                onClick={() => onPick({ kind: "labeler", key: l.key })} onKeyDown={(e) => key(e, { kind: "labeler", key: l.key })}
              />
            );
          })}
          {hosp.map((h) => {
            const R = g.res[h.key]!;
            return (
              <ellipse
                key={h.key} cx={r1(R.cx)} cy={r1(R.cy)} rx={r1(R.rx * 1.05)} ry={r1(R.ry * 1.1)} role="button" tabIndex={0}
                aria-label={`${h.key}: ${h.days === null ? "no daily use" : fmt(h.days, 1) + " days on hand"}; open its stock lines`}
                onClick={() => onPick({ kind: "hospital", key: h.key })} onKeyDown={(e) => key(e, { kind: "hospital", key: h.key as Hospital })}
              />
            );
          })}
        </g>
      </svg>
    </>
  );
}

export function Glyph({ kind, x, y, r, on, dk, base }: { kind: string; x: number; y: number; r: number; on: boolean; dk?: string; base?: number }) {
  const cls = `ws-glyph ws-g-${kind}${on ? " on" : ""}`;
  const stem = base !== undefined ? <path d={`M${r1(x)},${r1(base)}L${r1(x)},${r1(y + r)}`} className="ws-glyph-stem" /> : null;
  let shape: React.ReactNode;
  if (kind === "inspection_oai") shape = <rect x={r1(x - r * 0.85)} y={r1(y - r * 0.85)} width={r1(r * 1.7)} height={r1(r * 1.7)} />;
  else if (kind === "warning_letter") shape = <rect x={r1(x - r * 0.75)} y={r1(y - r * 0.75)} width={r1(r * 1.5)} height={r1(r * 1.5)} transform={`rotate(45 ${r1(x)} ${r1(y)})`} />;
  else if (kind === "import_alert") shape = <path d={tri(x, y, r * 1.1)} />;
  else if (kind === "shortage_posted") shape = <path d={`M${r1(x - r * 0.6)},${r1(y + r)}V${r1(y - r)}l${r1(r * 1.6)},${r1(r * 0.55)}l-${r1(r * 1.6)},${r1(r * 0.55)}`} />;
  else if (kind === "today") shape = <circle cx={r1(x)} cy={r1(y)} r={r1(r * 0.85)} />;
  else if (kind === "inspection_vai") shape = <circle cx={r1(x)} cy={r1(y)} r={r1(r * 0.75)} />;
  else shape = <path d={`M${r1(x - r * 0.7)},${r1(y - r * 0.7)}L${r1(x + r * 0.7)},${r1(y + r * 0.7)}M${r1(x + r * 0.7)},${r1(y - r * 0.7)}L${r1(x - r * 0.7)},${r1(y + r * 0.7)}`} />;
  return (
    <g className={cls} data-d={dk}>
      {stem}
      {shape}
    </g>
  );
}

function SpringMark({ p, g, f, m, stateClass, crossing }: {
  p: WsPlant; g: Geo; f: Frame; m: WsModel; stateClass: (t: string) => string;
  crossing: (L: Line) => { p: [number, number]; w: number } | null;
}) {
  const s = g.springs[p.key];
  const mob = g.mobile;
  const pv = f.plant[p.key];
  const r = mob ? 3.2 : 4.6;
  const fog = s.band === "fog";
  const L = s.label;
  const lines: string[] = [];
  if (!mob && !fog) {
    const labs = m.edges.filter((e) => e.plant === p.key).map((e) => m.labelers.find((l) => l.key === e.labeler)!.short);
    lines.push(`${p.countryName}${labs.length === 1 && labs[0] && !p.name.toLowerCase().startsWith(labs[0].toLowerCase().split(" ")[0]) ? `, for ${labs[0]}` : ""}`);
  }
  // cloud of turbidity: a seeded stipple
  const cloud: React.ReactNode[] = [];
  if (p.signals.some((x) => x.kind === "inspection_oai")) {
    let seed = (p.key.length * 7919) % 2147483647 || 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const R0 = mob ? 16 : 34;
    for (let i = 0; i < (mob ? 50 : 130); i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R0;
      cloud.push(<circle key={i} cx={r1(s.x + Math.cos(a) * rr * 1.3)} cy={r1(s.y + Math.sin(a) * rr * 0.8 + R0 * 0.35)} r={r1(0.5 + rnd() * 1.1)} opacity={r1(0.25 + rnd() * 0.4)} />);
    }
  }
  const tribs = g.tribs.filter((t) => t.plant === p.key);
  const letters = p.signals.filter((x) => x.kind === "warning_letter");
  // a letter gets its note only while it is in force (no classified re-inspection since); older ones keep the mark
  const letterNote = plantState(p, m.today).activeLetters > 0;
  const alerts = p.signals.filter((x) => x.kind === "import_alert");
  const prior = !mob && p.placed ? p.signals.filter((x) => (x.kind === "inspection_vai" || x.kind === "inspection_oai") && x.t < m.t0).slice(-4) : [];
  const named = g.labeled.includes(p.key);
  const showPrior = prior.length > 0 && g.sound.includes(p.key);
  const spots = [[-108, -40], [-70, -50], [-128, -22], [-36, -56]];
  const pside = s.x - 150 < g.x0 ? -1 : 1; // soundings sit on the side away from the cartouche
  const cross = tribs.map((t) => crossing(t.L)).find(Boolean) ?? null;
  return (
    <g>
      {cloud.length > 0 && <g className="ws-cloud ws-fade" opacity={pv.cloud} data-d={`c:${p.key}`}>{cloud}</g>}
      {fog ? (
        p.unnamed ? (
          <g className="ws-seep">
            <circle cx={r1(s.x)} cy={r1(s.y)} r={r * 1.7} />
            <circle cx={r1(s.x)} cy={r1(s.y)} r={r * 0.5} className="ws-seep-dot" />
          </g>
        ) : (
          <g className="ws-spring ws-spring-approx">
            <circle cx={r1(s.x)} cy={r1(s.y)} r={r * 2.3} className="ws-spring-ring" />
            <circle cx={r1(s.x)} cy={r1(s.y)} r={r} />
            <circle cx={r1(s.x)} cy={r1(s.y)} r={r * 0.35} className="ws-spring-eye" />
          </g>
        )
      ) : (
        <g className="ws-spring">
          {[1.9, 2.9].map((q, i) => <circle key={q} cx={r1(s.x)} cy={r1(s.y)} r={r1(r * q)} className="ws-spring-ring" opacity={0.45 - i * 0.15} />)}
          <circle cx={r1(s.x)} cy={r1(s.y)} r={r} />
          <circle cx={r1(s.x)} cy={r1(s.y)} r={r * 0.35} className="ws-spring-eye" />
        </g>
      )}
      <circle cx={r1(s.x)} cy={r1(s.y)} r={mob ? 7 : 10} className="ws-ring-oai ws-fade" opacity={pv.ring === "oai" ? 1 : 0} data-d={`r:${p.key}:oai`} />
      <circle cx={r1(s.x)} cy={r1(s.y)} r={mob ? 7 : 10} className="ws-ring-insp ws-fade" opacity={pv.ring === "insp" ? 1 : 0} data-d={`r:${p.key}:insp`} />
      <circle cx={r1(s.x)} cy={r1(s.y)} r={mob ? 7 : 10} className="ws-ring-vai ws-fade" opacity={pv.ring === "vai" ? 1 : 0} data-d={`r:${p.key}:vai`} />
      {showPrior && (
        <g>
          {prior.map((x, i) => (
            <text key={i} x={r1(s.x + spots[i][0] * pside)} y={r1(s.y + spots[i][1])} className="ws-water-t ws-halo ws-muted" fontSize={12} textAnchor="middle">
              {`${x.kind === "inspection_oai" ? "OAI" : "VAI"} ’${x.date.slice(2, 4)}`}
            </text>
          ))}
          <text x={r1(s.x - 82 * pside)} y={r1(s.y - 72)} className="ws-data ws-faint" fontSize={10} textAnchor="middle">earlier inspections</text>
        </g>
      )}
      {/* label */}
      {!named ? null : fog ? (
        <text x={r1(L.x)} y={r1(L.y)} className="ws-place ws-halo" fontSize={mob ? 9.5 : 13.5} textAnchor="middle">
          {p.unnamed ? (mob ? "no plant named" : `No plant on ${m.labelers.find((l) => l.plants.includes(p.key))?.short ?? "the"} label`) : mob ? p.name.split(" ")[0] : p.name.length > 22 ? p.name.split(" ").slice(0, 2).join(" ") : p.name}
          {!mob && !p.unnamed && (
            <tspan x={r1(L.x)} dy={14} className="ws-data" fontSize={10.5} fontStyle="normal">
              {p.quality === "sponsor only" ? "application sponsor only" : "named on the label"}
            </tspan>
          )}
        </text>
      ) : (
        <g>
          <text x={r1(L.x)} y={r1(L.y)} className="ws-place ws-halo" fontSize={mob ? 12 : 18} textAnchor={L.anchor}>
            {mob ? p.name.split(/\s+/).slice(0, 2).join(" ").replace(/,$/, "") : p.name}
          </text>
          {lines.map((ln, i) => (
            <text key={i} x={r1(L.x)} y={r1(L.y + 17 + i * 14.5)} className="ws-data ws-halo" fontSize={11.5} textAnchor={L.anchor}>{ln}</text>
          ))}
          {!mob && (
            <text x={r1(L.x)} y={r1(L.y + 17 + lines.length * 14.5)} className="ws-code ws-halo" fontSize={11} textAnchor={L.anchor}>
              {p.fei ? `FEI ${p.fei}` : "no FEI on file"}
            </text>
          )}
        </g>
      )}
      {named && <text
        x={r1(mob ? s.x : L.x)} y={r1(mob ? s.y + (fog ? 22 : 13) : fog ? L.y + 30 : L.y + 17 + (lines.length + 1) * 14.5)}
        className={`ws-data ws-halo ws-state ${stateClass(pv.state.tone)}`} fontSize={mob ? 8.5 : 11.5} textAnchor={mob || fog ? "middle" : L.anchor}
        data-d={`s:${p.key}`}
      >{pv.state.text}</text>}
      {/* warning letters at the plant */}
      {letters.map((x, i) => {
        const dx = (mob ? -16 : -26) - i * (mob ? 8 : 11), dy = mob ? 4 : 8;
        const cx = s.x + (L.anchor === "end" ? -dx : dx), cy = s.y + dy;
        const last = i === letters.length - 1;
        // the note goes on the far side from the label, unless that side is under the cartouche
        const cramped = (L.anchor === "start" && s.x - 170 < g.x0) || (L.anchor === "end" && s.x + 170 > g.W);
        const lx = cramped ? L.x : L.anchor === "end" ? cx + 12 : cx - 12;
        const an = cramped ? L.anchor : L.anchor === "end" ? "start" : "end";
        const ly = cramped ? L.y + 17 + (lines.length + 2) * 14.5 + 3 : cy + 16;
        const cs = /case (\d+)/.exec(x.text);
        return (
          <g key={i} className="ws-wl-mark ws-fade" opacity={pv.wl[i] ? 1 : 0} data-d={`w:${p.key}:${i}`}>
            <rect x={r1(cx - 4.5)} y={r1(cy - 4.5)} width={9} height={9} transform={`rotate(45 ${r1(cx)} ${r1(cy)})`} />
            {!mob && last && letterNote && named && (g.labeled.length <= 9 || g.sound.includes(p.key)) && (
              <text x={r1(lx)} y={r1(ly)} className="ws-data ws-halo ws-t-red" fontSize={11.5} textAnchor={an}>
                <tspan fontWeight={600}>Warning letter</tspan>
                <tspan x={r1(lx)} dy={14}>{`${dstr(x.t)}${cs ? ", case " + cs[1] : ""}`}</tspan>
              </text>
            )}
          </g>
        );
      })}
      {/* import alerts at the frontier, where this plant's water crosses it */}
      {alerts.map((x, i) => {
        const base = cross ?? { p: [s.x, s.y + (mob ? 14 : 18)] as [number, number], w: 4 };
        const cx = base.p[0] + base.w / 2 + (mob ? 13 : 20) + i * (mob ? 11 : 15);
        const cy = cross ? g.border! : base.p[1];
        const ia = /alert ([\d-]+)/i.exec(x.text);
        return (
          <g key={i} className="ws-ia-mark ws-fade" opacity={pv.ia[i] ? 1 : 0} data-d={`a:${p.key}:${i}`}>
            {i === 0 && cross && <path d={`M${r1(base.p[0] - base.w / 2 - 7)},${r1(cy)}L${r1(base.p[0] + base.w / 2 + 7)},${r1(cy)}`} className="ws-ia-bar" strokeWidth={mob ? 2.2 : 3} />}
            <path d={tri(cx, cy - 1, mob ? 4.5 : 6.5)} />
            {!mob && named && (g.labeled.length <= 9 || g.sound.includes(p.key)) && (
              <text x={r1(base.p[0] + base.w / 2 + 34 + (alerts.length - 1) * 15 > g.W - 190 ? base.p[0] - base.w / 2 - 12 : base.p[0] + base.w / 2 + 34 + (alerts.length - 1) * 15)} y={r1(cy - 6 + i * 16)} className="ws-data ws-t-mag ws-halo" fontSize={i ? 11 : 12} textAnchor={base.p[0] + base.w / 2 + 34 + (alerts.length - 1) * 15 > g.W - 190 ? "end" : "start"}>
                {i === 0 ? `Import alert${ia ? " " + ia[1] : ""}, ${dstr(x.t)}` : `listed again ${dshort(x.t)}`}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export const Sheet = memo(SheetImpl);
