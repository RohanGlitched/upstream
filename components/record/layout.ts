// Lays FDA's record out along the thread: a scale that is true inside each stretch of time with marked
// breaks between stretches, and documents packed under their dates so none overlaps another.
import type { DeskModel, Hang, HangKind, Segment } from "./model";
import { dayNo, isoOf } from "./model";

export const THREAD_Y = 104; // where the thread runs along the ruler, from the record's top
export const RULER_H = 118;
const BREAK = 34;

export const CARD_W: Record<HangKind | "slip", number> = {
  oai: 326, vai: 214, vai_group: 226, letter: 214, posting: 252, import_alert: 222, warning_letter: 232,
  recall: 238, action: 210, today: 158, slip: 300,
};

export function estimateH(h: Hang | "slip"): number {
  if (h === "slip") return 300;
  switch (h.kind) {
    case "oai":
      return 230 + h.observations.length * 22 + h.history.length * 21;
    case "vai":
      return 200;
    case "vai_group":
      return 92 + h.items.length * 21;
    case "letter":
      return 196;
    case "posting":
      return 300;
    case "import_alert":
      return 236;
    case "warning_letter":
      return 206;
    case "recall":
      return 236;
    case "action":
      return 150;
    case "today":
      return 136;
  }
}

export interface Scale {
  x: (iso: string | number) => number;
  segs: { seg: Segment; x0: number; w: number }[];
  width: number;
}

export function buildScale(segments: Segment[], width: number): Scale {
  const n = segments.length;
  const avail = Math.max(120, width - BREAK * (n - 1));
  const durs = segments.map((s) => Math.max(1, s.end - s.start));
  const total = durs.reduce((a, b) => a + b, 0);
  const MIN = Math.min(96, avail / n);
  let ws = durs.map((d) => Math.max(MIN, (d / total) * avail));
  const over = ws.reduce((a, b) => a + b, 0) - avail;
  if (over > 0) {
    const flex = ws.map((w) => Math.max(0, w - MIN));
    const fsum = flex.reduce((a, b) => a + b, 0) || 1;
    ws = ws.map((w, i) => w - (flex[i] / fsum) * over);
  }
  const segs: Scale["segs"] = [];
  let x = 0;
  segments.forEach((seg, i) => {
    segs.push({ seg, x0: x, w: ws[i] });
    x += ws[i] + BREAK;
  });
  const xOf = (v: string | number) => {
    const d = typeof v === "number" ? v : dayNo(v);
    let best = segs[0];
    for (const s of segs) if (d >= s.seg.start) best = s;
    const { seg, x0, w } = best;
    const t = Math.min(1, Math.max(0, (d - seg.start) / Math.max(1, seg.end - seg.start)));
    return x0 + t * w;
  };
  return { x: xOf, segs, width };
}

export interface Tick {
  x: number;
  h: number;
  label: string | null;
  year: boolean;
}

