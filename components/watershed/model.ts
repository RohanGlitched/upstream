// The watershed's reading of one case: plants (springs), labelers (gauges), hospitals (reservoirs),
// the flows between them, and FDA's record as a list of dated events. Pure data, no layout.
import type { Case, Hospital, Plant, Signal } from "../../src/agent/types";
import { tallMan } from "../../src/agent/util";

export type Day = number; // days since 1970-01-01 (UTC)
export const day = (s: string): Day => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dstr(n: Day): string {
  const d = new Date(Math.round(n) * 864e5);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function dshort(n: Day): string {
  const d = new Date(Math.round(n) * 864e5);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`;
}
export function monthStr(n: Day): string {
  const d = new Date(Math.round(n) * 864e5);
  return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Country centroids, as data/plants.json places them, plus names. Positions are rough by design. */
const COUNTRY: Record<string, { name: string; lon: number; lat: number }> = {
  USA: { name: "United States", lon: -98.6, lat: 39.8 },
  CAN: { name: "Canada", lon: -96, lat: 56 },
  PRI: { name: "Puerto Rico", lon: -66.5, lat: 18.2 },
  MEX: { name: "Mexico", lon: -102, lat: 23.6 },
  BRA: { name: "Brazil", lon: -51.9, lat: -14.2 },
  ARG: { name: "Argentina", lon: -63.6, lat: -38.4 },
  PRT: { name: "Portugal", lon: -8, lat: 39.6 },
  ESP: { name: "Spain", lon: -3.7, lat: 40.4 },
  GBR: { name: "United Kingdom", lon: -2.5, lat: 54 },
  IRL: { name: "Ireland", lon: -8, lat: 53.4 },
  FRA: { name: "France", lon: 2.3, lat: 46.6 },
  BEL: { name: "Belgium", lon: 4.5, lat: 50.5 },
  NLD: { name: "Netherlands", lon: 5.3, lat: 52.1 },
  CHE: { name: "Switzerland", lon: 8.2, lat: 46.8 },
  NOR: { name: "Norway", lon: 8.5, lat: 60.5 },
  DNK: { name: "Denmark", lon: 9.5, lat: 56.2 },
  DEU: { name: "Germany", lon: 10.4, lat: 51.1 },
  ITA: { name: "Italy", lon: 12.6, lat: 42.8 },
  AUT: { name: "Austria", lon: 14.1, lat: 47.6 },
  SWE: { name: "Sweden", lon: 15, lat: 62 },
  SVN: { name: "Slovenia", lon: 14.9, lat: 46.1 },
  HRV: { name: "Croatia", lon: 15.2, lat: 45.1 },
  HUN: { name: "Hungary", lon: 19.5, lat: 47.2 },
  POL: { name: "Poland", lon: 19.1, lat: 51.9 },
  FIN: { name: "Finland", lon: 25.7, lat: 61.9 },
  GRC: { name: "Greece", lon: 21.8, lat: 39.1 },
  TUR: { name: "Turkey", lon: 35.2, lat: 39 },
  ISR: { name: "Israel", lon: 34.9, lat: 31 },
  JOR: { name: "Jordan", lon: 36.2, lat: 30.6 },
  EGY: { name: "Egypt", lon: 30.8, lat: 26.8 },
  SAU: { name: "Saudi Arabia", lon: 45, lat: 24 },
  PAK: { name: "Pakistan", lon: 69.3, lat: 30.4 },
  IND: { name: "India", lon: 79, lat: 22.5 },
  BGD: { name: "Bangladesh", lon: 90.4, lat: 23.7 },
  CHN: { name: "China", lon: 105, lat: 33 },
  THA: { name: "Thailand", lon: 101, lat: 15.9 },
  SGP: { name: "Singapore", lon: 103.8, lat: 1.35 },
  KOR: { name: "South Korea", lon: 127.8, lat: 35.9 },
  TWN: { name: "Taiwan", lon: 121, lat: 23.7 },
  JPN: { name: "Japan", lon: 138.3, lat: 36.2 },
  AUS: { name: "Australia", lon: 133.8, lat: -25.3 },
  NZL: { name: "New Zealand", lon: 174.9, lat: -40.9 },
  ZAF: { name: "South Africa", lon: 22.9, lat: -30.6 },
};
export function countryName(iso: string | null): string {
  if (!iso) return "";
  return COUNTRY[iso]?.name ?? iso;
}

export const HOSPITALS: { key: Hospital; short: string }[] = [
  { key: "Corvale General", short: "General" },
  { key: "Corvale East", short: "East" },
  { key: "Corvale Lakeside", short: "Lakeside" },
];
/** Where each hospital's stock is read from (the Zetaris catalog joins all three). */
export const HOSP_SOURCE: Record<Hospital, string> = {
  "Corvale General": "Postgres",
  "Corvale East": "Postgres",
  "Corvale Lakeside": "CSV cabinet exports",
};

const SUFFIX = new Set(
  "inc inc. incorporated llc l.l.c. corp corp. corporation company co co. ltd ltd. limited usa us plc gmbh ag sa s.a. bv b.v. spa s.p.a. pvt private pharmaceuticals pharmaceutical pharma healthcare".split(" "),
);
const GENERIC = new Set(
  "parenteral parenterals medicines medical labs laboratories products health sciences therapeutics specialty injectables generics north america americas".split(" "),
);
function titleCase(s: string): string {
  // FDA's registers shout; set all-caps words (four letters or more) in title case, keep short codes like BV, GmbH
  return s.replace(/[A-ZÀ-Þ][A-ZÀ-Þ'.-]{3,}/g, (w) => w[0] + w.slice(1).toLowerCase());
}
/** "Hikma Pharmaceuticals USA Inc." -> "Hikma"; "HF Acquisition Co LLC, DBA HealthFirst" -> "HealthFirst". */
export function shortFirm(name: string): string {
  const dba = /\bDBA\s+(.+)$/i.exec(name);
  let s = titleCase((dba ? dba[1] : name).split(",")[0].trim());
  const words = s.split(/\s+/);
  const drop = (w: string) => SUFFIX.has(w.toLowerCase()) || GENERIC.has(w.toLowerCase());
  while (words.length > (words[0].length <= 2 ? 2 : 1) && drop(words[words.length - 1])) words.pop();
  s = words.join(" ");
  if (s.length > 20) s = words.slice(0, 2).join(" ");
  return s;
}
/** Plant names as people say them: "PHARMACHEMIE BV" -> "Pharmachemie BV"; drop "Private Limited". */
export function plantName(name: string): string {
  let n = titleCase(name);
  const dba = /\bd\/?b\/?a\s+(.+)$/i.exec(n);
  if (dba) n = dba[1];
  n = n.replace(/\s*\([^)]*\)\s*$/, n.replace(/\s*\([^)]*\)\s*$/, "").length > 20 ? "" : "$&")
    .replace(/,?\s+(Co\.?,?\s*)?(Private\s+)?(Limited|Ltd\.?|Inc\.?|LLC|Corp\.?)$/i, "").trim();
  if (n.length > 30) n = n.split(/\s+/).slice(0, 3).join(" ").replace(/,$/, "");
  return n;
}

const UNIT_PLURAL: Record<string, string> = {
  vial: "vials", package: "packs", bag: "bags", tablet: "tablets", each: "units", capsule: "capsules", syringe: "syringes",
};
export function unitWord(unit: string, n = 2): string {
  if (n === 1) return unit === "each" ? "unit" : unit === "package" ? "pack" : unit;
  return UNIT_PLURAL[unit] ?? `${unit}s`;
}

export interface WsSignal extends Signal {
  t: Day;
  known: Day;
}

export interface WsPlant {
  key: string;
  name: string;
  fullName: string;
  fei: string | null;
  country: string | null;
  countryName: string;
  /** a registered plant with a country we can place; otherwise drawn in the unsurveyed ground */
  placed: boolean;
  domestic: boolean;
  quality: Plant["linkQuality"];
  linkSource: string;
  address: string | null;
  operations: string;
  health: Plant["health"];
  lastClass: Plant["lastClassification"];
  lon: number;
  signals: WsSignal[];
  evidence: string[];
  /** a seep: the label names no plant for these NDCs */
  unnamed?: boolean;
}

export interface WsEdge {
  plant: string;
  labeler: string;
  use: number;
  /** more than one plant on the label: the split between them is drawn evenly, not known */
  shared: boolean;
}

export interface WsLabeler {
  key: string;
  name: string;
  short: string;
  ndcs: string[];
  use: number;
  hospUse: Partial<Record<Hospital, number>>;
  listed: boolean;
  listing: { status: string; info: string; updated: string; evidence: string } | null;
  plants: string[];
  evidence: string[];
}

export interface WsHospital {
  key: Hospital;
  short: string;
  source: string;
  onHand: number;
  use: number;
  days: number | null;
  unit: string;
  evidence: string[];
}

export type EventKind = Signal["kind"] | "shortage_posted" | "today";

export interface WsEvent {
  t: Day;
  date: string;
  kind: EventKind;
  plant: string | null;
  text: string;
  short: string;
  evidence: string | null;
  /** FDA red (OAI, warning letter), magenta (import alert, posting), amber (VAI) or quiet */
  tone: "red" | "mag" | "amber" | "quiet" | "today";
}

export interface WsTransfer {
  from: Hospital;
  to: Hospital;
  units: number;
  title: string;
  detail: string;
  why: string;
  needs: string;
  evidence: string[];
  after: Partial<Record<Hospital, number>>;
}

export interface WsModel {
  molecule: string;
  title: string;
  asOf: string;
  today: Day;
  unit: string;
  plants: WsPlant[];
  labelers: WsLabeler[];
  hospitals: WsHospital[];
  edges: WsEdge[];
  events: WsEvent[];
  t0: Day;
  replayable: boolean;
  posting: Day | null;
  listedNow: boolean;
  transfer: WsTransfer | null;
  counts: { placed: number; unplaced: number; unnamed: number };
  evidence: Case["evidence"];
}

const KIND_SHORT: Record<string, string> = {
  inspection_oai: "inspected, later classified OAI",
  inspection_vai: "inspected: VAI",
  warning_letter: "warning letter",
  import_alert: "import alert",
  recall: "recall",
  injunction: "injunction",
  seizure: "seizure",
};

function signalShort(s: Signal, p: WsPlant): string {
  const who = shortFirm(p.fullName);
  const m = /case (\d+)/.exec(s.text);
  const ia = /alert ([\d-]+)/i.exec(s.text);
  switch (s.kind) {
    case "inspection_oai": {
      const n = /\((\d+) observations\)/.exec(s.text);
      return `${who} inspection ends${n ? `, ${n[1]} findings` : ""}; OAI letter ${dshort(day(s.knownDate))}.`;
    }
    case "inspection_vai":
      return `${who} inspected: VAI.`;
    case "warning_letter":
      return `Warning letter to ${who}${m ? `, case ${m[1]}` : ""}.`;
    case "import_alert":
      return `Import alert ${ia ? ia[1] + " " : ""}on ${who}.`;
    default:
      return `${KIND_SHORT[s.kind] ?? s.kind}: ${who}.`;
  }
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function buildModel(c: Case): WsModel {
  const today = day(c.asOf);
  const unitCount: Record<string, number> = {};
  c.stock.forEach((s) => (unitCount[s.unit] = (unitCount[s.unit] ?? 0) + 1));
  const unit = Object.entries(unitCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "vial";

  // hospitals that stock it
  const hospitals: WsHospital[] = [];
  for (const h of HOSPITALS) {
    const lines = c.stock.filter((s) => s.hospital === h.key);
    if (!lines.length) continue;
    const onHand = lines.reduce((a, s) => a + s.onHand, 0);
    const use = lines.reduce((a, s) => a + s.dailyUse, 0);
    hospitals.push({
      key: h.key, short: h.short, source: HOSP_SOURCE[h.key], onHand, use,
      days: use > 0 ? onHand / use : null, unit: lines[0].unit, evidence: lines.map((s) => s.evidence),
    });
  }

  // labelers: one per labeler name; each NDC (chain) contributes its stock use
  const labelers = new Map<string, WsLabeler>();
  const labelerOf = (name: string | null): WsLabeler => {
    const key = name ? norm(name) : "_none";
    let l = labelers.get(key);
    if (!l) {
      l = {
        key, name: name ?? "No labeler on record", short: name ? shortFirm(name) : "Unlabelled stock",
        ndcs: [], use: 0, hospUse: {}, listed: false, listing: null, plants: [], evidence: [],
      };
      labelers.set(key, l);
    }
    return l;
  };
  const chainByNdc = new Map(c.chain.map((ch) => [ch.ndc11, ch]));
  const listedNdcs = new Set((c.shortage.listed ? c.shortage.ourNdcsListed : []).map((n) => n.replace(/-/g, "")));
  // NDCs with use, by chain
  const ndcUse = new Map<string, { use: number; hosp: Partial<Record<Hospital, number>>; ev: string[] }>();
  for (const s of c.stock) {
    const ch = chainByNdc.get(s.ndc11) ?? c.chain.find((x) => s.labeler && norm(x.labeler) === norm(s.labeler));
    const k = ch ? ch.ndc11 : `_stock_${norm(s.labeler)}_${s.ndc11}`;
    const u = ndcUse.get(k) ?? { use: 0, hosp: {}, ev: [] };
    u.use += s.dailyUse;
    u.hosp[s.hospital] = (u.hosp[s.hospital] ?? 0) + s.dailyUse;
    u.ev.push(s.evidence);
    ndcUse.set(k, u);
    if (!ch) {
      const l = labelerOf(s.labeler);
      l.use += s.dailyUse;
      l.hospUse[s.hospital] = (l.hospUse[s.hospital] ?? 0) + s.dailyUse;
      l.evidence.push(s.evidence);
      if (s.ndc11 && !l.ndcs.includes(s.ndc11)) l.ndcs.push(s.ndc11);
    }
  }

  const plants = new Map<string, WsPlant>();
  const edges = new Map<string, WsEdge>();
  const addEdge = (plant: string, labeler: string, use: number, shared: boolean) => {
    const k = plant + "|" + labeler;
    const e = edges.get(k);
    if (e) { e.use += use; e.shared = e.shared || shared; } else edges.set(k, { plant, labeler, use, shared });
  };
  for (const ch of c.chain) {
    const l = labelerOf(ch.labeler);
    const u = ndcUse.get(ch.ndc11);
    if (!l.ndcs.includes(ch.packageNdc)) l.ndcs.push(ch.packageNdc);
    if (u) {
      l.use += u.use;
      for (const [h, v] of Object.entries(u.hosp)) l.hospUse[h as Hospital] = (l.hospUse[h as Hospital] ?? 0) + (v ?? 0);
      l.evidence.push(...u.ev);
    }
    if (listedNdcs.has(ch.packageNdc.replace(/-/g, ""))) l.listed = true;
    const use = u?.use ?? 0;
    const named = ch.plants;
    if (!named.length) {
      const key = `_unnamed_${l.key}`;
      if (!plants.has(key)) {
        plants.set(key, {
          key, name: "Not named on the label", fullName: `${l.name}: the label names no plant`, fei: null, country: null,
          countryName: "", placed: false, domestic: false, quality: "sponsor only", linkSource: "none", address: null,
          operations: "", health: "unknown", lastClass: null, lon: 999, signals: [], evidence: [ch.evidence], unnamed: true,
        });
      }
      addEdge(key, l.key, use, false);
      if (!l.plants.includes(key)) l.plants.push(key);
      continue;
    }
    for (const p of named) {
      if (!plants.has(p.key)) {
        const placed = p.linkQuality === "registered plant" && !!p.country;
        const seen = new Set<string>();
        const sig: WsSignal[] = [];
        for (const s of p.signals) {
          const k = s.kind + s.date + s.text.slice(0, 40);
          if (seen.has(k)) continue;
          seen.add(k);
          sig.push({ ...s, t: day(s.date), known: day(s.knownDate || s.date) });
        }
        sig.sort((a, b) => a.t - b.t);
        plants.set(p.key, {
          key: p.key, name: plantName(p.name), fullName: p.name, fei: p.fei, country: p.country,
          countryName: countryName(p.country), placed, domestic: p.country === "USA", quality: p.linkQuality,
          linkSource: p.linkSource, address: p.address, operations: p.operations, health: p.health,
          lastClass: p.lastClassification, lon: p.country ? COUNTRY[p.country]?.lon ?? 0 : 999, signals: sig,
          evidence: p.evidence,
        });
      }
      addEdge(p.key, l.key, use / named.length, named.length > 1);
      if (!l.plants.includes(p.key)) l.plants.push(p.key);
    }
  }
  // stock with no chain at all (no labeler, or an NDC the label set doesn't hold): a seep of its own
  for (const l of labelers.values()) {
    if (!l.plants.length) {
      const key = `_unnamed_${l.key}`;
      plants.set(key, {
        key, name: "Not on any label", fullName: `${l.name}: no label to read`, fei: null, country: null, countryName: "",
        placed: false, domestic: false, quality: "sponsor only", linkSource: "none", address: null, operations: "",
        health: "unknown", lastClass: null, lon: 999, signals: [], evidence: [], unnamed: true,
      });
      l.plants.push(key);
      addEdge(key, l.key, l.use, false);
    }
  }

  // FDA's shortage listing, per labeler, from the company rows
  for (const l of labelers.values()) {
    const first = norm(l.name).slice(0, 5);
    const row = c.shortage.companies.find((r) => first && norm(r.company).startsWith(first));
    if (row && l.listed) l.listing = { status: row.status, info: row.info, updated: row.updated, evidence: row.evidence };
  }

  // events: every FDA action on these plants, plus the posting and today
  const posting = c.shortage.firstPosting ? day(c.shortage.firstPosting) : null;
  const plantList = [...plants.values()];
  const events: WsEvent[] = [];
  for (const p of plantList) {
    for (const s of p.signals) {
      const tone = s.kind === "inspection_vai" ? "amber" : s.kind === "import_alert" ? "mag" : "red";
      events.push({ t: s.t, date: s.date, kind: s.kind, plant: p.key, text: s.text, short: signalShort(s, p), evidence: s.evidence, tone });
    }
  }
  if (posting !== null && c.shortage.firstPosting) {
    const postEv = c.timeline.find((t) => t.kind === "shortage_posted")?.evidence ?? null;
    events.push({
      t: posting, date: c.shortage.firstPosting, kind: "shortage_posted", plant: null,
      text: `FDA posts the ${c.molecule} shortage${c.shortage.listed ? "" : "; it is no longer listed"}`,
      short: c.shortage.listed ? "FDA posts the shortage." : "FDA posts a shortage, since resolved.",
      evidence: postEv, tone: "mag",
    });
  }
  // the replay window opens at the start of the year of the earliest event the investigation put on its timeline
  const tlDays = c.timeline.filter((t) => t.kind !== "today").map((t) => day(t.date));
  const sigDays = events.map((e) => e.t);
  const firstRel = tlDays.length ? Math.min(...tlDays) : sigDays.length ? Math.min(...sigDays) : today;
  const y0 = new Date(Math.min(firstRel, today - 365) * 864e5).getUTCFullYear();
  const t0 = Date.UTC(y0, 0, 1) / 864e5;
  const inWin = events.filter((e) => e.t >= t0 && e.t <= today).sort((a, b) => a.t - b.t || (a.kind === "shortage_posted" ? 1 : -1));
  const listedNow = !!c.shortage.listed && posting !== null;
  const months = posting !== null ? Math.max(0, Math.round((today - posting) / 30.44)) : 0;
  inWin.push({
    t: today, date: c.asOf, kind: "today", plant: null, text: "Today",
    short: listedNow ? `Still listed, ${months < 2 ? Math.round(today - (posting ?? today)) + " days" : months + " months"} on.` : "Today.",
    evidence: null, tone: "today",
  });

  // the best transfer, if the ranking holds one
  let transfer: WsTransfer | null = null;
  const opt = c.options.filter((o) => o.kind === "transfer").sort((a, b) => a.rank - b.rank)[0];
  if (opt) {
    const m = /Transfer\s+([\d.]+)\s+from\s+(Corvale \w+)\s+to\s+(Corvale \w+)/i.exec(opt.title);
    if (m) {
      const from = m[2] as Hospital, to = m[3] as Hospital, units = +m[1];
      const A = hospitals.find((h) => h.key === from), B = hospitals.find((h) => h.key === to);
      if (A && B) {
        transfer = {
          from, to, units, title: opt.title, detail: opt.detail, why: opt.why, needs: opt.needs, evidence: opt.evidence,
          after: {
            [from]: A.use > 0 ? (A.onHand - units) / A.use : A.days ?? 0,
            [to]: B.use > 0 ? (B.onHand + units) / B.use : B.days ?? 0,
          },
        };
      }
    }
  }

  const counts = {
    placed: plantList.filter((p) => p.placed).length,
    unplaced: plantList.filter((p) => !p.placed && !p.unnamed).length,
    unnamed: plantList.filter((p) => p.unnamed).length,
  };
  return {
    molecule: c.molecule, title: tallMan(c.molecule), asOf: c.asOf, today, unit,
    plants: plantList, labelers: [...labelers.values()], hospitals, edges: [...edges.values()],
    events: inWin, t0, replayable: inWin.length > 1, posting, listedNow, transfer, counts, evidence: c.evidence,
  };
}

/** The state of one plant on a given day: what FDA had found, and what it had announced. */
export interface PlantState {
  /** OAI inspection ended, classification not yet issued */
  cloud: boolean;
  cls: "OAI" | "VAI" | "NAI" | null;
  /** days since the OAI letter (silt front), or -1 */
  siltAge: number;
  letters: WsSignal[];
  /** warning letters not yet followed by a classified re-inspection */
  activeLetters: number;
  alerts: WsSignal[];
  other: WsSignal[];
}
export function plantState(p: WsPlant, t: Day): PlantState {
  let cls: PlantState["cls"] = null, siltAge = -1, cloud = false;
  let lastKnown = -1e9;
  for (const s of p.signals) {
    if (s.kind !== "inspection_oai" && s.kind !== "inspection_vai") continue;
    if (s.t <= t && t < s.known && s.kind === "inspection_oai") cloud = true;
    if (s.known <= t && s.known >= lastKnown) {
      lastKnown = s.known;
      cls = s.kind === "inspection_oai" ? "OAI" : "VAI";
      siltAge = cls === "OAI" ? t - s.known : -1;
    }
  }
  if (cls === "OAI") cloud = false;
  const letters = p.signals.filter((s) => s.kind === "warning_letter" && s.t <= t);
  return {
    cloud, cls, siltAge, letters,
    activeLetters: letters.filter((s) => cls === "OAI" || s.t > lastKnown).length,
    alerts: p.signals.filter((s) => s.kind === "import_alert" && s.t <= t),
    other: p.signals.filter((s) => (s.kind === "recall" || s.kind === "injunction" || s.kind === "seizure") && s.t <= t),
  };
}
/** FDA red at the plant on day t: classified OAI, or a warning letter in force. */
export function isRed(st: PlantState): boolean {
  return st.cls === "OAI" || st.activeLetters > 0;
}
