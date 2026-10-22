// Layout and engraving for the watershed sheet. Deterministic (seeded) so the server and the
// browser draw the same sheet. Coordinates are SVG user units; the sheet is drawn at its real width.
import type { Hospital } from "../../src/agent/types";
import type { WsModel } from "./model";

export type Pt = [number, number];
export interface Line { p: Pt[]; n: Pt[]; w: number[]; len: number; step: number }

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const r1 = (v: number) => Math.round(v * 10) / 10;
const r1f = r1;

export function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const a: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    a.push([b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0], b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1]]);
  }
  return a;
}
export function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    let d = step - carry;
    while (d <= seg) { const t = d / seg; out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); d += step; }
    carry = seg - (d - step);
  }
  const last = pts[pts.length - 1], pl = out[out.length - 1];
  if (Math.hypot(last[0] - pl[0], last[1] - pl[1]) > step * 0.3) out.push(last);
  return out;
}
export function normals(p: Pt[]): Pt[] {
  return p.map((_, i) => {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [-dy / L, dx / L] as Pt;
  });
}
export function line(pts: Pt[], wf: (t: number) => number, step = 2): Line {
  const p = resample(pts, step);
  const n = normals(p);
  const N = p.length;
  const w = p.map((_, i) => wf(i / Math.max(1, N - 1)));
  return { p, n, w, len: (N - 1) * step, step };
}
/** indices to draw: every other sample (the line is resampled at 2px) and always the last */
function idx(n: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < n; i += 2) a.push(i);
  if (a[a.length - 1] !== n - 1) a.push(n - 1);
  return a;
}
export function ribbonD(L: Line, scale = 1): string {
  const l: string[] = [], r: string[] = [];
  for (const i of idx(L.p.length)) {
    const h = (L.w[i] * scale) / 2;
    l.push(r1(L.p[i][0] + L.n[i][0] * h) + "," + r1(L.p[i][1] + L.n[i][1] * h));
    r.push(r1(L.p[i][0] - L.n[i][0] * h) + "," + r1(L.p[i][1] - L.n[i][1] * h));
  }
  return "M" + l.join("L") + "L" + r.reverse().join("L") + "Z";
}
export function edgesD(L: Line): string {
  const l: string[] = [], r: string[] = [];
  for (const i of idx(L.p.length)) {
    const h = L.w[i] / 2;
    l.push(r1(L.p[i][0] + L.n[i][0] * h) + "," + r1(L.p[i][1] + L.n[i][1] * h));
    r.push(r1(L.p[i][0] - L.n[i][0] * h) + "," + r1(L.p[i][1] - L.n[i][1] * h));
  }
  return "M" + l.join("L") + "M" + r.join("L");
}
export function centerD(L: Line, from = 0, to = 1): string {
  const a = Math.floor(from * (L.p.length - 1)), b = Math.ceil(to * (L.p.length - 1));
  return "M" + L.p.slice(a, b + 1).filter((_, i, arr) => i % 2 === 0 || i === arr.length - 1).map((q) => r1(q[0]) + "," + r1(q[1])).join("L");
}
export function at(L: Line, t: number) {
  const i = clamp(Math.round(t * (L.p.length - 1)), 0, L.p.length - 1);
  return { x: L.p[i][0], y: L.p[i][1], nx: L.n[i][0], ny: L.n[i][1], w: L.w[i], ang: (Math.atan2(L.n[i][0], -L.n[i][1]) * 180) / Math.PI };
}
export function smoothPath(pts: Pt[], closed: boolean, coarse = false): string {
  const n = pts.length;
  const r1 = coarse ? Math.round : r1f;
  if (n < 3) return "M" + pts.map((p) => r1(p[0]) + "," + r1(p[1])).join("L");
  let d = "M" + r1(pts[0][0]) + "," + r1(pts[0][1]);
  const g = (i: number) => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    d += "C" + r1(p1[0] + (p2[0] - p0[0]) / 6) + "," + r1(p1[1] + (p2[1] - p0[1]) / 6) + " " + r1(p2[0] - (p3[0] - p1[0]) / 6) + "," + r1(p2[1] - (p3[1] - p1[1]) / 6) + " " + r1(p2[0]) + "," + r1(p2[1]);
  }
  return d + (closed ? "Z" : "");
}
function hash(i: number, j: number) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
function strSeed(s: string) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) + 1; }

export const CAP = 21; // the gauge staff reads 0 to 21 days
export const poolScale = (days: number) => Math.sqrt(clamp(days, 0, CAP) / CAP);

