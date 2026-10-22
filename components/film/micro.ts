// The drawer, the vials, their labels and the real UPC-A barcode, as one static SVG in millimetres.
// Built from the case: the pockets are the focus hospital's stock lines, the barcode the focus NDC.
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R = L.map((c) => c.replace(/./g, (b) => (b === "0" ? "1" : "0")));

/** UPC-A for a drug: number system 3, the ten NDC digits, the check digit. */
export function upcDigits(ndc10: string): number[] {
  const d = ("3" + ndc10).split("").map(Number);
  let o = 0, e = 0;
  d.forEach((v, i) => (i % 2 === 0 ? (o += v) : (e += v)));
  d.push((10 - ((o * 3 + e) % 10)) % 10);
  return d;
}
/** Which part of the code each UPC digit belongs to: number system, NDC labeler, product, package, check. */
export type Grp = "ns" | "lab" | "mid" | "prod" | "pkg" | "chk";
export function digitGroups(packageNdc: string): Grp[] {
  const [a, b] = packageNdc.split("-").map((x) => x.length);
  const g: Grp[] = ["ns"];
  for (let i = 0; i < 10; i++) g.push(i < a ? "lab" : i < a + b ? "prod" : "pkg");
  g.push("chk");
  return g;
}
interface Run { m0: number; w: number; grp: Grp; guard: boolean }
function upcRuns(d: number[], groups: Grp[]): Run[] {
  const units: { bits: string; grp: Grp; guard?: boolean }[] = [{ bits: "101", grp: "ns", guard: true }];
  for (let i = 0; i < 6; i++) units.push({ bits: L[d[i]], grp: groups[i] });
  units.push({ bits: "01010", grp: "mid", guard: true });
  for (let i = 6; i < 12; i++) units.push({ bits: R[d[i]], grp: groups[i] });
  units.push({ bits: "101", grp: "chk", guard: true });
  const runs: Run[] = [];
  let m = 0;
  for (const u of units) {
    let start = -1;
    for (let k = 0; k <= u.bits.length; k++) {
      const on = u.bits[k] === "1";
      if (on && start < 0) start = k;
      if (!on && start >= 0) { runs.push({ m0: m + start, w: k - start, grp: u.grp, guard: !!u.guard }); start = -1; }
    }
    m += u.bits.length;
  }
  return runs;
}
const f = (v: number) => +v.toFixed(3);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function barcode(ndc10: string, groups: Grp[], x: number, y: number, w: number, h: number, opts: { data?: boolean; cls?: string; dcls?: string } = {}) {
  const d = upcDigits(ndc10);
  const runs = upcRuns(d, groups);
  const mw = w / 95;
  let s = `<g class="${opts.cls || ""}">`;
  for (const r of runs) {
    const ext = r.guard ? h * 0.1 : 0;
    s += `<rect ${opts.data ? `data-g="${r.grp}" data-x="${f(x + r.m0 * mw)}" data-w="${f(r.w * mw)}" data-ext="${f(ext)}" ` : ""}x="${f(x + r.m0 * mw)}" y="${f(y)}" width="${f(r.w * mw)}" height="${f(h + ext)}"/>`;
  }
  s += `</g>`;
  const fs = h * 0.15;
  const ty = y + h + fs * 1.05;
  const str = d.join("");
  s += `<g class="${opts.dcls || ""}" font-size="${f(fs)}">`;
  s += `<text x="${f(x - mw * 2)}" y="${f(ty)}" text-anchor="end">${str[0]}</text>`;
  s += `<text x="${f(x + mw * 24)}" y="${f(ty)}" text-anchor="middle" letter-spacing="${f(fs * 0.18)}">${str.slice(1, 6)}</text>`;
  s += `<text x="${f(x + mw * 71)}" y="${f(ty)}" text-anchor="middle" letter-spacing="${f(fs * 0.18)}">${str.slice(6, 11)}</text>`;
  s += `<text x="${f(x + w + mw * 2)}" y="${f(ty)}">${str[11]}</text></g>`;
  return { svg: s, digits: str };
}

export interface LabelSpec {
  ndc: string; // package NDC as printed, 16729-295-12
  drug: string; // Tall Man
  form: string; // Injection
  dose: string; // 600 mg/60 mL
  conc: string; // (10 mg/mL)
  vial: string; // Multiple-dose vial
  hazard: string | null; // Cytotoxic agent. Handle with care.
  labeler: string;
}

