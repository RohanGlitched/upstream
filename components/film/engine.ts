// The film's scroll engine: one rAF per scroll change, transforms and viewBox only. Nothing in a frame reads
// layout: the film's position and every box are measured in layout() (on resize, font load and page growth),
// and a frame only writes, skipping any write whose value has not changed.
import { geoDistance, geoGraticule, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from "d3-geo";
import type { GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { FilmData } from "./model";
import { dms } from "./model";
import type { MicroGeo } from "./micro";

type V2 = [number, number];
const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeO = (x: number) => 1 - Math.pow(1 - x, 3);
const easeI = (x: number) => x * x * x;
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const llerp = (a: number, b: number, f: number) => Math.exp(lerp(Math.log(a), Math.log(b), f));
const fmtN = (n: number) => n.toLocaleString("en-US");
const DAY = 864e5;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NS = "http://www.w3.org/2000/svg";

// Style writes go through css(): a frame writes only what changed, so an unchanged sheet is never re-styled.
const lastCss = new WeakMap<Element, Record<string, string>>();
/** The same for SVG attributes: an unchanged attribute is not set again (setting one invalidates its node). */
function attr(el: Element, name: string, v: string) {
  let m = lastCss.get(el);
  if (!m) lastCss.set(el, (m = {}));
  if (m["@" + name] === v) return;
  m["@" + name] = v;
  el.setAttribute(name, v);
}
function css(el: HTMLElement | SVGElement, prop: "opacity" | "visibility" | "transform", v: string) {
  let m = lastCss.get(el);
  if (!m) lastCss.set(el, (m = {}));
  if (m[prop] === v) return;
  m[prop] = v;
  el.style[prop] = v;
}

interface Cam { z: number; w: V2; s: V2 }
interface Opts { TMAX: number; STOPS: number[]; BOUNDS: number[]; offsetTop: number }

export function runFilm(root: HTMLElement, D: FilmData, MG: MicroGeo, o: Opts): () => void {
  const { TMAX, STOPS, BOUNDS } = o;
  const q = <T extends Element = HTMLElement>(k: string) => root.querySelector(`[data-f="${k}"]`) as T | null;
  const stage = q("stage")!, micro = q<SVGSVGElement>("micro")!, microWrap = q("microwrap")!, gsvg = q<SVGSVGElement>("globe")!;
  const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
  const stageOf = (t: number) => { let i = 0; while (i < BOUNDS.length && t >= BOUNDS[i]) i++; return i; };
  let W = 0, H = 0, MOB = false, FR = 1, HDR = 20;
  let C0: Cam, C1: Cam, C2: Cam, Cd: Cam;
  let lanesY = 0, GAP = 0, yTop = 0, yBot = 0, eDiveEnd = -3, eFinal = 3.3, eDay = 7.4;
  const cs = getComputedStyle(root);
  const tok = (n: string, fb: string) => (cs.getPropertyValue(n).trim() || fb);

  /* ---------- micro scene ---------- */
  const bars = [...micro.querySelectorAll<SVGRectElement>(".fl-bars rect")].map((el) => ({ el, x: +el.dataset.x!, w: +el.dataset.w!, g: el.dataset.g!, ext: +el.dataset.ext! }));
  const GROUPS = ["ns", "lab", "mid", "prod", "pkg", "chk"];
  const OFF: Record<string, number> = { ns: -2.5, lab: -1.5, mid: -0.5, prod: 0.5, pkg: 1.5, chk: 2.5 };
  const gx: Record<string, { x0: number; x1: number }> = {};
  GROUPS.forEach((g) => {
    const bs = bars.filter((b) => b.g === g);
    if (bs.length) gx[g] = { x0: Math.min(...bs.map((b) => b.x)), x1: Math.max(...bs.map((b) => b.x + b.w)) };
  });
  const labBars = bars.filter((b) => b.g === "lab");
  const diveBar = labBars.reduce((a, b) => (b.w > a.w ? b : a), labBars[0]);
  const labHi = micro.querySelector<SVGRectElement>("#flLabHi")!, scene = micro.querySelector<SVGGElement>("#flScene")!, vAcc = micro.querySelector<SVGGElement>("#flVfocus");
  const digitsG = micro.querySelector<SVGGElement>(".fl-bardigits");
  // The two frame brackets are drawn in screen space on a small SVG of their own: inside the zooming scene,
  // keeping them 2px wide meant a new stroke width, and a relayout of the whole drawer, every frame.
  micro.querySelectorAll("#flFr1, #flFr2").forEach((n) => ((n as SVGElement).style.display = "none"));
  const frSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  frSvg.setAttribute("class", "fm-frames");
  frSvg.setAttribute("aria-hidden", "true");
  microWrap.after(frSvg);
  const fr1 = document.createElementNS("http://www.w3.org/2000/svg", "path"), fr2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  fr1.setAttribute("class", "fl-fr"); fr2.setAttribute("class", "fl-fr");
  frSvg.append(fr1, fr2);
  const lanesEl = q("lanes")!;
  const LANES = [...lanesEl.querySelectorAll<HTMLElement>("[data-lane]")].map((el) => ({ el, g: el.dataset.lane! }));
  const labcard = q("labcard")!;

  const fit = (r: { x: number; y: number; w: number; h: number }, reg: { x: number; y: number; w: number; h: number }): Cam => {
    const z = Math.min(reg.w / r.w, reg.h / r.h);
    return { z, w: [r.x + r.w / 2, r.y + r.h / 2], s: [reg.x + reg.w / 2, reg.y + reg.h / 2] };
  };
  const toS = (c: Cam, p: V2): V2 => [(p[0] - c.w[0]) * c.z + c.s[0], (p[1] - c.w[1]) * c.z + c.s[1]];
  const toW = (c: Cam, p: V2): V2 => [(p[0] - c.s[0]) / c.z + c.w[0], (p[1] - c.s[1]) / c.z + c.w[1]];
  const zoomCam = (A: Cam, B: Cam, f: number): Cam => { const pA = toS(A, B.w); return { z: llerp(A.z, B.z, f), w: B.w, s: [lerp(pA[0], B.s[0], f), lerp(pA[1], B.s[1], f)] }; };
  // The drawer scene's viewBox is fixed at the first camera (set in layout); every other camera is a CSS
  // transform of the plain box around the SVG. A new viewBox, or a transform on the <svg> itself, re-laid out
  // all ~800 SVG nodes (72 of them text) each frame; a transform on its wrapper only repaints them.
  let B: Cam = { z: 1, w: [0, 0], s: [0, 0] };
  const onScreen = (c: Cam, r: { x: number; y: number; w: number; h: number }) => {
    const a = toS(c, [r.x, r.y]), b = toS(c, [r.x + r.w, r.y + r.h]);
    return { x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1] };
  };
  const setVB = (c: Cam) => {
    const k = c.z / B.z;
    const tx = c.s[0] - k * B.s[0] + (B.w[0] - c.w[0]) * c.z;
    const ty = c.s[1] - k * B.s[1] + (B.w[1] - c.w[1]) * c.z;
    css(microWrap, "transform", `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${k.toPrecision(6)})`);
    if (tNow < 1.9) {
      fr1.setAttribute("d", bracket(onScreen(c, R_LABEL)));
      fr2.setAttribute("d", bracket(onScreen(c, R_BARS)));
    }
  };
  const bracket = (r: { x: number; y: number; w: number; h: number }) => {
    const l = Math.min(r.w, r.h) * 0.2, { x, y, w, h } = r;
    return `M${x} ${y + l}V${y}H${x + l}M${x + w - l} ${y}H${x + w}V${y + l}M${x + w} ${y + h - l}V${y + h}H${x + w - l}M${x + l} ${y + h}H${x}V${y + h - l}`;
  };
  const R_DRAWER = { x: -10, y: -8, w: MG.drawer.w + 20, h: MG.drawer.h + 16 };
  const R_LABEL = { x: MG.label.x - 4, y: MG.label.y - 3, w: MG.label.w + 8, h: MG.label.h + 6 };
  const R_BARS = { x: MG.bars.x - 2.2, y: MG.bars.y - 1.6, w: MG.bars.w + 4.4, h: MG.bars.h + 4.2 };

  /* ---------- globe ---------- */
  const US = D.corvale, PIN = D.plant.ll;
  const mk = (tag: string, attrs: Record<string, string | number>, parent: Element = gsvg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, String(attrs[k])); parent.appendChild(e); return e; };
  const gSph = mk("path", {}), gGrat = mk("path", { fill: "none" }), gLand = mk("path", {}), gInd = mk("path", { fill: "none" });
  const gRings = mk("g", {});
  const gArcH = mk("path", { class: "arch" }), gArc = mk("path", { class: "arc" });
  const rings = D.rings.map((c) => ({ c, el: mk("circle", { r: 2.6 + Math.sqrt(c.n) * 2.3, fill: "none" }, gRings) }));
  const proj = geoOrthographic().clipAngle(90).precision(0.45);
  const gpath = geoPath(proj);
  const gi = geoInterpolate(US, PIN);
  const mid0 = gi(0.5);
  const MID: V2 = [mid0[0], mid0[1] - 8];
  const FINE = geoGraticule().extent([[PIN[0] - 0.22, PIN[1] - 0.19], [PIN[0] + 0.23, PIN[1] + 0.19]]).step([0.005, 0.005])();
  const GRAT = geoGraticule10();
  const DIST = Math.round((geoDistance(US, PIN) * 6371) / 10) * 10;
  const SPH = { type: "Sphere" } as GeoPermissibleObjects;
  let LAND110: GeoPermissibleObjects | null = null, LAND50: GeoPermissibleObjects | null = null, CTRY: GeoPermissibleObjects | null = null;
  let want50 = false;
  const loadGeo = () => {
    import("world-atlas/land-110m.json").then((m) => {
      const t = (m.default ?? m) as unknown as Topology;
      LAND110 = feature(t, t.objects.land) as GeoPermissibleObjects;
      dirty = true; req();
    });
    import("world-atlas/countries-110m.json").then((m) => {
      const t = (m.default ?? m) as unknown as Topology;
      const fc = feature(t, t.objects.countries) as unknown as { features: { properties: { name: string } }[] };
      CTRY = (fc.features.find((f) => f.properties.name === D.plant.countryName) ?? null) as unknown as GeoPermissibleObjects | null;
      dirty = true; req();
    });
  };
  const load50 = () => {
    if (want50) return;
    want50 = true;
    import("world-atlas/land-50m.json").then((m) => {
      const t = (m.default ?? m) as unknown as Topology;
      // keep only the land near the plant: the fine coast is drawn only once the view is a few hundred km wide
      const fc = feature(t, t.objects.land) as unknown as { type: string; features: { geometry: { type: string; coordinates: number[][][][] } }[] };
      const polys: number[][][][] = [];
      for (const f of fc.features) {
        const g = f.geometry;
        const list = g.type === "Polygon" ? [g.coordinates as unknown as number[][][]] : g.coordinates;
        for (const poly of list) {
          const ring = poly[0];
          if (ring.some((pt, i) => i % 8 === 0 && geoDistance(pt as V2, PIN) < 0.5)) polys.push(poly);
        }
      }
      LAND50 = { type: "MultiPolygon", coordinates: polys } as unknown as GeoPermissibleObjects;
      dirty = true; req();
    });
  };
  const ML = D.mapLabels.map((m) => ({ ...m, el: null as HTMLDivElement | null, w0: 0 }));
  const mlWrap = q("maplabels")!;
  ML.forEach((m) => {
    const d = document.createElement("div");
    d.className = "fm-ml " + m.c;
    d.innerHTML = m.t + (m.s ? "<span>" + m.s + "</span>" : "");
    mlWrap.appendChild(d);
    m.el = d;
  });
  const distLabel = ML[ML.length - 1];
  distLabel.el!.textContent = fmtN(DIST) + " km upstream";
  const siteMark = q("sitemark")!, nextFrame = q("nextframe")!;
  const hex = (c: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); const h = m ? m[1] : "888888"; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const mix = (a: string, b: string, f: number) => { const A = hex(a), B = hex(b); return `rgb(${Math.round(lerp(A[0], B[0], f))},${Math.round(lerp(A[1], B[1], f))},${Math.round(lerp(A[2], B[2], f))})`; };
  let PAL = { paper: "#fbfcfa", night: "#121715", land: "#d3dcd6", landN: "#26302c", edge: "#87918c", edgeN: "#5b6662", ink: "#16191a", bone: "#e8e4d8", red: "#c0242b", redN: "#f2583e", mute: "#5b6662", fog: "#8e9991", carbon: "#2d3b96" };
  const readPal = () => {
    PAL = {
      paper: tok("--paper", PAL.paper), night: tok("--night", PAL.night), land: tok("--board", PAL.land), landN: tok("--night-rule", PAL.landN),
      edge: tok("--graphite-2", PAL.edge), edgeN: tok("--graphite", PAL.edgeN), ink: tok("--ink", PAL.ink), bone: tok("--bone", PAL.bone),
      red: tok("--fda-red", PAL.red), redN: tok("--night-signal", PAL.redN), mute: tok("--graphite", PAL.mute), fog: tok("--fog", PAL.fog),
      carbon: tok("--carbon", PAL.carbon),
    };
  };
  readPal();

  let GX = 0, GY = 0, GR = 1, PX = 0, PY = 0, KMAX = 1, SX = 0, SY = 0, SR = 1;
  interface GS { k: number; rot: V2; tx: number; ty: number; arcP: number; night: number; op: number; e: number; rings: number; nf?: number }
  function renderGlobe(st: GS) {
    // coarser resampling while the whole globe is in view (the fine coast only matters close in)
    proj.precision(st.k > GR * 3 ? 0.45 : 1.4);
    proj.rotate([-st.rot[0], -st.rot[1]]).scale(st.k).translate([st.tx, st.ty]).clipExtent([[-30, -30], [W + 30, H + 30]]);
    const n = st.night, k = st.k;
    const fieldKm = (W / k) * 6371;
    if (fieldKm < 1500) load50();
    attr(gSph, "d", gpath(SPH) || "");
    attr(gSph, "fill", mix(PAL.paper, PAL.night, n));
    attr(gSph, "stroke", mix(PAL.edge, PAL.landN, n));
    attr(gSph, "stroke-width", k > GR * 3 ? "0" : "1");
    attr(gGrat, "d", (k < GR * 3.5 ? gpath(GRAT) : fieldKm < 60 ? gpath(FINE) : "") || "");
    attr(gGrat, "stroke", n > 0.5 ? "rgba(232,228,216,.08)" : `rgba(22,25,26,${fieldKm < 60 ? (clamp((60 - fieldKm) / 40) * 0.17).toFixed(3) : 0.07})`);
    const land = fieldKm < 1500 && LAND50 ? LAND50 : LAND110;
    attr(gLand, "d", (land && gpath(land)) || "");
    attr(gLand, "fill", mix(PAL.land, PAL.landN, n));
    attr(gLand, "stroke", mix(PAL.edge, PAL.edgeN, n));
    attr(gLand, "stroke-width", "0.7");
    attr(gInd, "d", (fieldKm < 9000 && fieldKm > 200 && CTRY ? gpath(CTRY) : "") || "");
    attr(gInd, "stroke", mix(PAL.mute, PAL.fog, n));
    attr(gInd, "stroke-width", "1");
    attr(gInd, "stroke-dasharray", "3 3");
    const center = st.rot;
    rings.forEach((r) => {
      const p: V2 = [r.c.lon, r.c.lat];
      const vis = geoDistance(p, center) < 1.52 && st.rings > 0;
      if (!vis) { attr(r.el, "opacity", "0"); return; }
      const qq = proj(p)!;
      attr(r.el, "cx", qq[0].toFixed(1)); attr(r.el, "cy", qq[1].toFixed(1));
      attr(r.el, "opacity", st.rings.toFixed(3));
      attr(r.el, "stroke", r.c.signal ? (n > 0.5 ? PAL.redN : PAL.red) : n > 0.5 ? PAL.fog : PAL.mute);
      attr(r.el, "stroke-width", "1.2");
    });
    const N = 120, lift = clamp(GR / k) * 0.16;
    let d = "", pen = false;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      if (f > st.arcP) break;
      const g = gi(f) as V2;
      if (geoDistance(g, center) >= 1.5707) { pen = false; continue; }
      const qq = proj(g)!, h = 1 + lift * Math.sin(Math.PI * f);
      const x = st.tx + (qq[0] - st.tx) * h, y = st.ty + (qq[1] - st.ty) * h;
      d += (pen ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      pen = true;
    }
    attr(gArc, "d", d); attr(gArcH, "d", d);
    attr(gArc, "stroke", n > 0.5 ? "#8f9be6" : PAL.carbon);
    attr(gArcH, "stroke", n > 0.5 ? "#000" : PAL.paper);
    ML.forEach((m) => {
      let op = 0, x = -999, y = -999;
      const el = m.el!;
      if (m.c === "dist") {
        const mid = gi(0.5) as V2;
        if (st.arcP > 0.62 && geoDistance(mid, center) < 1.45) {
          const q2 = proj(mid)!, h2 = 1 + lift;
          x = st.tx + (q2[0] - st.tx) * h2 + 12; y = st.ty + (q2[1] - st.ty) * h2 - 30;
          op = seg(st.arcP, 0.62, 0.8) * clamp((st.e - 6) / 0.4) * st.op;
        }
      } else if (m.ll && geoDistance(m.ll, center) < 1.45) {
        const q3 = proj(m.ll)!;
        x = q3[0]; y = q3[1];
        op = clamp((st.e - m.w[0]) / 0.25) * clamp((m.w[1] - st.e) / 0.25) * st.op;
        // on a phone the registration card covers the map: its labels leave as the card comes in
        if (MOB) op *= 1 - seg(tNow, 3.84, 3.9);
        if (m.c.indexOf("region") === 0) { x -= (m.w0 || (m.w0 = el.offsetWidth)) / 2; y -= 9; }
        else if (m.c === "city") { x += 10; y -= 10; }
        else {
          const lw = m.w0 || (m.w0 = el.offsetWidth);
          if (x + 17 + lw > W - 8) { x = Math.max(8, x - 17 - lw); el.style.textAlign = "right"; el.classList.add("left"); }
          else { x += 17; el.style.textAlign = "left"; el.classList.remove("left"); }
          y -= 8;
        }
      }
      css(el, "opacity", String(op));
      if (op > 0) css(el, "transform", `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`);
    });
    const so = clamp((4.2 - st.e) / 0.4) * st.op;
    css(siteMark, "opacity", String(so));
    if (so > 0) { const qp = proj(PIN)!; siteMark.style.setProperty("--sb", ((100 * k) / 6.371e6).toFixed(1) + "px"); css(siteMark, "transform", `translate(${qp[0].toFixed(1)}px,${qp[1].toFixed(1)}px)`); }
    const no = (st.nf || 0) * st.op;
    css(nextFrame, "opacity", String(no));
    if (no > 0) { const qn = proj(PIN)!; css(nextFrame, "transform", `translate(${qn[0].toFixed(1)}px,${qn[1].toFixed(1)}px)`); }
    mlWrap.classList.toggle("night", n > 0.5);
    css(gsvg, "opacity", String(st.op));
  }

  /* ---------- documents ---------- */
  const reg = q("reg")!, insp = q("insp"), stamp = q("stamp");
  let regBox = { x: 0, y: 0, w: 1, h: 1 }, rowC = { x: 0, y: 0 }, inspBox = { x: 0, y: 0, w: 1, h: 1 };

  /* ---------- ruler ---------- */
  const rsvg = q<SVGSVGElement>("ruler")!;
  let RX0 = 0, RX1 = 1, RY = 0;
  const L = D.lead;
  const EVS = (L?.events ?? []).map((e) => ({ ...e, ms: dms(e.d) }));
  const RA = L ? [dms(L.zoomA[0]), dms(L.zoomA[1])] : [0, 1], RB = L ? [dms(L.zoomB[0]), dms(L.zoomB[1])] : [0, 1];
  let rulerKey = "";
  function renderRuler(t: number, op: number) {
    if (!L) return;
    const f = ease(seg(t, 6.15, 6.55));
    css(rsvg, "opacity", String(op));
    // the ruler only changes while it zooms (6.15 to 6.55); elsewhere a frame is just its opacity
    const key = `${f.toFixed(4)}|${RX0}|${RX1}|${RY}|${MOB}`;
    if (key === rulerKey) return;
    rulerKey = key;
    const sA = RA[1] - RA[0], sB = RB[1] - RB[0];
    const span = llerp(sA, sB, f), g = (span - sA) / (sB - sA);
    const c = lerp((RA[0] + RA[1]) / 2, (RB[0] + RB[1]) / 2, g);
    const d0 = c - span / 2, d1 = c + span / 2;
    const X = (d: number) => RX0 + ((d - d0) / (d1 - d0)) * (RX1 - RX0);
    const ppd = (RX1 - RX0) / (span / DAY);
    const y = RY;
    let s = "";
    const inR = (x: number) => x >= RX0 - 0.5 && x <= RX1 + 0.5;
    const xL = X(dms(L.letter)), xP = X(dms(L.posted)), xT = X(dms(D.asOf));
    s += `<rect x="${Math.max(RX0, xP)}" y="${y + 10}" width="${Math.max(0, Math.min(RX1, xT) - Math.max(RX0, xP))}" height="9" class="listed"/>`;
    if (xP < RX1) s += `<text x="${xP + 140 > RX1 ? RX1 : Math.max(RX0, xP)}" y="${y + 36}" class="lbl"${xP + 140 > RX1 ? ' text-anchor="end"' : ""}>On FDA's shortage list</text>`;
    s += `<rect x="${Math.max(RX0, xL)}" y="${y - 19}" width="${Math.max(0, Math.min(RX1, xP) - Math.max(RX0, xL))}" height="9" class="lead"/>`;
    if (xP - xL > 130) s += `<text x="${(xL + xP) / 2}" y="${y - 26}" text-anchor="middle" class="leadt">${L.days} days</text>`;
    s += `<line x1="${RX0}" y1="${y}" x2="${RX1}" y2="${y}" class="ax"/>`;
    const dayA = clamp((ppd - 2.5) / 5);
    if (dayA > 0) {
      for (let dd = Math.ceil(d0 / DAY) * DAY; dd <= d1; dd += DAY) {
        const x = X(dd), dom = new Date(dd).getUTCDate();
        s += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 5}" class="tk" stroke-opacity="${dayA * 0.55}"/>`;
        if (ppd > 13 && (dom === 1 || dom % 5 === 0) && dom !== 30) s += `<text x="${x}" y="${y + 52}" text-anchor="middle" class="lbl" opacity="${clamp((ppd - 13) / 4)}">${dom}</text>`;
      }
    }
    const ppm = ppd * 30.4, dt0 = new Date(d0), yy = dt0.getUTCFullYear(), mm = dt0.getUTCMonth();
    for (let i = 0; i < 90; i++) {
      const ms = Date.UTC(yy, mm + i, 1);
      if (ms > d1) break;
      const xm = X(ms);
      if (!inR(xm)) continue;
      const m = new Date(ms).getUTCMonth(), yr = new Date(ms).getUTCFullYear();
      const isY = m === 0;
      s += `<line x1="${xm}" y1="${y}" x2="${xm}" y2="${y + (isY ? 26 : 12)}" class="tk" stroke-opacity="${isY ? 0.9 : clamp((ppm - 5) / 10) * 0.7}"/>`;
      if (isY) s += `<text x="${xm + 5}" y="${y + 70}" class="yr">${yr}</text>`;
      else if (ppm > 70) s += `<text x="${xm + 4}" y="${y + 70}" class="lbl" opacity="${clamp((ppm - 70) / 40)}">${MON[m]}${ppm > 400 ? " " + yr : ""}</text>`;
    }
    EVS.forEach((e) => {
      const x = X(e.ms);
      if (!inR(x)) return;
      const cls = e.k === "oai" ? "red" : e.k === "post" ? "mag" : "ink";
      const up = e.row >= 0, ly = up ? y - 52 - e.row * 44 : y + 104;
      const y0 = up ? y - 4 : y + 4;
      s += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${up ? ly + 6 : ly - 16}" class="st ${cls}"/>`;
      s += `<circle cx="${x}" cy="${y}" r="${e.k === "post" ? 6 : 4.5}" class="dot ${cls}${e.k === "today" ? " open" : ""}"/>`;
      const flip = e.end || x + 7 + (MOB ? 150 : 175) > RX1 + 30;
      const anchor = flip ? "end" : "start", tx = flip ? x - 7 : x + 7;
      s += `<text x="${tx}" y="${ly - 12}" text-anchor="${anchor}" class="evd ${cls}">${e.d}</text>`;
      if (up || !MOB || e.end) s += `<text x="${tx}" y="${ly + 4}" text-anchor="${anchor}" class="evt">${e.t}</text>`;
    });
    rsvg.innerHTML = s;
  }

  /* ---------- answer ---------- */
  const answer = q("answer")!, hosp = q("hosp"), pipsEl = q("pips");
  const rowsEl = hosp ? [...hosp.querySelectorAll<HTMLElement>("[data-row]")] : [];
  // each row's bar fill (scaled, never resized) and its figure
  const rowBits = rowsEl.map((el) => ({ el, bar: el.querySelector("i") as HTMLElement, fig: el.querySelector(".fm-h-days b") as HTMLElement, v: "" }));
  const AR = D.answer?.rows ?? [];
  const toI = AR.findIndex((r) => r.b > r.a + 0.01), fromI = AR.findIndex((r) => r.b < r.a - 0.01);
  const pips: HTMLElement[] = [];
  if (pipsEl) for (let i = 0; i < 26; i++) { const p = document.createElement("i"); p.className = "fm-pip"; pipsEl.appendChild(p); pips.push(p); }
  let trackTo: { x: number; y: number; w: number } | null = null, trackFrom: { x: number; y: number; w: number } | null = null;

  /* ---------- captions ---------- */
  const cap = q("cap")!, capIn = q("capIn")!, prevB = q<HTMLButtonElement>("prevB")!, nextB = q<HTMLButtonElement>("nextB")!;
  let curStage = -1;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  function setCaption(i: number) {
    if (i === curStage) return;
    const first = curStage < 0;
    curStage = i;
    const c = i < 7 ? D.caps[i] : null;
    css(cap, "opacity", c ? "1" : "0");
    css(cap, "visibility", c ? "visible" : "hidden");
    prevB.disabled = i === 0;
    nextB.textContent = i >= 6 ? "The answer" : "Next stop";
    if (!c) return;
    const t = c.t.replace("__DIST__", fmtN(DIST));
    const html = `<p class="fm-cap-n">${i + 1} of 8</p><h3 class="fm-cap-t">${esc(t)}</h3><p class="fm-cap-b">${esc(c.b)}</p><p class="fm-cap-ev">${c.e.map(([k, v]) => `<span>${esc(k)}<b>${esc(v)}</b></span>`).join("")}</p>`;
    capIn.innerHTML = html;
    // the new card lands with the stop it describes: swap at once, then a short fade in (no wait on a timer)
    if (first || RM.matches) return;
    capIn.classList.remove("in");
    void capIn.offsetWidth;
    capIn.classList.add("in");
  }
  let rootTop = 0, rootH = 1;
  const filmTop = () => rootTop - o.offsetTop;
  function goStop(i: number) {
    i = clamp(i, 0, STOPS.length - 1);
    const y = filmTop() + (STOPS[i] / TMAX) * (rootH - H);
    window.scrollTo({ top: Math.round(y) + 1, behavior: RM.matches ? "auto" : "smooth" });
  }
  const onPrev = () => goStop(curStage - 1), onNext = () => goStop(curStage + 1);
  prevB.addEventListener("click", onPrev);
  nextB.addEventListener("click", onNext);

  /* ---------- gauge ---------- */
  const ladder = q("ladder")!, needle = q("needle")!, needleName = q("needleName")!, roE = q("roE")!, roF = q("roF")!, clk = q("clk")!, clkNote = q("clkNote")!;
  const EMIN = -3.6, EMAX = 7.6;
  const TICKS = [...ladder.querySelectorAll<HTMLElement>("[data-ex]")].map((el) => ({ e: +el.dataset.ex!, el }));
  let ladderR: DOMRect | null = null;
  function placeTicks() {
    const r = ladder.getBoundingClientRect();
    TICKS.forEach((k) => {
      const f = (k.e - EMIN) / (EMAX - EMIN);
      if (MOB) { k.el.style.left = f * r.width + "px"; k.el.style.top = ""; }
      else { k.el.style.top = (1 - f) * r.height + "px"; k.el.style.left = "0px"; }
    });
  }
  function fieldText(e: number) {
    const m = Math.pow(10, e);
    if (m < 0.001) return (m * 1e6).toFixed(0) + " µm across";
    if (m < 0.01) return (m * 1000).toFixed(1) + " mm across";
    if (m < 1) return (m * 100).toFixed(m < 0.1 ? 1 : 0) + " cm across";
    if (m < 1000) return (m < 10 ? m.toFixed(1) : Math.round(m)) + " m across";
    const km = m / 1000;
    return (km < 10 ? km.toFixed(1) : fmtN(Math.round(km / (km > 1000 ? 100 : 1)) * (km > 1000 ? 100 : 1))) + " km across";
  }
  const regions = D.mapLabels.filter((m) => m.c === "region").map((m) => m.t);
  const city = D.mapLabels.filter((m) => m.c === "city").slice(-1)[0]?.t ?? "the plant";
  function nameOf(e: number, t: number) {
    if (t < 2.82) return e > -0.55 ? "a drawer" : e > -1.25 ? "a vial label" : e > -2.4 ? "a barcode" : "one bar";
    if (t < 2.9) return "";
    if (t >= 4.02 && t < 6.85) return "the plant’s FDA file";
    if (t >= 6.85) return "the whole trip";
    return e > 6.6 ? "Earth" : e > 5.6 ? regions[0] ?? D.plant.countryName : e > 4.6 ? regions[1] ?? D.plant.countryName : e > 3.75 ? city : "the plant";
  }
  let lastE: number | null = null, lastName: string | null = null, lastClk: string | null = null, lastField = "";
  const gauge = ladder.closest(".fm-gauge") as HTMLElement;
  function setGauge(e: number, t: number, dateMs: number) {
    const f = clamp((e - EMIN) / (EMAX - EMIN));
    const r = ladderR || (ladderR = ladder.getBoundingClientRect());
    css(needle, "transform", MOB ? `translateX(${f * r.width - 1}px)` : `translateY(${(1 - f) * r.height - 1}px)`);
    const ei = Math.round(e);
    if (ei !== lastE) { roE.textContent = ei < 0 ? "−" + -ei : String(ei); lastE = ei; }
    // FDA's documents have no field of view: the readout says so instead of a meaningless distance
    const onPaper = t >= 4.02 && t < 6.85;
    const ft = onPaper ? "a document, not to scale" : fieldText(e);
    if (ft !== lastField) { roF.textContent = ft; lastField = ft; gauge.classList.toggle("on-paper", onPaper); }
    const nm = nameOf(e, t);
    if (nm !== lastName) { needleName.textContent = nm; lastName = nm; }
    const ds = iso(dateMs);
    if (ds !== lastClk) { clk.textContent = ds; lastClk = ds; clkNote.textContent = D.dateNotes[ds] ?? ""; }
  }

  /* ---------- layout ---------- */
  const intro = q("intro")!, callout = q("callout")!, voidEl = q("void")!;
  const rHead = q("rHead"), rTail = q("rTail");
  function layout() {
    W = stage.clientWidth; H = stage.clientHeight; MOB = W < 760;
    HDR = MOB ? 44 : 12;
    FR = Math.max(W, H) * 0.8;
    micro.classList.add("live");
    micro.setAttribute("preserveAspectRatio", "none");
    let r0, r1, r2;
    if (!MOB) {
      r0 = { x: W * 0.47, y: HDR + 130, w: W * 0.5, h: H - HDR - 170 };
      r1 = { x: W * 0.3, y: H * 0.14, w: W * 0.58, h: H * 0.58 };
      r2 = { x: W * 0.19, y: H * 0.2, w: W * 0.42, h: H * 0.32 };
      lanesY = H * 0.6;
    } else {
      r0 = { x: 10, y: H * 0.43, w: W - 20, h: H * 0.29 };
      r1 = { x: 12, y: HDR + 70, w: W - 24, h: H * 0.46 };
      r2 = { x: 10, y: HDR + 74, w: W - 20, h: H * 0.22 };
      lanesY = H * 0.4;
    }
    C0 = fit(R_DRAWER, r0); C1 = fit(R_LABEL, r1); C2 = fit(R_BARS, r2);
    B = C0;
    micro.setAttribute("viewBox", `${C0.w[0] - C0.s[0] / C0.z} ${C0.w[1] - C0.s[1] / C0.z} ${W / C0.z} ${H / C0.z}`);
    GAP = (W / C2.z) * (MOB ? 0.034 : 0.03);
    yTop = toW(C2, [0, MOB ? HDR + 10 : HDR - 4])[1];
    yBot = toW(C2, [0, lanesY])[1];
    const bx = diveBar.x + diveBar.w / 2 + OFF.lab * GAP;
    Cd = { z: (W * 2.6) / diveBar.w, w: [bx, (yTop + yBot) / 2], s: [W / 2, H / 2] };
    eDiveEnd = Math.log10(FR / Cd.z / 1000);
    LANES.forEach((l) => (l.el.style.top = lanesY + 14 + "px"));
    if (!MOB) { labcard.style.left = Math.max(12, Math.min(W * 0.645, W - Math.min(410, W - 24) - 12)) + "px"; labcard.style.top = H * 0.2 + "px"; labcard.style.right = "auto"; }
    else { labcard.style.left = "12px"; labcard.style.right = "12px"; labcard.style.top = lanesY + 58 + "px"; }
    if (!MOB) { GR = Math.min(W * 0.3, H * 0.36); GX = W * 0.57; GY = H * 0.5; PX = W * 0.275; PY = H * 0.5; SR = Math.min(W * 0.17, H * 0.3); SX = W * 0.25; SY = H * 0.55; }
    else { GR = W * 0.42; GX = W * 0.5; GY = H * 0.46; PX = W * 0.5; PY = HDR + 106; SR = W * 0.2; SX = W * 0.78; SY = HDR + 92; }
    KMAX = FR / (2000 / 6.371e6) / GR;
    eFinal = Math.log10((FR / (GR * KMAX)) * 6.371e6);
    eDay = Math.log10((FR / (MOB ? GR : SR)) * 6.371e6);
    css(reg, "transform", "none");
    if (insp) css(insp, "transform", "none");
    if (!MOB) {
      reg.style.left = W * 0.44 + "px"; reg.style.right = "auto";
      reg.style.top = Math.max(HDR + 24, (H - reg.offsetHeight) / 2) + "px";
      if (insp) { insp.style.left = Math.max(176, W * 0.56 - insp.offsetWidth / 2) + "px"; insp.style.right = "auto"; insp.style.top = Math.max(HDR + 24, (H - insp.offsetHeight) / 2 - 30) + "px"; }
    } else {
      reg.style.left = "10px"; reg.style.right = "10px"; reg.style.top = HDR + 120 + "px";
      if (insp) { insp.style.left = "10px"; insp.style.right = "10px"; insp.style.top = HDR + 12 + "px"; }
    }
    const sr = stage.getBoundingClientRect();
    const rr = reg.getBoundingClientRect();
    const oaiRow = q("regOai");
    const orr = (oaiRow ?? reg).getBoundingClientRect();
    regBox = { x: rr.left - sr.left, y: rr.top - sr.top, w: rr.width, h: rr.height };
    rowC = { x: orr.left - sr.left + orr.width * 0.3, y: orr.top - sr.top + orr.height / 2 };
    reg.style.transformOrigin = `${rowC.x - regBox.x}px ${rowC.y - regBox.y}px`;
    if (insp) { const ir = insp.getBoundingClientRect(); inspBox = { x: ir.left - sr.left, y: ir.top - sr.top, w: ir.width, h: ir.height }; }
    if (!MOB) { RX0 = 200; RX1 = W - 64; RY = H * 0.52; } else { RX0 = 16; RX1 = W - 16; RY = H * 0.58; }
    if (rHead && rTail) {
      if (!MOB) { rHead.style.left = "200px"; rHead.style.top = HDR + 60 + "px"; rHead.style.width = ""; rTail.style.left = "auto"; rTail.style.right = "64px"; rTail.style.top = HDR + 60 + "px"; rTail.style.width = ""; rTail.style.textAlign = "right"; }
      else { rHead.style.left = "16px"; rHead.style.top = HDR + 20 + "px"; rHead.style.width = W / 2 - 22 + "px"; rTail.style.right = "16px"; rTail.style.left = "auto"; rTail.style.top = HDR + 20 + "px"; rTail.style.width = W / 2 - 22 + "px"; rTail.style.textAlign = "right"; }
    }
    css(answer, "transform", "none");
    if (!MOB) { answer.style.left = W * 0.47 + "px"; answer.style.right = "auto"; answer.style.top = Math.max(HDR + 20, (H - answer.offsetHeight) / 2 + 8) + "px"; }
    else { answer.style.left = "14px"; answer.style.right = "14px"; answer.style.top = HDR + 14 + "px"; }
    if (hosp && toI >= 0 && fromI >= 0) {
      const hr = hosp.getBoundingClientRect();
      const tb = rowsEl[toI].querySelector(".fm-h-bar")!.getBoundingClientRect(), fb = rowsEl[fromI].querySelector(".fm-h-bar")!.getBoundingClientRect();
      trackTo = { x: tb.left - hr.left, y: tb.top - hr.top + tb.height / 2, w: tb.width };
      trackFrom = { x: fb.left - hr.left, y: fb.top - hr.top + fb.height / 2, w: fb.width };
    }
    ladderR = null;
    placeTicks();
    lastE = null; lastName = null; lastField = ""; lastBars = ""; rulerKey = "";
    ML.forEach((m) => (m.w0 = 0));
    measureRoot();
  }

  /* ---------- render ---------- */
  let tNow = 0, lastBars = "", labOff = false;
  // where the film sits on the page, measured once per layout; a frame reads only scrollY
  const measureRoot = () => { const r = root.getBoundingClientRect(); rootTop = r.top + window.scrollY; rootH = r.height; };
  const readT = () => clamp((window.scrollY + o.offsetTop - rootTop) / Math.max(1, rootH - H)) * TMAX;
  function render(tRaw: number) {
    const si = stageOf(tRaw);
    const t = RM.matches ? STOPS[si] : tRaw;
    setCaption(si);
    if (t > 2.3) load50();
    const io = 1 - seg(t, 0.03, 0.2);
    css(intro, "opacity", String(io)); css(intro, "visibility", io <= 0 ? "hidden" : "visible"); intro.classList.toggle("off", io <= 0);
    let e = 0, dateMs = dms(D.asOf);
    if (t < 2.86) {
      css(micro, "visibility", "visible");
      let cam: Cam;
      if (t <= 0.2) cam = C0;
      else if (t < 1) cam = zoomCam(C0, C1, ease(seg(t, 0.2, 1)));
      else if (t < 1.25) cam = C1;
      else if (t < 1.95) cam = zoomCam(C1, C2, ease(seg(t, 1.25, 1.95)));
      else if (t < 2.55) cam = C2;
      else cam = zoomCam(C2, Cd, easeI(seg(t, 2.55, 2.84)));
      setVB(cam);
      e = Math.log10(FR / cam.z / 1000);
      if (io > 0) {
        const cp = toS(cam, [MG.pocketFocus.x + 8, MG.drawer.y]);
        const cpy = MOB ? toS(cam, [0, MG.drawer.y])[1] - 62 : cp[1] - 96;
        css(callout, "transform", `translate(${MOB ? 16 : cp[0]}px,${cpy}px)`);
        if (!MOB) callout.style.setProperty("--lead", toS(cam, [0, MG.pocketFocus.y + 30])[1] - cpy - 74 + "px");
      }
      css(callout, "opacity", String(io)); css(callout, "visibility", io <= 0 ? "hidden" : "visible");
      css(fr1, "opacity", String(t < 1 ? 1 - seg(t, 0.45, 0.9) : 0));
      css(fr2, "opacity", String(t < 1.95 ? seg(t, 0.98, 1.12) * (1 - seg(t, 1.5, 1.85)) : 0));
      root.classList.toggle("fm-free", t > 2.05);
      const sf = 1 - seg(t, 1.98, 2.16);
      css(scene, "opacity", String(sf));
      css(scene, "visibility", sf <= 0 ? "hidden" : "visible");
      if (vAcc) { css(vAcc, "opacity", String(sf)); css(vAcc, "visibility", sf <= 0 ? "hidden" : "visible"); }
      if (digitsG) css(digitsG, "opacity", String(1 - seg(t, 1.96, 2.06)));
      const f1 = ease(seg(t, 2.0, 2.2)), f2 = ease(seg(t, 2.15, 2.36)), f3 = ease(seg(t, 2.3, 2.48)), fo = seg(t, 2.55, 2.64);
      const by = MG.bars.y, bh = MG.bars.h;
      const barKey = `${f1.toFixed(4)}|${f2.toFixed(4)}|${f3.toFixed(4)}|${GAP}`;
      if (barKey !== lastBars) for (const b of bars) {
        b.el.setAttribute("x", String(b.x + OFF[b.g] * GAP * f2));
        b.el.setAttribute("y", String(lerp(by, yTop, f1)));
        b.el.setAttribute("height", String(lerp(bh + b.ext, yBot - yTop, f1)));
        css(b.el, "opacity", String(b.g === "lab" ? 1 : lerp(1, 0.2, f3)));
      }
      lastBars = barKey;
      if (f3 > 0 && gx.lab) {
        labOff = false;
        const lx0 = gx.lab.x0 + OFF.lab * GAP - GAP * 0.35, lx1 = gx.lab.x1 + OFF.lab * GAP + GAP * 0.35;
        labHi.setAttribute("x", String(lx0)); labHi.setAttribute("width", String(lx1 - lx0));
        labHi.setAttribute("y", String(yTop)); labHi.setAttribute("height", String(yBot - yTop));
        labHi.setAttribute("opacity", String(f3 * (1 - fo)));
      } else if (!labOff) { labHi.setAttribute("opacity", "0"); labOff = true; }
      const lo = f2 * (1 - fo);
      css(lanesEl, "opacity", String(lo));
      if (lo > 0) LANES.forEach((l) => {
        const gg = gx[l.g];
        if (!gg) return;
        const cx = (gg.x0 + gg.x1) / 2 + OFF[l.g] * GAP * f2;
        css(l.el, "transform", `translateX(calc(${toS(cam, [cx, 0])[0].toFixed(1)}px - 50%))`);
      });
      css(labcard, "opacity", String(f3 * (1 - fo)));
      css(labcard, "transform", `translateX(${(1 - f3) * 16}px)`);
      if (t > 2.8) e = lerp(eDiveEnd, 6.3, ease(seg(t, 2.8, 2.88)));
    } else {
      css(micro, "visibility", "hidden"); css(lanesEl, "opacity", "0"); css(labcard, "opacity", "0");
      css(callout, "visibility", "hidden");
    }
    let v = 0;
    if (t >= 2.7 && t < 3.6) v = seg(t, 2.7, 2.8);
    let gvis = false;
    if (t >= 2.82 && t < 4.62) {
      gvis = true;
      let k: number, rot: V2, tx = GX, ty = GY, arcP = 0, night = 1;
      if (t < 3.1) { k = GR * llerp(9, 1, easeO(seg(t, 2.84, 3.1))); rot = US; }
      else if (t < 3.6) { k = GR; rot = geoInterpolate(US, MID)(ease(seg(t, 3.12, 3.58))) as V2; arcP = ease(seg(t, 3.1, 3.5)); }
      else {
        const fr = easeO(seg(t, 3.6, 3.84)), fz = ease(seg(t, 3.64, 4.0));
        k = GR * llerp(1, KMAX, fz);
        rot = geoInterpolate(MID, PIN)(fr) as V2;
        tx = lerp(GX, PX, fr); ty = lerp(GY, PY, fr); arcP = 1;
      }
      const eG = Math.log10((FR / k) * 6.371e6);
      if (t >= 3.6) { night = seg(eG, 3.95, 4.7); v = night; }
      const op = seg(t, 2.82, 2.9) * (1 - seg(t, 4.3, 4.58));
      renderGlobe({ k, rot, tx, ty, arcP, night, op, e: eG, rings: clamp((eG - 6.1) / 0.4), nf: seg(t, 3.42, 3.52) * (1 - seg(t, 3.7, 3.8)) });
      if (t >= 2.88) e = eG;
    }
    if (t >= 6.75 && !MOB) {
      gvis = true;
      renderGlobe({ k: SR, rot: MID, tx: SX, ty: SY, arcP: 1, night: 0, op: seg(t, 6.8, 7.05), e: 7.4, rings: 0.9 });
    }
    if (!gvis) { css(gsvg, "opacity", "0"); ML.forEach((m) => (css(m.el!, "opacity", "0"))); css(siteMark, "opacity", "0"); css(nextFrame, "opacity", "0"); }
    css(voidEl, "opacity", String(v));
    root.classList.toggle("fm-dark", v > 0.5);
    if (t >= 3.88 && t < 4.75) {
      const fin = easeO(seg(t, 3.9, 4.02)), fz2 = ease(seg(t, 4.3, 4.72));
      css(reg, "opacity", String(fin * (1 - seg(t, 4.5, 4.68))));
      const dx = (W / 2 - rowC.x) * fz2, dy = (H / 2 - rowC.y) * fz2;
      css(reg, "transform", `translate(${dx}px,${dy + (1 - fin) * 14}px) scale(${lerp(1, 3.2, fz2)})`);
      if (t >= 4.0) e = eFinal;
    } else css(reg, "opacity", "0");
    if (t >= 4.0 && t < 6.85) e = eFinal;
    if (D.oai && t >= 4.3) dateMs = lerp(dms(D.asOf), dms(D.oai.end), ease(seg(t, 4.3, 4.9)));
    if (insp && stamp && t >= 4.5 && t < 5.9) {
      const fi = ease(seg(t, 4.5, 5.0)), fx = ease(seg(t, 5.4, 5.85));
      css(insp, "opacity", String(seg(t, 4.56, 4.8) * (1 - seg(t, 5.55, 5.85))));
      const icx = inspBox.x + inspBox.w / 2, icy = inspBox.y + inspBox.h / 2;
      const tx2 = (W / 2 - icx) * (1 - fi), ty2 = (H / 2 - icy) * (1 - fi) - fx * 40;
      css(insp, "transform", `translate(${tx2}px,${ty2}px) scale(${lerp(0.3, 1, fi) * lerp(1, 0.92, fx)})`);
      const fs = seg(t, 5.0, 5.14);
      // a hair of opacity before it lands, so the ink texture is rastered once ahead of the stamp
      css(stamp, "opacity", String(fs <= 0 ? 0.001 : lerp(0.15, 0.93, clamp(fs * 2.5))));
      css(stamp, "transform", `rotate(${lerp(-16, -8, easeO(fs))}deg) scale(${lerp(2.4, 1, easeI(fs))})`);
    } else if (insp) css(insp, "opacity", "0");
    if (L && t >= 5.4) dateMs = lerp(dms(D.oai!.end), dms(L.posted), ease(seg(t, 5.4, 6.0)));
    if (L && t >= 6.15) dateMs = lerp(dms(L.posted), dms(D.asOf), ease(seg(t, 6.15, 6.55)));
    if (t >= 5.5 && t < 6.95) renderRuler(t, seg(t, 5.6, 5.95) * (1 - seg(t, 6.75, 6.95)));
    else css(rsvg, "opacity", "0");
    if (rHead) css(rHead, "opacity", String(t >= 5.5 && t < 6.95 ? seg(t, 5.75, 6.0) * (1 - seg(t, 6.75, 6.9)) : 0));
    if (rTail) css(rTail, "opacity", String(t >= 6.2 && t < 6.95 ? seg(t, 6.38, 6.55) * (1 - seg(t, 6.75, 6.9)) : 0));
    if (t >= 6.75) {
      e = lerp(eFinal, eDay, ease(seg(t, 6.75, 7.05)));
      const fa = seg(t, 6.85, 7.08);
      css(answer, "opacity", String(fa)); answer.classList.toggle("live", fa > 0.5);
      css(answer, "transform", `translateX(${(1 - easeO(fa)) * 24}px)`);
      const ft = ease(seg(t, 7.1, 7.45));
      AR.forEach((r, i) => {
        const rb = rowBits[i];
        if (!rb) return;
        const dv = lerp(r.a, r.b, ft);
        const txt = dv.toFixed(1);
        if (txt === rb.v) return;
        rb.v = txt;
        css(rb.bar, "transform", `scaleX(${clamp(dv / 21).toFixed(4)})`);
        rb.fig.textContent = txt;
        rb.el.classList.toggle("low", dv < 7);
      });
      if (trackTo && trackFrom) {
        const a = AR[toI], f = AR[fromI];
        const ex1 = trackTo.x + trackTo.w * clamp(lerp(a.a, a.b, ft) / 21);
        for (let j = 0; j < pips.length; j++) {
          const pf = clamp(ft * 2.2 - (j / pips.length) * 1.2);
          const p = pips[j];
          if (pf <= 0 || pf >= 1 || RM.matches) { css(p, "opacity", "0"); continue; }
          const sx = trackFrom.x + trackFrom.w * (f.a / 21) - j * 1.2, sy = trackFrom.y - 5;
          const x = lerp(sx, ex1, pf), yv = lerp(sy, trackTo.y - 5, pf) - Math.sin(Math.PI * pf) * (MOB ? 44 : 30);
          css(p, "opacity", "1");
          css(p, "transform", `translate(${x.toFixed(1)}px,${yv.toFixed(1)}px)`);
        }
      }
    } else { css(answer, "opacity", "0"); answer.classList.remove("live"); }
    setGauge(e, t, dateMs);
  }

  let raf = 0, dirty = true;
  const frame = () => { raf = 0; const t = readT(); if (dirty || Math.abs(t - tNow) > 1e-5) { tNow = t; dirty = false; render(t); } };
  const req = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const onResize = () => { layout(); dirty = true; req(); };
  // the page above the film grows as its sections hydrate and lay out: re-measure where the film starts
  let lastDocH = 0;
  const ro = new ResizeObserver(() => { const h = document.documentElement.scrollHeight; if (h !== lastDocH) { lastDocH = h; measureRoot(); dirty = true; req(); } });
  ro.observe(document.body);
  const onRM = () => { dirty = true; req(); };
  const onTheme = () => { readPal(); dirty = true; req(); };
  window.addEventListener("scroll", req, { passive: true });
  window.addEventListener("resize", onResize);
  RM.addEventListener("change", onRM);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onTheme);
  const mo = new MutationObserver(onTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  root.classList.add("fm-live");
  layout();
  render(readT());
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
  if (idle) idle(() => { loadGeo(); idle(load50); }); else setTimeout(() => { loadGeo(); setTimeout(load50, 600); }, 200);
  document.fonts?.ready.then(() => { layout(); dirty = true; req(); });

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("scroll", req);
    window.removeEventListener("resize", onResize);
    RM.removeEventListener("change", onRM);
    mq.removeEventListener("change", onTheme);
    mo.disconnect();
    ro.disconnect();
    prevB.removeEventListener("click", onPrev);
    nextB.removeEventListener("click", onNext);
    ML.forEach((m) => m.el?.remove());
    [gSph, gGrat, gLand, gInd, gRings, gArcH, gArc, frSvg].forEach((n) => n.remove());
    pips.forEach((p) => p.remove());
    root.classList.remove("fm-live", "fm-dark");
  };
}