export interface Spring { x: number; y: number; band: "foreign" | "domestic" | "fog"; label: { x: number; y: number; anchor: "start" | "end" | "middle" } }
export interface Trib { plant: string; lab: string; L: Line; w: number; ex: number }
export interface Branch { L: Line; w: number; cum0: number; cum1: number; sx: number; ex: number }
export interface Res {
  cx: number; cy: number; rx: number; ry: number; shore: Pt[]; inlet: Pt; outlet: Pt; c: Pt; inW: number;
  staff: { sx: number; y0: number; y1: number; per: number };
  label: { x: number; y: number };
}
export interface Geo {
  W: number; H: number; mobile: boolean; k: number; fs: number;
  x0: number; x1: number; top: number;
  border: number | null; fog: { x: number; y: number; w: number; h: number } | null;
  springs: Record<string, Spring>;
  gauges: Record<string, { x: number; y: number; w: number; labelSide: "left" | "right" | "above" }>;
  res: Partial<Record<Hospital, Res>>;
  tribs: Trib[];
  branches: Record<string, Partial<Record<Hospital, Branch>>>;
  outs: Partial<Record<Hospital, Line>>;
  bottom: number;
  canal: { L: Line; via: Hospital | null } | null;
  countries: { x: number; y: number; text: string; size: number }[];
  tl: { x0: number; x1: number; y: number };
  terrain: { minor: string; major: string; hach: string[]; stipple: string };
  scaleUnits: number;
  /** springs and gauges that carry names; the rest are drawn and open their record, unnamed */
  labeled: string[];
  sound: string[];
  gaugeNamed: string[];
}

export interface GeoOpts { W: number; mobile: boolean; panel: boolean }

