// What the sheet shows on one day of FDA's record: silt, dry beds, marks, the cursor.
// Pure, so the server can draw the finished state and the replay can draw any day.
import type { Geo } from "./geometry";
import { clamp, smooth } from "./geometry";
import type { Day, WsModel } from "./model";
import { dstr, isRed, monthStr, plantState } from "./model";

export const C = {
  water: "var(--ws-water)",
  silt: "var(--ws-silt)",
  cloud: (p: number) => `color-mix(in srgb, var(--ws-water), var(--ws-cloud) ${Math.round(p * 100)}%)`,
  mix: (share: number) => `color-mix(in srgb, var(--ws-water), var(--ws-silt) ${Math.round(share * 100)}%)`,
};

export interface StreamState {
  stops: [string, string, number];
  water: number; // full-width water opacity
  low: number; // narrowed water (listed, no FDA finding upstream)
  bed: number;
  dash: boolean;
  thread: number;
  /** fraction (0 top .. 1 bottom) down to which the particles run silted */
  front: number;
  squeeze: number;
}

export interface PlantView {
  cloud: number;
  ring: "oai" | "vai" | "insp" | null;
  state: { text: string; tone: "red" | "amber" | "quiet" | "" };
  wl: boolean[];
  ia: boolean[];
}

export interface Frame {
  t: Day;
  trib: StreamState[];
  branch: Record<string, StreamState>;
  plant: Record<string, PlantView>;
  flag: Record<string, boolean>;
  cursorX: number;
  listedFrom: number | null;
  glyph: boolean[];
  date: string;
  listed: { lead: string; value: string } | null;
  cur: number;
}

const SILT_DAYS = 26;

export function tlX(m: WsModel, g: Geo, t: Day): number {
  const span = Math.max(1, m.today - m.t0);
  return g.tl.x0 + ((t - m.t0) / span) * (g.tl.x1 - g.tl.x0);
}

function short(d: Day, mobile: boolean) {
  return mobile ? monthStr(d) : dstr(d);
}