// a 64 x 35 label in label-local mm; fonts come from the page (Public Sans for packaging)
function labelBody(spec: LabelSpec, noBars: boolean) {
  const ndc10 = spec.ndc.replace(/-/g, "");
  let s = "";
  s += `<rect width="64" height="35" class="fl-paper"/>`;
  s += `<rect width="64" height="5.4" class="fl-band"/>`;
  s += `<text x="2.2" y="3.75" font-size="2.45" class="fl-band-t" font-weight="600" letter-spacing=".05">NDC ${esc(spec.ndc)}</text>`;
  s += `<text x="61.8" y="3.75" font-size="2.2" class="fl-band-t" text-anchor="end">Rx only</text>`;
  const dsz = Math.min(6.5, 64 / Math.max(6, spec.drug.length) * 1.55);
  s += `<text x="2.1" y="12.7" font-size="${f(dsz)}" font-weight="760" letter-spacing="-.1">${esc(spec.drug)}</text>`;
  s += `<text x="2.3" y="16.7" font-size="2.8">${esc(spec.form)}</text>`;
  if (spec.dose) s += `<text x="2.3" y="22.1" font-size="3.5" font-weight="700">${esc(spec.dose)}</text>`;
  if (spec.conc) s += `<text x="2.3" y="25.5" font-size="2.25">${esc(spec.conc)}</text>`;
  s += `<text x="2.3" y="28.7" font-size="1.42" class="fl-soft">${esc(spec.vial)}. For intravenous use only.</text>`;
  if (spec.hazard) {
    s += `<rect y="30.6" width="64" height="4.4" class="fl-hazard"/>`;
    s += `<text x="2.3" y="33.55" font-size="1.85" font-weight="650">${esc(spec.hazard)}</text>`;
  } else s += `<rect y="30.6" width="64" height="4.4" class="fl-plain"/>`;
  s += `<text x="61.8" y="33.55" font-size="1.55" text-anchor="end">${esc(spec.labeler)}</text>`;
  if (!noBars) s += barcode(ndc10, digitGroups(spec.ndc), 38.9, 14, 20.2, 10.5).svg;
  return s;
}

function vial(id: string, x: number, y: number, Lh: number, Dm: number, spec: LabelSpec, opts: { noBars?: boolean; labelId?: string } = {}) {
  const body = Lh * 0.755, sh = Lh * 0.06, nk = Lh * 0.05, cr = Lh * 0.07, cp = Lh * 0.065;
  const cy = Dm / 2;
  const nr = Dm * 0.26, crr = Dm * 0.33, cpr = Dm * 0.35;
  let s = `<g id="${id}" transform="translate(${f(x)} ${f(y)})">`;
  s += `<rect x="${f(Lh * 0.02)}" y="${f(Dm * 0.16)}" width="${f(Lh)}" height="${f(Dm)}" rx="${f(Dm * 0.45)}" fill="url(#flShadow)"/>`;
  s += `<path d="M ${f(Dm * 0.14)} 0 H ${f(body)} C ${f(body + sh * 0.6)} 0 ${f(body + sh)} ${f(cy - nr - Dm * 0.06)} ${f(body + sh)} ${f(cy - nr)} H ${f(body + sh + nk)} V ${f(cy + nr)} H ${f(body + sh)} C ${f(body + sh)} ${f(cy + nr + Dm * 0.06)} ${f(body + sh * 0.6)} ${f(Dm)} ${f(body)} ${f(Dm)} H ${f(Dm * 0.14)} Q 0 ${f(Dm)} 0 ${f(Dm * 0.86)} V ${f(Dm * 0.14)} Q 0 0 ${f(Dm * 0.14)} 0 Z" fill="url(#flGlass)" stroke="#9AA3A2" stroke-width="${f(Dm * 0.012)}"/>`;
  s += `<rect x="${f(body + sh + nk)}" y="${f(cy - crr)}" width="${f(cr)}" height="${f(crr * 2)}" rx="${f(Dm * 0.03)}" fill="url(#flCrimp)"/>`;
  s += `<rect x="${f(body + sh + nk + cr)}" y="${f(cy - cpr)}" width="${f(cp)}" height="${f(cpr * 2)}" rx="${f(Dm * 0.06)}" fill="url(#flCap)"/>`;
  const lx = Lh * 0.051, lw = Lh * 0.653, ly = Dm * 0.093, lh = Dm * 0.814;
  const sc = Math.min(lw / 64, lh / 35);
  const ly2 = ly + (lh - 35 * sc) / 2;
  s += `<g ${opts.labelId ? `id="${opts.labelId}" ` : ""}transform="translate(${f(lx)} ${f(ly2)}) scale(${f(sc)})">${labelBody(spec, !!opts.noBars)}</g>`;
  s += `<rect x="0" y="0" width="${f(body)}" height="${f(Dm)}" rx="${f(Dm * 0.14)}" fill="url(#flCyl)" pointer-events="none"/>`;
  s += `</g>`;
  return { svg: s, label: { x: x + lx, y: y + ly2, s: sc } };
}