export function ticks(scale: Scale, wide: boolean): Tick[] {
  const out: Tick[] = [];
  for (const { seg, x0, w } of scale.segs) {
    const days = Math.max(1, seg.end - seg.start);
    const pxDay = w / days;
    const pxMonth = pxDay * 30.4;
    const weekly = wide && pxDay * 7 >= 4;
    let lastLabel = -1e9;
    for (let d = seg.start; d <= seg.end; d++) {
      const iso = isoOf(d);
      const day = Number(iso.slice(8, 10));
      const first = day === 1;
      const monday = new Date(d * 86_400_000).getUTCDay() === 1;
      const x = x0 + (d - seg.start) * pxDay;
      if (first) {
        const m = Number(iso.slice(5, 7));
        const year = m === 1;
        const shortSeg = days < 100;
        const showMonth = !shortSeg && (pxMonth >= 34 || (pxMonth >= 16 && m % 3 === 1) || year);
        const quarterOnly = pxMonth < 9 && !year && m % 3 !== 1;
        if (quarterOnly) continue;
        let label: string | null = null;
        if (showMonth && x - lastLabel > 30) {
          label = year ? iso.slice(0, 4) : MONTHS[m - 1];
          lastLabel = x;
        }
        out.push({ x, h: year ? 26 : 20, label, year });
      } else if (weekly && monday) out.push({ x, h: 8, label: null, year: false });
      else if (wide && pxDay >= 3.2) out.push({ x, h: 4, label: null, year: false });
    }
    // A stretch too short for a January still says which year it is.
    if (!out.some((t) => t.year && t.x >= x0 && t.x <= x0 + w)) {
      const y = isoOf(seg.start + Math.round(days / 2)).slice(0, 4);
      out.push({ x: x0 + 2, h: 0, label: y, year: true });
    }
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface Placed {
  key: string;
  hang: Hang | null; // null: the best-move slip
  x: number; // the clip's x on the thread
  left: number;
  top: number;
  w: number;
  h: number;
  ox: number;
}

export function pack(m: DeskModel, scale: Scale, width: number, heights: Record<string, number>): { placed: Placed[]; height: number } {
  const placed: Placed[] = [];
  const GAPX = 14;
  const GAPY = 18;
  const DROP = 30;
  const items: { key: string; hang: Hang | null; x: number; w: number; h: number }[] = m.hangs.map((h) => ({
    key: h.id,
    hang: h,
    x: h.kind === "today" ? scale.x(m.today) : scale.x(h.date),
    w: CARD_W[h.kind],
    h: heights[h.id] ?? estimateH(h),
  }));
  if (m.best) items.push({ key: "slip", hang: null, x: width - 8, w: CARD_W.slip, h: heights.slip ?? estimateH("slip") });

  const collide = (l: number, t: number, w: number, h: number) =>
    placed.some((p) => l < p.left + p.w + GAPX && l + w + GAPX > p.left && t < p.top + p.h + GAPY && t + h + GAPY > p.top);

  for (const it of items) {
    // Candidate positions: under the date first, then sliding sideways into open desk. A card that slides
    // away from its date hangs on an angled string, and pays for the distance.
    const lefts = new Set<number>();
    if (it.hang) {
      for (const f of [0.14, 0.5, 0.86]) lefts.add(Math.round(it.x - it.w * f));
      for (let k = 1; k <= 5; k++) {
        lefts.add(Math.round(it.x - it.w * 0.14 + k * it.w * 0.62));
        lefts.add(Math.round(it.x - it.w * 0.86 - k * it.w * 0.62));
      }
    } else lefts.add(Math.round(width - it.w));
    let best: Placed | null = null;
    let bestCost = Infinity;
    for (const l0 of lefts) {
      const left = Math.max(0, Math.min(width - it.w, l0));
      const ox = Math.min(it.w - 18, Math.max(18, it.x - left));
      const off = Math.abs(left + ox - it.x);
      const ys = [THREAD_Y + DROP, ...placed.map((p) => p.top + p.h + GAPY)].filter((y) => y >= THREAD_Y + DROP).sort((a, b) => a - b);
      for (const y of ys) {
        if (collide(left, y, it.w, it.h)) continue;
        // Strings may angle, but not across half the desk.
        if (it.hang && off > Math.max(160, (y - THREAD_Y) * 1.1)) break;
        const cost = y + off * 0.9;
        if (cost < bestCost) {
          bestCost = cost;
          best = { key: it.key, hang: it.hang, x: it.x, left, top: y, w: it.w, h: it.h, ox };
        }
        break;
      }
    }
    if (!best) {
      const left = Math.max(0, Math.min(width - it.w, it.x - it.w / 2));
      const y = Math.max(THREAD_Y + DROP, ...placed.map((p) => p.top + p.h + GAPY));
      best = { key: it.key, hang: it.hang, x: it.x, left, top: y, w: it.w, h: it.h, ox: Math.min(it.w - 18, Math.max(18, it.x - left)) };
    }
    placed.push(best);
  }
  const height = Math.max(THREAD_Y + 80, ...placed.map((p) => p.top + p.h)) + 24;
  return { placed, height };
}