export function layout(m: WsModel, o: GeoOpts): Geo {
  const { W, mobile } = o;
  const s = mobile ? 0.62 : 1; // vertical scale of the bands
  const x0 = mobile ? 14 : o.panel ? 430 : 40;
  const x1 = W - (mobile ? 14 : 40);
  const mw = x1 - x0;
  const fs = mobile ? 0.82 : 1;
  const top = mobile ? 54 : 74;

  const P = m.plants;
  const foreign = P.filter((p) => p.placed && !p.domestic);
  const domestic = P.filter((p) => p.placed && p.domestic);
  const fogP = P.filter((p) => !p.placed);
  // with nothing placed, the unsurveyed ground is a band across the top; otherwise a column at the right
  const allFog = fogP.length > 0 && !foreign.length && !domestic.length;
  const fogW = fogP.length && !allFog ? (mobile ? 104 : 190) : 0;
  const bandH = mobile ? 96 : 128;

  // bands
  const rowA = top + 18 * s, rowB = top + (mobile ? 64 : 76);
  const border = allFog ? null : foreign.length || fogP.length ? (foreign.length ? top + (mobile ? 118 : 168) : top + (mobile ? 70 : 90)) : null;
  const domY = (border ?? top) + (mobile ? 52 : 64);
  const gaugeY = allFog ? top + bandH + (mobile ? 96 : 120) : domestic.length ? domY + (mobile ? 122 : 150) : (border ?? top) + (mobile ? 128 : 150);
  const resCy = gaugeY + (mobile ? 196 : 250);

  // first pass: springs by longitude, foreign west to east
  const order = (arr: typeof P) => [...arr].sort((a, b) => a.lon - b.lon || a.name.localeCompare(b.name));
  const spread = (n: number, a: number, b: number) =>
    Array.from({ length: n }, (_, i) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1)));
  const springX: Record<string, number> = {};
  const fRight = x1 - fogW - (fogW ? (mobile ? 16 : 40) : 0);
  const pad = mobile ? 34 : 70;
  const fo = order(foreign);
  spread(fo.length, x0 + pad, fRight - pad * (mobile ? 0.6 : 1.6)).forEach((x, i) => (springX[fo[i].key] = x));
  const doms = order(domestic);
  spread(doms.length, x0 + pad, fRight - pad * (mobile ? 0.6 : 1.2)).forEach((x, i) => (springX[doms[i].key] = x));
  fogP.forEach((p) => (springX[p.key] = x1 - fogW / 2));

  // labelers ordered by the mean of their springs; two passes to settle domestic springs and fog
  const labs = [...m.labelers];
  const labX: Record<string, number> = {};
  const placeLabs = () => {
    labs.sort((a, b) => {
      const ma = a.plants.reduce((s2, k) => s2 + springX[k], 0) / a.plants.length;
      const mb = b.plants.reduce((s2, k) => s2 + springX[k], 0) / b.plants.length;
      return ma - mb || b.use - a.use;
    });
    const lp = mobile ? 30 : labs.length > 3 ? 56 : 90;
    spread(labs.length, x0 + lp, x1 - lp).forEach((x, i) => (labX[labs[i].key] = x));
  };
  placeLabs();
  const meanLab = (k: string) => {
    const ls = m.edges.filter((e) => e.plant === k).map((e) => labX[e.labeler]);
    return ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : 0;
  };
  const doms2 = [...domestic].sort((a, b) => meanLab(a.key) - meanLab(b.key));
  spread(doms2.length, x0 + pad, fRight - pad * (mobile ? 0.6 : 1.2)).forEach((x, i) => (springX[doms2[i].key] = x));
  // within a country, order foreign springs by their labelers too
  const byC: Record<string, typeof P> = {};
  fo.forEach((p) => (byC[p.country ?? ""] ||= []).push(p));
  const fo2 = Object.values(byC).flatMap((g) => g.sort((a, b) => meanLab(a.key) - meanLab(b.key)));
  const fxs = spread(fo2.length, x0 + pad, fRight - pad * (mobile ? 0.6 : 1.6));
  fo2.forEach((p, i) => (springX[p.key] = fxs[i]));
  placeLabs();

  const springs: Record<string, Spring> = {};
  const stagger = (mobile ? fo2.length > 2 : fo2.length > 3);
  // how many labelled springs fit across one row; past that the sheet goes dense: three rows, fewer names
  const capRow = Math.max(2, Math.floor((fRight - x0) / (mobile ? 84 : 175)));
  const rowsF = fo2.length > capRow * 2 ? 3 : stagger ? 2 : 1;
  const rowY = [rowA, rowB, rowA + (rowB - rowA) * 0.5 + (mobile ? 10 : 16)];
  fo2.forEach((p, i) => {
    const y = rowsF > 1 ? rowY[i % rowsF] : rowA + 22 * s;
    springs[p.key] = { x: springX[p.key], y, band: "foreign", label: { x: 0, y: 0, anchor: "start" } };
  });
  const dstag = mobile ? doms2.length > 2 : doms2.length > 3;
  const rowsD = doms2.length > capRow * 2 ? 3 : dstag ? 2 : 1;
  doms2.forEach((p, i) => {
    springs[p.key] = { x: springX[p.key], y: domY + (rowsD > 1 ? (i % rowsD) * (mobile ? 24 : rowsD === 3 ? 28 : 40) : 0), band: "domestic", label: { x: 0, y: 0, anchor: "start" } };
  });
  // which springs carry names: FDA's findings first, then the biggest flows, as many as fit
  const useOf = (k: string) => m.edges.filter((e) => e.plant === k).reduce((a, e) => a + e.use, 0);
  const storyScore = (p: (typeof P)[number]) => (p.signals.some((x) => x.kind === "inspection_oai" || x.kind === "warning_letter") ? 2 : 0) + (p.signals.some((x) => x.kind === "import_alert") ? 1 : 0);
  const pickNamed = (arr: typeof P, n: number) => [...arr].sort((a, b) => storyScore(b) - storyScore(a) || useOf(b.key) - useOf(a.key)).slice(0, n).map((p) => p.key);
  const labeled = [
    ...pickNamed(fo2, capRow * Math.min(rowsF, 2)),
    ...pickNamed(doms2, capRow * Math.min(rowsD, 2)),
    ...(fogP.length <= (mobile ? 3 : 5) ? fogP.map((p) => p.key) : []),
  ];
  const sound = pickNamed(P.filter((p) => p.placed && storyScore(p) >= 2), 2);
  // fog: stack within the unsurveyed ground
  const fogTop = top - (mobile ? 18 : 30);
  const fogBot = gaugeY - (mobile ? 60 : 88);
  const fog = !fogP.length ? null : allFog
    ? { x: x0 - (mobile ? 14 : 10), y: fogTop, w: W - x0 + (mobile ? 14 : 10), h: bandH + (mobile ? 18 : 30) }
    : { x: x1 - fogW, y: fogTop, w: fogW + (mobile ? 14 : 40), h: fogBot - fogTop };
  const fogSorted = [...fogP].sort((a, b) => meanLab(a.key) - meanLab(b.key));
  fogSorted.forEach((p, i) => {
    const n = fogSorted.length;
    let y = fogTop + (fogBot - fogTop) * ((i + 0.7) / (n + 0.4));
    let x = x1 - fogW / 2 + (n > 1 ? (i % 2 ? 1 : -1) * fogW * 0.16 : 0);
    if (allFog) {
      x = n === 1 ? (x0 + x1) / 2 : x0 + pad + ((x1 - x0 - 2 * pad) * i) / (n - 1);
      y = fogTop + (mobile ? 52 : 66) + (n > 3 && i % 2 ? (mobile ? 24 : 30) : 0);
    } else if (border !== null && Math.abs(y - border) < 36) y = y < border ? border - 36 : border + 36;
    springs[p.key] = { x, y, band: "fog", label: { x: 0, y: 0, anchor: "middle" } };
  });

  // stream scale: px per unit a day
  const maxHosp = Math.max(1e-6, ...m.hospitals.map((h) => h.use));
  const maxLab = Math.max(1e-6, ...m.labelers.map((l) => l.use));
  const slotL = mw / Math.max(1, labs.length);
  const k = Math.min(mobile ? 2.15 : 4.7, (mobile ? 30 : 76) / maxHosp, (slotL * (mobile ? 0.42 : 0.36)) / maxLab);
  const minW = mobile ? 1.1 : 1.6;
  const wOf = (u: number) => (u > 0 ? Math.max(minW, u * k) : minW * 0.8);

  const gauges: Geo["gauges"] = {};
  labs.forEach((l) => {
    let side: "left" | "right" | "above" = labs.length <= 3 && !mobile ? "right" : "above";
    if (side === "right") {
      const est = Math.max(l.short.length * 10.5, 150);
      if (labX[l.key] + wOf(l.use) / 2 + 13 + est > W - 6) side = "left";
    }
    gauges[l.key] = { x: labX[l.key], y: gaugeY, w: wOf(l.use), labelSide: side };
  });
  const capG = Math.max(3, Math.floor(mw / (mobile ? 58 : 104)));
  const gaugeNamed: string[] = [];
  const gapG = labs.length <= 3 && !mobile ? 0 : mobile ? 54 : 104;
  for (const l of [...labs].sort((a, b) => Number(b.listed) - Number(a.listed) || b.use - a.use)) {
    if (gaugeNamed.length >= capG) break;
    if (gaugeNamed.every((k2) => Math.abs(labX[k2] - labX[l.key]) >= gapG)) gaugeNamed.push(l.key);
  }

  // reservoirs
  const res: Geo["res"] = {};
  const nh = m.hospitals.length;
  const rslot = mw / Math.max(nh, mobile ? 3 : 2.6);
  const rcx = spread(nh, x0 + rslot / 2 + (nh < 3 ? mw * 0.08 : 0), x1 - rslot / 2 - (nh < 3 ? mw * 0.08 : 0));
  m.hospitals.forEach((h, hi) => {
    const rx = Math.min(mobile ? 50 : 132, rslot * (mobile ? 0.36 : 0.34));
    const ry = rx * (mobile ? 0.6 : 0.44);
    const cx = rcx[hi], cy = resCy;
    const N = 96, ph = hi * 1.7 + 0.4;
    const shore: Pt[] = [];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const rr = 1 + 0.07 * Math.sin(3 * th + ph) + 0.045 * Math.sin(5 * th + ph * 2.1) + 0.025 * Math.sin(8 * th + ph * 0.7);
      shore.push([cx + rx * rr * Math.cos(th), cy + ry * rr * Math.sin(th)]);
    }
    const topP = shore[Math.round(N * 0.75)];
    const bot = shore[Math.round(N * 0.16)];
    const sx = cx + rx + (mobile ? 6 : 20), y0 = cy + (mobile ? 2 : 4), y1 = cy - ry - (mobile ? 8 : 16);
    res[h.key] = {
      cx, cy, rx, ry, shore, inlet: [cx, topP[1]], outlet: [bot[0] - 2, bot[1] - 2], c: [cx, cy + ry * 0.12], inW: wOf(h.use),
      staff: { sx, y0, y1, per: (y0 - y1) / CAP },
      label: { x: cx - rx * 0.95, y: cy + ry + (mobile ? 20 : 32) },
    };
  });

  // tributaries: spring to gauge, stacked at the gauge by spring x, fanned at the spring by gauge x
  const tribs: Trib[] = [];
  const rand = rng(strSeed(m.molecule));
  labs.forEach((l) => {
    const g = gauges[l.key];
    const es = m.edges.filter((e) => e.labeler === l.key).sort((a, b) => springs[a.plant].x - springs[b.plant].x);
    const tot = es.reduce((a, e) => a + wOf(e.use), 0);
    let cum = 0;
    es.forEach((e) => {
      const w = wOf(e.use);
      const ex = g.x - tot / 2 + cum + w / 2;
      cum += w;
      tribs.push({ plant: e.plant, lab: l.key, L: null as unknown as Line, w, ex });
    });
  });
  Object.keys(springs).forEach((pk) => {
    const ts = tribs.filter((t) => t.plant === pk).sort((a, b) => a.ex - b.ex);
    const sp = springs[pk];
    const tot = ts.reduce((a, t) => a + t.w, 0);
    let cum = 0;
    ts.forEach((t, ti) => {
      const sx = sp.x - tot / 2 + cum + t.w / 2;
      cum += t.w;
      const s0: Pt = [sp.x + (sx - sp.x) * 0.3, sp.y + 4];
      const e: Pt = [t.ex, gaugeY];
      const dy = e[1] - s0[1];
      const pts = cubic(s0, [s0[0], s0[1] + dy * 0.38], [e[0], e[1] - dy * 0.45], e, 60);
      let L0 = resample(pts, 2);
      const nn = normals(L0);
      const len = L0.length;
      const A = (mobile ? 6 : 15) * (0.7 + rand() * 0.5) * Math.min(1, Math.abs(dy) / 220);
      const ph = rand() * 6 + ti;
      L0 = L0.map((p, i) => {
        const tt = i / (len - 1);
        const off = A * Math.sin(tt * Math.PI * 3.2 + ph) * Math.pow(1 - tt, 1.4) * Math.sin((Math.min(1, tt * 4) * Math.PI) / 2);
        return [p[0] + nn[i][0] * off, p[1] + nn[i][1] * off] as Pt;
      });
      const startW = Math.min(t.w, minW);
      t.L = line(L0, (tt) => startW + (t.w - startW) * smooth(0, 0.6, tt));
    });
  });

  // branches: gauge to reservoir, a Sankey stack at both ends
  const branches: Geo["branches"] = {};
  labs.forEach((l) => {
    branches[l.key] = {};
    const tgt = m.hospitals.filter((h) => (l.hospUse[h.key] ?? 0) > 0).sort((a, b) => res[a.key]!.cx - res[b.key]!.cx);
    const g = gauges[l.key];
    const tot = tgt.reduce((a, h) => a + wOf(l.hospUse[h.key] ?? 0), 0);
    let cum = 0;
    tgt.forEach((h) => {
      const w = wOf(l.hospUse[h.key] ?? 0);
      branches[l.key][h.key] = { L: null as unknown as Line, w, cum0: cum / tot, cum1: (cum + w) / tot, sx: g.x - tot / 2 + cum + w / 2, ex: 0 };
      cum += w;
    });
  });
  m.hospitals.forEach((h) => {
    const R = res[h.key]!;
    const src = labs.filter((l) => branches[l.key][h.key]).sort((a, b) => gauges[a.key].x - gauges[b.key].x);
    const tot = src.reduce((a, l) => a + branches[l.key][h.key]!.w, 0);
    R.inW = Math.max(R.inW, tot);
    let cum = 0;
    src.forEach((l) => {
      const b = branches[l.key][h.key]!;
      b.ex = R.inlet[0] - tot / 2 + cum + b.w / 2;
      cum += b.w;
      const sy = gaugeY, ey = R.inlet[1] + 1.5, dy = ey - sy;
      b.L = line(cubic([b.sx, sy], [b.sx, sy + dy * 0.52], [b.ex, ey - dy * 0.52], [b.ex, ey], 70), () => b.w);
    });
  });

  // outflows to patients
  const tlY = 0; // set after H
  // the cartouche and the record need about 900px beside the map
  const strip = m.replayable ? 0 : mobile ? 40 : 48;
  const H = Math.round(Math.max(resCy + (mobile ? 150 : 236) - strip, o.panel && !mobile ? 940 : 0));
  const bottom = H - (mobile ? 64 : 72) + strip;
  const outs: Geo["outs"] = {};
  m.hospitals.forEach((h) => {
    const R = res[h.key]!;
    const w = wOf(h.use);
    const s0 = R.outlet;
    const e: Pt = [R.outlet[0] + (mobile ? 4 : 16), bottom];
    outs[h.key] = line(cubic(s0, [s0[0] + 8, s0[1] + 24], [e[0], e[1] - 40], e, 30), (t) => w * (1 - 0.15 * t));
  });

  // the proposed canal for the best transfer
  let canal: Geo["canal"] = null;
  if (m.transfer) {
    const A = res[m.transfer.from]!, B = res[m.transfer.to]!;
    const dir = Math.sign(B.cx - A.cx) || 1;
    const s0: Pt = [A.cx + dir * A.rx * 0.62, A.cy + A.ry * 0.25];
    const e: Pt = [B.cx - dir * B.rx * 0.66, B.cy + B.ry * 0.3];
    const between = m.hospitals.filter((h) => { const c = res[h.key]!.cx; return (c - A.cx) * (c - B.cx) < 0; });
    const dip = between.length ? (mobile ? 46 : 92) : mobile ? 16 : 32;
    const L = line(cubic(s0, [s0[0] + (e[0] - s0[0]) * 0.3, s0[1] + dip * 1.3], [e[0] - (e[0] - s0[0]) * 0.3, e[1] + dip * 1.3], e, 50), () => (mobile ? 5 : 9));
    canal = { L, via: between[0]?.key ?? null };
  }

  // country names in the hills
  const countries: Geo["countries"] = [];
  Object.entries(byC).forEach(([iso, ps]) => {
    if (!iso) return;
    const xs = ps.map((p) => springs[p.key].x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const wName = ps[0].countryName.length * (mobile ? 9 : 13);
    if (countries.some((c) => Math.abs(c.x - cx) < (wName + c.text.length * (mobile ? 9 : 13)) / 2 + 12)) return;
    countries.push({ x: cx, y: (border ?? top) - (mobile ? 14 : 26), text: ps[0].countryName, size: mobile ? 9.5 : 14 });
  });

  // label placement for springs: right, left, above; avoid other springs and labels
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  // in a dense sheet the names may sit over unnamed springs (the halo keeps them legible)
  if (labeled.length <= 9) Object.values(springs).forEach((sp) => boxes.push({ x0: sp.x - 8, y0: sp.y - 8, x1: sp.x + 8, y1: sp.y + 8 }));
  if (border !== null && !mobile) {
    const fx = fog ? fog.x - 16 : x1 + 16;
    boxes.push({ x0: fx - 150, y0: border - 24, x1: fx, y1: border + 26 });
  }
  const hit = (b: { x0: number; y0: number; x1: number; y1: number }) => boxes.some((c) => b.x0 < c.x1 && b.x1 > c.x0 && b.y0 < c.y1 && b.y1 > c.y0);
  const ordered = Object.entries(springs).sort((a, b) => a[1].x - b[1].x);
  const dense = labeled.length > 9;
  // story springs claim their places first
  const rank = (k: string) => (sound.includes(k) ? 0 : 1);
  ordered.filter(([pk]) => labeled.includes(pk)).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1].x - b[1].x).forEach(([pk, sp]) => {
    const p = P.find((q) => q.key === pk)!;
    const wpx = Math.max(p.name.length * (mobile ? 6 : 8.6), mobile ? 60 : 120) * (sp.band === "fog" && mobile ? 0.8 : 1);
    const hpx = mobile ? 26 : 62;
    if (sp.band === "fog") {
      sp.label = { x: sp.x, y: sp.y + (mobile ? 18 : 22), anchor: "middle" };
      return;
    }
    if (mobile) {
      // keep the name on the sheet: two words of 12px italic, about 5.6px a letter
      const half = (p.name.split(/\s+/).slice(0, 2).join(" ").length * 5.6) / 2 + 4;
      sp.label = { x: clamp(sp.x, half, W - half), y: sp.y - 12, anchor: "middle" };
      return;
    }
    const cands: Spring["label"][] = [
      { x: sp.x + 14, y: sp.y + 4, anchor: "start" },
      { x: sp.x - 14, y: sp.y + 4, anchor: "end" },
      { x: sp.x + 14, y: sp.y - 30, anchor: "start" },
      { x: sp.x - 14, y: sp.y - 30, anchor: "end" },
    ];
    const boxOf = (c: Spring["label"]) => (c.anchor === "start" ? { x0: c.x, y0: c.y - 16, x1: c.x + wpx, y1: c.y - 16 + hpx } : { x0: c.x - wpx, y0: c.y - 16, x1: c.x, y1: c.y - 16 + hpx });
    let pick = cands.find((c) => { const b = boxOf(c); return b.x1 < x1 + 30 && b.x0 > x0 - 20 && !hit(b); });
    if (!pick && dense) { labeled.splice(labeled.indexOf(pk), 1); return; } // dense: leave it unnamed
    if (!pick) pick = cands.find((c) => { const b = boxOf(c); return b.x1 < x1 + 30 && b.x0 > x0 - 20; }) ?? cands[0];
    sp.label = pick;
    boxes.push(boxOf(pick));
  });

  const tl = { x0: mobile ? 12 : 24, x1: W - (mobile ? 12 : 24), y: H - (mobile ? 36 : 40) };
  void tlY;

  const geo: Geo = {
    W, H, mobile, k, fs, x0, x1, top, border, fog, springs, gauges, res, tribs, branches, outs, bottom, canal, countries, tl, labeled, sound, gaugeNamed,
    terrain: { minor: "", major: "", hach: [], stipple: "" }, scaleUnits: niceUnits(k, mobile),
  };
  geo.terrain = terrain(geo);
  return geo;
}