export interface Pocket { itemKey: string; desc: string; labeler: string; onHand: number; large: boolean; spec: LabelSpec; focus: boolean }
export interface MicroGeo {
  drawer: { x: number; y: number; w: number; h: number };
  label: { x: number; y: number; w: number; h: number };
  bars: { x: number; y: number; w: number; h: number };
  pocketFocus: { x: number; y: number; w: number; h: number };
  digits: string;
  focusIndex: number;
}

export function buildMicro(pockets: Pocket[], cabinet: string, totalLine: string): { svg: string; geo: MicroGeo } {
  const W = 660, Hh = 400;
  let s = "";
  s += `<defs>
<linearGradient id="flSteel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E4E8E7"/><stop offset=".5" stop-color="#CED3D1"/><stop offset="1" stop-color="#DCE0DF"/></linearGradient>
<linearGradient id="flTray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B9C0BE"/><stop offset="1" stop-color="#C9CFCD"/></linearGradient>
<linearGradient id="flPocket" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9CFCD"/><stop offset=".07" stop-color="#E0E4E3"/><stop offset="1" stop-color="#ECEFEE"/></linearGradient>
<linearGradient id="flLip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F1F3F2"/><stop offset="1" stop-color="#BCC3C1"/></linearGradient>
<linearGradient id="flGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C3CCCB"/><stop offset=".16" stop-color="#F6F9F9"/><stop offset=".3" stop-color="#DCE3E3"/><stop offset=".7" stop-color="#D2DADA"/><stop offset=".86" stop-color="#EEF2F2"/><stop offset="1" stop-color="#AEB8B7"/></linearGradient>
<linearGradient id="flCyl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".26"/><stop offset=".12" stop-color="#000" stop-opacity=".04"/><stop offset=".2" stop-color="#fff" stop-opacity=".42"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset=".9" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
<linearGradient id="flCrimp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9DA4A4"/><stop offset=".25" stop-color="#F2F4F4"/><stop offset=".6" stop-color="#C5CACA"/><stop offset="1" stop-color="#8E9696"/></linearGradient>
<linearGradient id="flCap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3E2A63"/><stop offset=".25" stop-color="#7A5BB0"/><stop offset=".65" stop-color="#5A3F8C"/><stop offset="1" stop-color="#2F2050"/></linearGradient>
<radialGradient id="flShadow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".26"/><stop offset=".7" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="flDrawerShadow" cx=".5" cy=".5" r=".5"><stop offset=".7" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs>`;
  s += `<g id="flScene">`;
  s += `<rect x="-24" y="-6" width="${W + 48}" height="${Hh + 40}" rx="40" fill="url(#flDrawerShadow)" opacity=".7"/>`;
  s += `<rect x="0" y="0" width="${W}" height="${Hh}" rx="12" fill="url(#flSteel)" stroke="#A8B0AE" stroke-width=".8"/>`;
  s += `<rect x="12" y="12" width="${W - 24}" height="${Hh - 30}" rx="6" fill="url(#flTray)"/>`;
  const pw = (W - 24 - 4 * 10) / 3, ph = (Hh - 30 - 3 * 10) / 2;
  const cells: { x: number; y: number }[] = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const x = 22 + c * (pw + 10), y = 22 + r * (ph + 10);
    cells.push({ x, y });
    s += `<rect x="${f(x)}" y="${f(y)}" width="${f(pw)}" height="${f(ph)}" rx="4" fill="url(#flPocket)" stroke="#AEB5B3" stroke-width=".6"/>`;
    s += `<text x="${f(x + 7)}" y="${f(y + 13)}" font-size="7.5" fill="#6B7473" font-weight="600">${r * 3 + c + 1}</text>`;
  }
  const P = pockets.slice(0, 6);
  P.forEach((st, i) => {
    const p = cells[i];
    const sy = p.y + ph - 30;
    s += `<rect x="${f(p.x + 5)}" y="${f(sy)}" width="${f(pw - 10)}" height="25" rx="1.5" fill="#FDFDFC" stroke="#B9C0BE" stroke-width=".5"/>`;
    s += `<rect x="${f(p.x + 5)}" y="${f(sy)}" width="3.2" height="25" class="${st.spec.hazard ? "fl-hazard" : "fl-plain-strip"}"/>`;
    s += `<text x="${f(p.x + 13)}" y="${f(sy + 10)}" font-size="7.2" font-weight="650" class="fl-typed" fill="#16191A">${esc(st.itemKey)}</text>`;
    s += `<text x="${f(p.x + 13)}" y="${f(sy + 19.5)}" font-size="5.6" fill="#333">${esc(st.desc)}, ${esc(st.labeler)}</text>`;
    s += `<text x="${f(p.x + pw - 11)}" y="${f(sy + 10.5)}" font-size="8.5" font-weight="700" text-anchor="end" fill="#16191A">${Math.round(st.onHand * 10) / 10}</text>`;
    s += `<text x="${f(p.x + pw - 11)}" y="${f(sy + 19.5)}" font-size="5" fill="#555" text-anchor="end">on hand</text>`;
  });
  s += `<rect x="0" y="${Hh - 16}" width="${W}" height="16" rx="5" fill="url(#flLip)"/>`;
  s += `<rect x="${W / 2 - 110}" y="${Hh - 12}" width="220" height="8" rx="4" fill="#9AA2A0"/>`;
  s += `<text x="16" y="${Hh - 4.5}" font-size="7" fill="#4C5352" font-weight="600">${esc(cabinet)}</text>`;
  s += `<text x="${W - 16}" y="${Hh - 4.5}" font-size="7" fill="#4C5352" text-anchor="end">${esc(totalLine)}</text>`;

  const Lv = 98, Dv = 43;
  const inner = (p: { x: number; y: number }) => ({ cx: p.x + pw / 2, cy: p.y + (ph - 30) / 2 + 2 });
  let focusSvg = "";
  let lb = { x: 0, y: 0, s: 1 };
  let fi = Math.max(0, P.findIndex((p) => p.focus));
  P.forEach((st, i) => {
    const c = inner(cells[i]);
    const n = Math.max(1, Math.min(3, Math.round(st.onHand)));
    if (st.focus) {
      const v = vial("flVfocus", c.cx - Lv / 2, c.cy - Dv / 2, Lv, Dv, st.spec, { noBars: true, labelId: "flFocusLabel" });
      focusSvg = v.svg;
      lb = v.label;
      fi = i;
      return;
    }
    if (st.large || n === 1) {
      const sc = st.large ? 1 : 0.62;
      s += vial(`flV${i}`, c.cx - (Lv * sc) / 2, c.cy - (Dv * sc) / 2, Lv * sc, Dv * sc, st.spec).svg;
    } else {
      const ls = 50, ds = 24;
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * (ds + 6);
        s += vial(`flV${i}_${k}`, c.cx - ls / 2 + (k % 2 ? 6 : -4), c.cy - ds / 2 + off, ls, ds, st.spec).svg;
      }
    }
  });
  s += `</g>`;
  s += focusSvg;
  const focus = P[fi];
  const bx = lb.x + 38.9 * lb.s, by = lb.y + 14 * lb.s, bw = 20.2 * lb.s, bh = 10.5 * lb.s;
  const bc = barcode(focus.spec.ndc.replace(/-/g, ""), digitGroups(focus.spec.ndc), bx, by, bw, bh, { data: true, cls: "fl-bars", dcls: "fl-bardigits" });
  s += `<rect id="flLabHi" x="0" y="0" width="0" height="0" class="fl-labhi" opacity="0"/>`;
  s += `<g>${bc.svg}</g>`;
  s += `<path id="flFr1" class="fl-fr" d=""/><path id="flFr2" class="fl-fr" d=""/>`;
  const cell = cells[fi];
  return {
    svg: s,
    geo: {
      drawer: { x: 0, y: 0, w: W, h: Hh },
      label: { x: lb.x, y: lb.y, w: 64 * lb.s, h: 35 * lb.s },
      bars: { x: bx, y: by, w: bw, h: bh },
      pocketFocus: { x: cell.x, y: cell.y, w: pw, h: ph },
      digits: bc.digits,
      focusIndex: fi,
    },
  };
}