export function frameAt(m: WsModel, g: Geo, t: Day): Frame {
  const plant: Record<string, PlantView> = {};
  const states = new Map(m.plants.map((p) => [p.key, plantState(p, t)]));
  for (const p of m.plants) {
    const st = states.get(p.key)!;
    let text = "", tone: PlantView["state"]["tone"] = "";
    const lastOai = [...p.signals].reverse().find((s) => s.kind === "inspection_oai" && s.known <= t);
    const lastVai = [...p.signals].reverse().find((s) => s.kind === "inspection_vai" && s.known <= t);
    const pending = p.signals.find((s) => s.kind === "inspection_oai" && s.t <= t && t < s.known);
    if (st.cls === "OAI" && lastOai) { text = g.mobile ? "OAI" : `OAI, letter dated ${dstr(lastOai.known)}`; tone = "red"; }
    else if (pending) { text = g.mobile ? "inspected" : `Inspected to ${dstr(pending.t)}, under review`; tone = "quiet"; }
    else if (st.cls === "VAI" && lastVai) { text = g.mobile ? "VAI" : `VAI, ${short(lastVai.t, false)}`; tone = "amber"; }
    else if (!p.placed) text = "";
    else if (!p.signals.length) text = g.mobile ? "" : "No inspection on FDA's file";
    plant[p.key] = {
      cloud: st.cloud ? 1 : 0,
      ring: st.cls === "OAI" ? "oai" : pending ? "insp" : st.cls === "VAI" ? "vai" : null,
      state: { text, tone },
      wl: p.signals.filter((s) => s.kind === "warning_letter").map((s) => s.t <= t),
      ia: p.signals.filter((s) => s.kind === "import_alert").map((s) => s.t <= t),
    };
  }

  const posting = m.posting;
  const listedOn = m.listedNow && posting !== null && t >= posting;
  const dry = listedOn && posting !== null ? smooth(posting, posting + 28, t) : 0;
  const flag: Record<string, boolean> = {};
  const branch: Record<string, StreamState> = {};
  const labRed: Record<string, boolean> = {};
  for (const l of m.labelers) {
    const es = m.edges.filter((e) => e.labeler === l.key);
    const tot = es.reduce((a, e) => a + e.use, 0) || 1;
    let redShare = 0, front = 0, cloud = 0;
    for (const e of es) {
      const st = states.get(e.plant)!;
      if (st.cls === "OAI") {
        redShare += e.use / tot;
        front = Math.max(front, clamp((st.siltAge - SILT_DAYS) / 22, 0, 1));
      }
      if (st.cloud) cloud = Math.max(cloud, 0.5);
    }
    if (es.length && redShare === 0 && es.every((e) => e.use === 0)) redShare = 0;
    const red = es.some((e) => isRed(states.get(e.plant)!));
    labRed[l.key] = red;
    flag[l.key] = l.listed && listedOn;
    const d = l.listed ? dry : 0;
    const full = red;
    branch[l.key] = {
      stops: redShare > 0 ? [C.mix(Math.min(1, redShare)), C.water, front] : cloud ? [C.cloud(0), C.water, 0] : [C.water, C.water, 0],
      water: 1 - d * (full ? 0.92 : 1),
      low: full ? 0 : d,
      bed: d * 0.9,
      dash: d > 0.5,
      thread: full ? d : 0,
      front: redShare > 0.5 ? front : 0,
      squeeze: full ? 1 - d * 0.86 : 1 - d * 0.5,
    };
  }
  const trib: StreamState[] = g.tribs.map((tb) => {
    const st = states.get(tb.plant)!;
    const l = m.labelers.find((x) => x.key === tb.lab)!;
    const d = l.listed ? dry : 0;
    const full = labRed[tb.lab];
    let stops: StreamState["stops"] = [C.water, C.water, 0];
    let front = 0;
    if (st.cls === "OAI") {
      front = clamp(st.siltAge / SILT_DAYS, 0, 1) * 1.02;
      stops = [C.silt, C.water, front];
    } else if (st.cloud) {
      const p = states.get(tb.plant)!.cloud ? 0.55 : 0;
      stops = [C.cloud(p), C.water, 0.22];
    }
    const own = isRed(st);
    return {
      stops, water: 1 - d * (full ? 0.92 : 1), low: full ? 0 : d, bed: d * 0.9, dash: d > 0.5,
      thread: full && own ? d : 0, front: st.cls === "OAI" ? front : 0, squeeze: full ? 1 - d * 0.86 : 1 - d * 0.5,
    };
  });

  let cur = -1;
  m.events.forEach((e, i) => { if (t >= e.t) cur = i; });
  let listed: Frame["listed"] = null;
  if (posting !== null && m.listedNow) {
    if (t < posting) listed = { lead: "Not yet on FDA's shortage list", value: "" };
    else {
      const ld = Math.round(t - posting);
      const mo = Math.max(0, Math.round(ld / 30.44));
      listed = { lead: "On FDA's list", value: ld < 61 ? `${ld} ${ld === 1 ? "day" : "days"}` : `${mo} months` };
    }
  } else if (posting !== null) {
    listed = t >= posting ? { lead: "FDA posted a shortage; resolved since", value: "" } : { lead: "Not on FDA's shortage list", value: "" };
  } else listed = { lead: "Not on FDA's shortage list", value: "" };

  return {
    t, trib, branch, plant, flag,
    cursorX: tlX(m, g, t),
    listedFrom: listedOn && posting !== null ? tlX(m, g, posting) : null,
    glyph: m.events.map((e) => t >= e.t),
    date: dstr(t), listed, cur,
  };
}

/** Playback plan: a beat on each event, quicker through the quiet years, about 14 seconds in all. */
export interface Plan { keys: { t: Day; at: number }[]; total: number }
export function planReplay(m: WsModel): Plan {
  const pts = [m.t0, ...m.events.map((e) => e.t)].filter((t, i, a) => i === 0 || t > a[i - 1]);
  const raw: { t: Day; at: number }[] = [{ t: m.t0, at: 0 }];
  let at = 0.4;
  raw[0].at = 0;
  for (let i = 1; i < pts.length; i++) {
    const gap = pts[i] - pts[i - 1];
    at += 0.35 + 0.5 * Math.log1p(gap / 45);
    raw.push({ t: pts[i], at });
    const ev = m.events.find((e) => e.t === pts[i]);
    const hold = !ev ? 0.2 : ev.tone === "red" || ev.tone === "mag" ? 0.75 : ev.tone === "amber" ? 0.22 : 0;
    if (hold) { at += hold; raw.push({ t: pts[i], at }); }
  }
  const total = at;
  const target = clamp(total, 7, 15);
  const f = target / Math.max(0.001, total);
  return { keys: raw.map((k) => ({ t: k.t, at: k.at * f })), total: target };
}
export function planAt(p: Plan, s: number): Day {
  const k = p.keys;
  if (s <= 0) return k[0].t;
  for (let i = 1; i < k.length; i++) {
    if (s <= k[i].at) {
      const a = k[i - 1], b = k[i];
      const f = b.at > a.at ? (s - a.at) / (b.at - a.at) : 1;
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      return a.t + (b.t - a.t) * e;
    }
  }
  return k[k.length - 1].t;
}