/** a legend sample worth a round number of units a day, about 8 to 24px wide */
function niceUnits(k: number, mobile: boolean): number {
  const target = (mobile ? 9 : 12) / k;
  const steps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200];
  return steps.reduce((b, s) => (Math.abs(Math.log(s / target)) < Math.abs(Math.log(b / target)) ? s : b), 1);
}

/* ---------- terrain: a height field, contoured and hachured ---------- */
function terrain(g: Geo): Geo["terrain"] {
  const { W, H, mobile } = g;
  const cell = mobile ? 10 : 14;
  const nx = Math.ceil(W / cell) + 1, ny = Math.ceil(H / cell) + 1;
  const S = mobile ? 0.45 : 1;
  // river samples for valley carving, on a coarse grid for speed
  const rs: number[] = [];
  g.tribs.forEach((t) => { for (let i = 0; i < t.L.p.length; i += 5) rs.push(t.L.p[i][0], t.L.p[i][1]); });
  Object.values(g.branches).forEach((bs) => Object.values(bs).forEach((b) => { if (b) for (let i = 0; i < b.L.p.length; i += 6) rs.push(b.L.p[i][0], b.L.p[i][1]); }));
  Object.values(g.outs).forEach((L) => { if (L) for (let i = 0; i < L.p.length; i += 6) rs.push(L.p[i][0], L.p[i][1]); });
  const B = 48;
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < rs.length; i += 2) {
    const k = Math.floor(rs[i] / B) * 1000 + Math.floor(rs[i + 1] / B);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(rs[i], rs[i + 1]);
  }
  const nearest2 = (x: number, y: number, r: number) => {
    let d = 1e9;
    const bx = Math.floor(x / B), by = Math.floor(y / B), rr = Math.ceil(r / B);
    for (let i = -rr; i <= rr; i++) for (let j = -rr; j <= rr; j++) {
      const arr = buckets.get((bx + i) * 1000 + by + j);
      if (!arr) continue;
      for (let q = 0; q < arr.length; q += 2) { const dx = x - arr[q], dy = y - arr[q + 1]; const dd = dx * dx + dy * dy; if (dd < d) d = dd; }
    }
    return d;
  };
  const peaks: [number, number, number][] = [];
  Object.values(g.springs).forEach((sp, i) => {
    if (sp.band === "foreign") peaks.push([sp.x + ((i % 3) - 1) * 18 * S, sp.y - 34 * S, 0.5 + (i % 2) * 0.1]);
    if (sp.band === "domestic") peaks.push([sp.x, sp.y - 18 * S, 0.3]);
  });
  const fsp = Object.values(g.springs).filter((s) => s.band === "foreign");
  for (let i = 0; i + 1 < fsp.length; i++) peaks.push([(fsp[i].x + fsp[i + 1].x) / 2, 40 * S, 0.38]);
  if (!fsp.length) peaks.push([(g.x0 + g.x1) / 2, 30 * S, 0.3]);
  const res = Object.values(g.res);
  const hf = (x: number, y: number) => {
    let h = 0.62 * Math.pow(clamp(1 - y / (H * 0.98), 0, 1), 1.5);
    for (const p of peaks) { const dx = (x - p[0]) / (150 * S), dy = (y - p[1]) / (110 * S); h += p[2] * Math.exp(-(dx * dx + dy * dy)); }
    const dmin = nearest2(x, y, 34 * S * 2.4);
    h -= 0.17 * Math.exp(-dmin / Math.pow(34 * S, 2));
    for (const R of res) { if (!R) continue; const dx = (x - R.cx) / (R.rx * 1.5), dy = (y - R.cy) / (R.ry * 1.9); h -= 0.16 * Math.exp(-(dx * dx + dy * dy)); }
    h += 0.07 * vnoise(x / (95 * S), y / (95 * S)) + 0.03 * vnoise(x / (38 * S) + 9, y / (38 * S) + 3);
    return h;
  };
  const F = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[j * nx + i] = hf(i * cell, j * cell);
  const march = (Fa: Float32Array, z: number) => {
    const v = (i: number, j: number) => Fa[j * nx + i];
    const out: { pts: Pt[]; closed: boolean }[] = [];
    const segs: [number, number][] = [];
    const pos = new Map<number, Pt>();
    const eid = (i: number, j: number, dir: number) => (j * nx + i) * 2 + dir;
    const ip = (i: number, j: number, dir: number): Pt => {
      const a = v(i, j), b = dir === 0 ? v(i + 1, j) : v(i, j + 1);
      const t = (z - a) / (b - a);
      return dir === 0 ? [(i + t) * cell, j * cell] : [i * cell, (j + t) * cell];
    };
    const PAIRS: Record<number, [number, number][]> = {
      1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[3, 0], [2, 1]], 6: [[0, 2]], 7: [[3, 0]],
      8: [[3, 0]], 9: [[0, 2]], 10: [[3, 2], [0, 1]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]],
    };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const code = (v(i, j) > z ? 8 : 0) | (v(i + 1, j) > z ? 4 : 0) | (v(i + 1, j + 1) > z ? 2 : 0) | (v(i, j + 1) > z ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const E: [number, number, number][] = [[i, j, 0], [i + 1, j, 1], [i, j + 1, 0], [i, j, 1]]; // top right bottom left
      for (const [a, b] of PAIRS[code]) {
        const ea = eid(...E[a]), eb = eid(...E[b]);
        segs.push([ea, eb]);
        if (!pos.has(ea)) pos.set(ea, ip(...E[a]));
        if (!pos.has(eb)) pos.set(eb, ip(...E[b]));
      }
    }
    const adj = new Map<number, number[]>();
    segs.forEach(([a, b]) => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); });
    const used = new Set<string>();
    const key = (a: number, b: number) => (a < b ? a + "_" + b : b + "_" + a);
    for (const [a, b] of segs) {
      if (used.has(key(a, b))) continue;
      used.add(key(a, b));
      const chain = [a, b];
      let cur = b, prev = a;
      for (;;) { const nb = (adj.get(cur) ?? []).find((x) => x !== prev && !used.has(key(cur, x))); if (nb == null) break; used.add(key(cur, nb)); chain.push(nb); prev = cur; cur = nb; }
      cur = a; prev = b;
      for (;;) { const nb = (adj.get(cur) ?? []).find((x) => x !== prev && !used.has(key(cur, x))); if (nb == null) break; used.add(key(cur, nb)); chain.unshift(nb); prev = cur; cur = nb; }
      if (chain.length < 4) continue;
      const closed = chain[0] === chain[chain.length - 1];
      const pts = chain.map((e) => pos.get(e)!);
      if (closed) pts.pop();
      out.push({ pts, closed });
    }
    return out;
  };
  const fog = g.fog;
  const inFog = (x: number, y: number) => !!fog && x > fog.x - 6 && y < fog.y + fog.h + 10;
  let minor = "", major = "";
  let zi = 0;
  for (let z = 0.04; z < 1.4; z += 0.04, zi++) {
    for (const c of march(F, z)) {
      const pts = c.pts.filter((p) => !inFog(p[0], p[1]));
      if (pts.length < 4) continue;
      const d = smoothPath(pts, c.closed && pts.length === c.pts.length, true);
      if (zi % 5 === 4) major += d; else minor += d;
    }
  }
  // hachures: strokes down the slope between contours, heavier where it is steeper
  const pk = (x: number, y: number) => { let h = 0; for (const p of peaks) { const dx = (x - p[0]) / (150 * S), dy = (y - p[1]) / (110 * S); h += p[2] * Math.exp(-(dx * dx + dy * dy)); } return h + 0.045 * vnoise(x / (55 * S), y / (55 * S)); };
  const pgrad = (x: number, y: number): Pt => { const e = 1.5; return [(pk(x + e, y) - pk(x - e, y)) / (2 * e), (pk(x, y + e) - pk(x, y - e)) / (2 * e)]; };
  const PK = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) PK[j * nx + i] = pk(i * cell, j * cell);
  const dz = 0.045, sp = mobile ? 2.6 : 3.6;
  const hb: string[] = ["", "", ""];
  const limit = (g.border ?? g.top + 60) - 14;
  for (let z = 0.2; z < 1.2; z += dz) {
    march(PK, z).forEach((c) => {
      const pts = resample(c.closed ? c.pts.concat([c.pts[0]]) : c.pts, sp);
      pts.forEach(([x, y], kk) => {
        if (y > limit || inFog(x, y)) return;
        const [gx, gy] = pgrad(x, y);
        const mm = Math.hypot(gx, gy);
        if (mm < 1e-5) return;
        if (nearest2(x, y, 13 * S + 5) < Math.pow(13 * S + 5, 2)) return;
        if (Object.values(g.springs).some((s2) => Math.abs(s2.x - x) < 9 && Math.abs(s2.y - y) < 9)) return;
        const L = Math.min((dz / mm) * 0.82, 14 * S + 2);
        if (L < 1.2) return;
        const ux = -gx / mm, uy = -gy / mm;
        const j = (hash(kk, (z * 100) | 0) - 0.5) * 0.6;
        const wgt = clamp(mm * (mobile ? 300 : 190), 0.25, 1.1);
        const bi = wgt < 0.45 ? 0 : wgt < 0.7 ? 1 : 2;
        const hx = Math.round(x + j), hy = Math.round(y + j);
        hb[bi] += `M${hx},${hy}l${Math.round(x + ux * L - hx)},${Math.round(y + uy * L - hy)}`;
      });
    });
  }
  // the unsurveyed ground: a light stipple
  let stipple = "";
  if (fog) {
    const rr = rng(97);
    const n = Math.round((fog.w * fog.h) / (mobile ? 70 : 90));
    for (let i = 0; i < n; i++) {
      const x = fog.x + rr() * fog.w, y = fog.y + rr() * fog.h;
      stipple += `M${Math.round(x)},${Math.round(y)}h.8`;
    }
  }
  return { minor, major, hach: hb, stipple };
}
