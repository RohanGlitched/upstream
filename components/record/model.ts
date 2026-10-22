// Everything the record desk draws, derived from one case. Pure and serialisable: the server builds it,
// the client lays it out. Nothing here is hand-tuned for one drug.
import type { Case, Hospital, OptionLine, Plant, Signal } from "../../src/agent/types";
import { tallMan } from "../../src/agent/util";
import { drugTitle } from "../lib/drug";
import { countryName, daysBetween, firmCase, monthsBetween, ndc542 } from "../lib/format";
import { dataMatrix, upcFromNdc, type Matrix, type Upc } from "./codes";
import { caseSystems } from "../../src/lib/lineage";

/* ---------- small vocabularies ---------- */

const ANTINEOPLASTIC = new Set(
  (
    "carboplatin cisplatin oxaliplatin methotrexate cyclophosphamide cytarabine azacitidine bleomycin dacarbazine doxorubicin " +
    "etoposide fluorouracil gemcitabine paclitaxel docetaxel vincristine vinblastine vinorelbine irinotecan ifosfamide mitomycin " +
    "fludarabine bendamustine decitabine carmustine busulfan melphalan topotecan epirubicin idarubicin daunorubicin pemetrexed " +
    "bortezomib capecitabine mercaptopurine hydroxyurea thiotepa arsenic cladribine mitoxantrone temozolomide chlorambucil " +
    "dactinomycin streptozocin nelarabine clofarabine pralatrexate romidepsin eribulin cabazitaxel ixabepilone trabectedin"
  ).split(" "),
);

// ASTM D4774 syringe-label colours, used on the shelf label's band for anaesthesia classes.
const CLASS_BAND: Record<string, { label: string; color: string; ink: string }> = {
  opioid: { label: "OPIOID", color: "#4fb8e8", ink: "#0d2a38" },
  induction: { label: "INDUCTION AGENT", color: "#ffe500", ink: "#1b1b00" },
  benzodiazepine: { label: "BENZODIAZEPINE", color: "#f68b1f", ink: "#2a1400" },
  neuromuscular: { label: "PARALYZING AGENT", color: "#ff4f4f", ink: "#2a0505" },
  vasopressor: { label: "VASOPRESSOR", color: "#a58bd6", ink: "#1d1430" },
  local: { label: "LOCAL ANESTHETIC", color: "#a8a39b", ink: "#1d1c1a" },
  anticholinergic: { label: "ANTICHOLINERGIC", color: "#9ccb5a", ink: "#14220a" },
  antiemetic: { label: "ANTIEMETIC", color: "#f3b183", ink: "#2a1608" },
};
const CLASS_OF: Record<string, keyof typeof CLASS_BAND> = {
  propofol: "induction", ketamine: "induction", etomidate: "induction", methohexital: "induction",
  midazolam: "benzodiazepine", lorazepam: "benzodiazepine", diazepam: "benzodiazepine",
  fentanyl: "opioid", morphine: "opioid", hydromorphone: "opioid", sufentanil: "opioid", remifentanil: "opioid", meperidine: "opioid",
  rocuronium: "neuromuscular", vecuronium: "neuromuscular", succinylcholine: "neuromuscular", cisatracurium: "neuromuscular", atracurium: "neuromuscular",
  norepinephrine: "vasopressor", phenylephrine: "vasopressor", ephedrine: "vasopressor", vasopressin: "vasopressor", epinephrine: "vasopressor",
  lidocaine: "local", bupivacaine: "local", ropivacaine: "local", mepivacaine: "local", chloroprocaine: "local",
  atropine: "anticholinergic", glycopyrrolate: "anticholinergic",
  ondansetron: "antiemetic", granisetron: "antiemetic", dexamethasone: "antiemetic", metoclopramide: "antiemetic",
};

const ALERT_TITLE: Record<string, string> = {
  "66-40": "Detention without physical examination of drugs from firms that have not met drug GMPs",
  "66-41": "Detention without physical examination of unapproved new drugs promoted in the U.S.",
  "99-32": "Detention without physical examination of products from firms refusing FDA foreign establishment inspection",
};

const HOSPITALS: Hospital[] = ["Corvale General", "Corvale East", "Corvale Lakeside"];

/* ---------- types ---------- */

export type Band = { kind: "hazard"; label: string } | { kind: "class"; label: string; color: string; ink: string } | null;

export interface ShelfDay {
  hospital: string;
  short: string;
  days: number | null;
  onHand: number;
  dailyUse: number;
  unit: string;
  /** The presentation these days are for, when the hospital stocks more than one ("10 mg/mL, 5 mL"). */
  presentation?: string;
  evidence: string[];
}

export interface PlantCard {
  name: string;
  fei: string | null;
  place: string;
  quality: Plant["linkQuality"];
  health: Plant["health"];
  last: string | null; // "OAI 2022-12-02"
  lastClass: string | null;
  operations: string;
  labeler: string;
  ndc: string;
  evidence: string[];
}

export interface Carton {
  packageNdc: string;
  ndc11: string;
  labeler: string;
  name: string; // tall-man title
  form: string; // "Injection"
  strength: string; // "10 mg/mL, 60 mL"
  container: string; // "Multiple-dose vial"
  listed: boolean;
  setId: string | null;
  upc: Upc | null;
  dm: Matrix;
  gs1: string | null;
  evidence: string;
}

export type HangKind =
  | "oai"
  | "vai"
  | "vai_group"
  | "letter"
  | "posting"
  | "import_alert"
  | "warning_letter"
  | "recall"
  | "action"
  | "today";

export interface Hang {
  id: string;
  kind: HangKind;
  date: string;
  /** Pure data for the card; the component picks what to print by kind. */
  title: string;
  firm: string;
  fei: string | null;
  place: string | null;
  ref: string | null; // inspection id, case id, alert number, recall number
  note: string | null;
  lines: { k: string; v: string }[];
  observations: string[];
  observationCount: number | null;
  history: { date: string; cls: string; now: boolean }[];
  items: { date: string; ref: string; firm: string; evidence: string }[];
  evidence: string[];
  source: string;
  tone: "red" | "amber" | "magenta" | "ink" | "carbon";
  /** On the shortage posting: what FDA's listing gives as the reason for our company, said without claiming cause. */
  reasonLine?: string | null;
}

export interface Dim {
  from: string;
  to: string | null; // null: to today
  label: string;
  short: string;
  tone: "red" | "ink" | "carbon";
  big: boolean;
  evidence: string | null;
}

export interface Segment {
  start: number; // day number
  end: number;
}

export interface BestMove {
  kind: OptionLine["kind"];
  title: string;
  detail: string;
  why: string;
  needs: string;
  evidence: string[];
  transfer: { qty: number; from: string; to: string; fromDays: string | null; toDays: string | null; after: string | null; fromAfter?: string; unit?: string; presentation?: string } | null;
}

export interface DeskModel {
  slug: string;
  molecule: string;
  title: string;
  question: string;
  askedAt: string;
  asOf: string;
  caseShort: string;
  state: "confirmed" | "check" | "no_signal" | null;
  headline: string;
  dek: string;
  verdict: { checked: number; rejected: number; repaired: number; sentences: number; queries: number; seconds: string; hospitals: number; systems: number; hospitalSystems: number };
  /** The explanation's verified sentences, each with the rows it cites: the answer to "why". */
  why: { text: string; cites: string[] }[];
  /** The cited rows, enough to lay a carbon of each under the paragraph. */
  whyRows: Record<string, { label: string; queryId: string; row: number; fields: [string, string][] }>;
  band: Band;
  shelfName: string;
  shelfForm: string;
  shelf: ShelfDay[];
  ndcs: string[];
  dmShelf: Matrix;
  carton: Carton | null;
  primary: PlantCard | null;
  labelPlants: PlantCard[]; // every plant on the primary label (the establishment block)
  others: PlantCard[];
  othersMore: number;
  hangs: Hang[];
  dims: Dim[];
  segments: Segment[];
  posted: string | null;
  today: string;
  listed: boolean;
  months: number | null;
  best: BestMove | null;
  nothing: string | null; // what to say when there is nothing to hang
}

/* ---------- helpers ---------- */

/** "10 mg/mL injection, 60 mL vial" reads on a shelf as "60 mL vial". */
function unitLabel(label: string, short: string): string {
  const tail = label.split(",").pop()?.trim() ?? "";
  return /\d/.test(tail) ? tail : short;
}

/** The reason FDA's shortage listing gives for one company, wherever the recording keeps it. */
function companyReason(co: { info: string; evidence: string } & Record<string, unknown>, ev: Case["evidence"]): string | null {
  const own = co.reasons ?? co.reason;
  if (Array.isArray(own) && own.length) return own.map(String).join("; ");
  if (typeof own === "string" && own) return own;
  const f = ev[co.evidence]?.fields ?? {};
  const r = f.shortage_reason ?? f.reason ?? f.reasons;
  return r ? String(r) : null;
}

export const dayNo = (iso: string) => Math.round(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / 86_400_000);
export const isoOf = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);

function fmtD(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  return n < 10 ? (Math.round(n * 10) / 10).toFixed(1) : String(Math.round(n));
}

function prettyDesc(desc: string): { strength: string; container: string } {
  const d = desc.toUpperCase().replace(/\s+/g, " ");
  const strength =
    /(\d+(?:\.\d+)?)\s*(MG|MCG|G|UNITS?|MEQ|%)\s*(?:\/\s*(\d*(?:\.\d+)?)\s*(ML|L))?/.exec(d) ?? null;
  const vol = /(\d+(?:\.\d+)?)\s*ML\b(?!\s*\/)/.exec(d.replace(strength?.[0] ?? "", ""));
  let s = "";
  if (strength) {
    const unit = strength[2] === "UNITS" || strength[2] === "UNIT" ? " units" : strength[2] === "%" ? "%" : ` ${strength[2].toLowerCase()}`;
    s = `${strength[1]}${unit}`;
    if (strength[4]) s += `/${strength[3] && strength[3] !== "1" ? strength[3] + " " : ""}mL`;
  }
  if (vol && Number(vol[1]) > 0) s += `${s ? ", " : ""}${vol[1]} mL`;
  const container = /\bMDV\b|MULTIPLE[- ]DOSE/.test(d)
    ? "Multiple-dose vial"
    : /\bSDV\b|SINGLE[- ]DOSE/.test(d)
      ? "Single-dose vial"
      : /\bPFS\b|SYRINGE/.test(d)
        ? "Prefilled syringe"
        : /\bAMP/.test(d)
          ? "Ampule"
          : /\bTAB/.test(d)
            ? "Tablets"
            : /\bCAP/.test(d)
              ? "Capsules"
              : /\bBAG\b|PREMIX/.test(d)
                ? "Premixed bag"
                : /VIAL/.test(d)
                  ? "Vial"
                  : "";
  return { strength: s, container };
}

function formWord(dosageForm: string | undefined, desc: string): string {
  const f = (dosageForm ?? "").toUpperCase();
  const d = desc.toUpperCase();
  if (/TABLET/.test(f) || /\bTAB/.test(d)) return "Tablets";
  if (/CAPSULE/.test(f) || /\bCAP/.test(d)) return "Capsules";
  if (/INJECT|SOLUTION|VIAL/.test(f) || /VIAL|SDV|MDV|ML/.test(d)) return "Injection";
  if (/SUSPENSION/.test(f)) return "Suspension";
  if (f) return f.charAt(0) + f.slice(1).toLowerCase().split(",")[0];
  return "";
}

function placeOf(p: Plant): string {
  const addr = p.address ?? "";
  const country = p.country ? countryName(p.country) : null;
  // FDA addresses end "..., City, State COUNTRY"; take the last two comma parts before the country.
  const bits = addr.split(",").map((s) => s.trim()).filter(Boolean);
  const city = bits.length >= 2 ? bits[bits.length - 2] : null;
  if (city && country && !/\d/.test(city)) return `${firmCase(city)}, ${country}`;
  return country ?? "Place not on file";
}

function plantCard(p: Plant, labeler: string, ndc: string): PlantCard {
  return {
    name: firmCase(p.name),
    fei: p.fei,
    place: placeOf(p),
    quality: p.linkQuality,
    health: p.health,
    last: p.lastClassification ? `${p.lastClassification.classification} ${p.lastClassification.endDate}` : null,
    lastClass: p.lastClassification?.classification ?? null,
    operations: p.operations
      .split(/[;,]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .join(", "),
    labeler,
    ndc,
    evidence: p.evidence,
  };
}

const HEALTH_RANK: Record<Plant["health"], number> = { signal: 3, watch: 2, clear: 1, unknown: 0 };
const QUALITY_RANK: Record<Plant["linkQuality"], number> = { "registered plant": 2, "named on label, not placed": 1, "sponsor only": 0 };

function parseObservations(text: string): { list: string[]; count: number | null } {
  const m = /Form 483:\s*(.+?)(?:\s*\((\d+) observations?\))?\s*$/.exec(text);
  if (!m) return { list: [], count: null };
  const list = m[1]
    .split(/;\s*/)
    .map((s) => s.replace(/\s*\(\d+ observations?\)\s*$/, "").trim())
    .filter((s) => s && !/^classification letter/i.test(s));
  return { list, count: m[2] ? Number(m[2]) : list.length || null };
}

function short(name: string): string {
  return name.replace(/,? (Inc\.?|LLC|L\.L\.C\.|Corp\.?|Corporation|Limited|Ltd\.?|Co\.?)$/i, "").replace(/,$/, "");
}

function sentenceCase(s: string): string {
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s.charAt(0).toUpperCase() + s.slice(1);
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ---------- the record's events ---------- */

function signalMap(c: Case): Map<string, Signal> {
  const m = new Map<string, Signal>();
  for (const p of c.chain) for (const pl of p.plants) for (const s of pl.signals) m.set(s.evidence, s);
  return m;
}

function inspectionsByFei(c: Case): Map<string, { date: string; cls: string }[]> {
  const m = new Map<string, { date: string; cls: string }[]>();
  for (const p of c.chain)
    for (const pl of p.plants)
      for (const s of pl.signals) {
        if (!s.fei || (s.kind !== "inspection_oai" && s.kind !== "inspection_vai")) continue;
        const arr = m.get(s.fei) ?? [];
        if (!arr.some((x) => x.date === s.date)) arr.push({ date: s.date, cls: s.kind === "inspection_oai" ? "OAI" : "VAI" });
        m.set(s.fei, arr);
      }
  for (const arr of m.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return m;
}

function blankHang(id: string, kind: HangKind, date: string): Hang {
  return {
    id, kind, date, title: "", firm: "", fei: null, place: null, ref: null, note: null, lines: [], observations: [],
    observationCount: null, history: [], items: [], evidence: [], source: "", tone: "ink",
  };
}

function buildHangs(c: Case): Hang[] {
  const sig = signalMap(c);
  const byFei = inspectionsByFei(c);
  const out: Hang[] = [];
  const derivedLetter = (date: string) =>
    Object.values(c.evidence).find((e) => e.queryId === "derived" && String(e.fields?.letter ?? "") === date)?.id ?? null;

  c.timeline.forEach((t, i) => {
    if (t.kind === "today") return;
    const s = t.evidence ? sig.get(t.evidence) : undefined;
    const ev = t.evidence ? c.evidence[t.evidence] : undefined;
    const f = ev?.fields ?? {};
    const firm = firmCase(String(s?.firm ?? f.legal_name ?? f.firm ?? f.recalling_firm ?? ""));
    const fei = s?.fei ?? (f.fei ? String(f.fei) : null);
    const country = f.country ? sentenceCase(String(f.country)) : null;
    const id = `h${i}`;
    switch (t.kind) {
      case "inspection_oai":
      case "inspection_vai": {
        const oai = t.kind === "inspection_oai";
        const h = blankHang(id, oai ? "oai" : "vai", t.date);
        const text = s?.text ?? t.label;
        const obs = parseObservations(text);
        h.title = "FDA inspection";
        h.ref = String(f.inspection_id ?? /inspection (\d+)/.exec(text)?.[1] ?? "");
        h.firm = firm;
        h.fei = fei;
        h.place = country;
        h.observations = obs.list.slice(0, 3);
        h.observationCount = obs.count;
        const letter = s && s.knownBasis === "fmd145_letter" && s.knownDate !== s.date ? s.knownDate : null;
        h.lines = [
          ...(fei ? [{ k: "FEI", v: fei }] : []),
          ...(country ? [{ k: "Place", v: country }] : []),
          { k: "Ended", v: t.date },
          ...(letter ? [{ k: "Letter", v: letter }] : []),
        ];
        h.history = fei ? (byFei.get(fei) ?? []).map((x) => ({ ...x, now: x.date === t.date })) : [];
        h.evidence = t.evidence ? [t.evidence] : [];
        h.source = "FDA inspection classification database";
        h.tone = oai ? "red" : "amber";
        out.push(h);
        // The OAI letter is the day the finding became known: it hangs on its own date.
        if (oai && letter) {
          const l = blankHang(`${id}-l`, "letter", letter);
          l.title = "FMD-145 classification letter";
          l.firm = firm;
          l.ref = h.ref;
          l.note = `FDA tells the firm its inspection that ended ${t.date} is classified Official Action Indicated.`;
          const d = derivedLetter(letter);
          l.evidence = d ? [d, ...(t.evidence ? [t.evidence] : [])] : t.evidence ? [t.evidence] : [];
          l.source = "known date, from the letter";
          l.tone = "carbon";
          out.push(l);
        }
        break;
      }
      case "warning_letter": {
        const h = blankHang(id, "warning_letter", t.date);
        h.title = "Warning letter";
        h.ref = String(f.case_id ?? /case (\d+)/.exec(t.label)?.[1] ?? "");
        h.firm = firm;
        h.fei = fei;
        h.note = `Issued to ${firm || "the firm"}${fei ? `, FEI ${fei}` : ""}.`;
        h.lines = [
          { k: "Issued", v: t.date },
          { k: "Type", v: String(f.action_type ?? "Warning Letter") },
        ];
        h.evidence = t.evidence ? [t.evidence] : [];
        h.source = "FDA compliance actions";
        h.tone = "red";
        out.push(h);
        break;
      }
      case "injunction":
      case "seizure": {
        const h = blankHang(id, "action", t.date);
        h.title = t.kind === "injunction" ? "Injunction" : "Seizure";
        h.ref = String(f.case_id ?? "");
        h.firm = firm;
        h.fei = fei;
        h.lines = [{ k: "Date", v: t.date }];
        h.evidence = t.evidence ? [t.evidence] : [];
        h.source = "FDA compliance actions";
        h.tone = "red";
        out.push(h);
        break;
      }
      case "import_alert": {
        const h = blankHang(id, "import_alert", t.date);
        const n = String(f.alert ?? /import alert\s+([0-9-]+)/i.exec(t.label)?.[1] ?? "");
        h.title = n ? `Import alert ${n}` : "Import alert";
        h.ref = n || null;
        h.firm = firm;
        h.fei = fei;
        h.place = f.address ? firmCase(String(f.address)).replace(/\s+,/g, ",").slice(0, 90) : country;
        h.note = ALERT_TITLE[n] ?? null;
        const match = String(f.fei_match ?? "");
        h.lines = [
          {
            k: "Match",
            v: fei
              ? `FEI ${fei}${match === "name_and_city" ? ", matched by name and city" : match ? `, matched by ${match.replace(/_/g, " ")}` : ""}`
              : "Matched by firm name. FDA gives no FEI, so Upstream says so.",
          },
        ];
        h.evidence = t.evidence ? [t.evidence] : [];
        h.source = "FDA import alerts";
        h.tone = "magenta";
        out.push(h);
        break;
      }
      case "recall": {
        const h = blankHang(id, "recall", t.date);
        h.title = "Recall";
        h.ref = String(f.recall_number ?? /recall\s+([A-Z]-\d+-\d+)/i.exec(t.label)?.[1] ?? "");
        h.firm = firmCase(String(f.recalling_firm ?? firm));
        h.lines = [
          { k: "Class", v: String(f.classification ?? /Class [I]+/.exec(t.label)?.[0] ?? "") },
          { k: "Started", v: t.date },
          ...(f.status ? [{ k: "Status", v: String(f.status) }] : []),
        ].filter((x) => x.v);
        h.note = f.reason ? String(f.reason).slice(0, 140) : (t.label.split(": ")[1] ?? null);
        h.evidence = t.evidence ? [t.evidence] : [];
        h.source = "FDA enforcement reports";
        h.tone = "amber";
        out.push(h);
        break;
      }
      case "shortage_posted": {
        const h = blankHang(id, "posting", t.date);
        const ours = c.shortage.companies.find((x) => x.evidence === t.evidence) ?? c.shortage.companies[0];
        const pf = ev?.fields ?? {};
        h.title = String(pf.generic_name ?? `${drugTitle(c.molecule)}`);
        h.firm = ours?.company ?? String(pf.company_name ?? "");
        h.ref = String(pf.package_ndc ?? c.shortage.ourNdcsListed[0] ?? "");
        h.lines = [
          { k: "Status", v: c.shortage.status ?? (c.shortage.listed ? "Current" : "Resolved") },
          { k: "First posted", v: t.date },
          ...(h.firm ? [{ k: "Company", v: h.firm.replace(/,? (Inc\.?|LLC|Corp\.?|Corporation|Limited|Ltd\.?)$/i, "") }] : []),
          ...(h.ref ? [{ k: "NDC", v: h.ref }] : []),
          ...(ours?.updated ? [{ k: "Updated", v: ours.updated }] : []),
        ];
        h.items = c.shortage.ourNdcsListed
          .filter((n) => n !== h.ref)
          .slice(0, 3)
          .map((n) => ({ date: "", ref: n, firm: "", evidence: "" }));
        // The reason FDA gives for our listed product's company, never the first of the reasons pooled across
        // every company on the listing (that read "delay in shipping" for a drug whose own labeler gave none).
        {
          const why = ours ? companyReason(ours as typeof ours & Record<string, unknown>, c.evidence) : null;
          h.note = why ? sentenceCase(why) : null;
          h.reasonLine = ours
            ? why
              ? `FDA's listing for ${short(ours.company)} gives: ${why.toLowerCase()}. FDA's file does not say whether the plant findings above are part of it.`
              : `FDA's listing for ${short(ours.company)} gives no reason${ours.info ? `; it notes: ${ours.info.replace(/\s*\/\s*/g, "; ")}` : ""}. Upstream does not supply one.`
            : null;
        }
        h.evidence = t.evidence ? [t.evidence] : [];
        h.source = "FDA drug shortage list";
        h.tone = "red";
        out.push(h);
        break;
      }
    }
  });
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "posting" ? 1 : 0) - (b.kind === "posting" ? 1 : 0));
  // One inspection history per plant is enough: keep it on that plant's latest OAI card.
  const lastOai = new Map<string, string>();
  for (const h of out) if (h.kind === "oai" && h.fei) lastOai.set(h.fei, h.id);
  for (const h of out) if (h.kind === "oai" && h.fei && lastOai.get(h.fei) !== h.id) h.history = [];
  return condense(out);
}

/** At most about twelve documents hang on the thread. Quiet VAI inspections fold into one index card per stretch. */
function condense(hangs: Hang[], max = 12): Hang[] {
  if (hangs.length <= max) return hangs;
  const out: Hang[] = [];
  let run: Hang[] = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length === 1) out.push(run[0]);
    else {
      const g = blankHang(`${run[0].id}-g`, "vai_group", run[0].date);
      g.title = `${run.length} VAI inspections`;
      g.items = run.map((r) => ({ date: r.date, ref: r.ref ?? "", firm: r.firm, evidence: r.evidence[0] ?? "" }));
      g.evidence = run.flatMap((r) => r.evidence).slice(0, 6);
      g.note = `${run[0].date.slice(0, 4)}${run[run.length - 1].date.slice(0, 4) !== run[0].date.slice(0, 4) ? ` to ${run[run.length - 1].date.slice(0, 4)}` : ""}: voluntary action indicated, no regulatory action.`;
      g.source = "FDA inspection classification database";
      g.tone = "amber";
      out.push(g);
    }
    run = [];
  };
  for (const h of hangs) {
    if (h.kind === "vai") run.push(h);
    else {
      flush();
      out.push(h);
    }
  }
  flush();
  if (out.length <= max + 1) return out;
  // Still crowded: keep the strongest documents and fold the oldest remaining OAIs.
  const keep = out.filter((h) => h.kind !== "oai" && h.kind !== "letter");
  const oai = out.filter((h) => h.kind === "oai" || h.kind === "letter");
  const room = Math.max(2, max - keep.length);
  const kept = oai.slice(-room);
  const folded = oai.slice(0, oai.length - kept.length).filter((h) => h.kind === "oai");
  const res = [...keep, ...kept];
  if (folded.length) {
    const g = blankHang(`${folded[0].id}-og`, "vai_group", folded[0].date);
    g.title = `${folded.length} earlier OAI inspections`;
    g.items = folded.map((r) => ({ date: r.date, ref: r.ref ?? "", firm: r.firm, evidence: r.evidence[0] ?? "" }));
    g.evidence = folded.flatMap((r) => r.evidence).slice(0, 6);
    g.note = "Official action indicated. The latest ones hang on their own.";
    g.source = "FDA inspection classification database";
    g.tone = "red";
    res.push(g);
  }
  return res.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- scale: true to scale inside each stretch, with honest breaks ---------- */

function buildSegments(dates: string[], today: string): Segment[] {
  const pts = [...new Set(dates.map(dayNo))].sort((a, b) => a - b);
  const t = dayNo(today);
  if (!pts.length) return [{ start: t - 365, end: t + 20 }];
  const GAP = 600;
  const segs: Segment[] = [];
  let s = pts[0];
  let e = pts[0];
  for (const p of pts.slice(1)) {
    if (p - e > GAP) {
      segs.push({ start: s, end: e });
      s = p;
    }
    e = p;
  }
  segs.push({ start: s, end: e });
  // Today joins the last stretch when it is close, else it gets its own short stretch.
  const last = segs[segs.length - 1];
  if (t - last.end <= GAP) last.end = t;
  else segs.push({ start: t, end: t });
  // Pad each stretch so its first and last marks have room; start on a month boundary.
  return segs.map((g) => {
    const startIso = isoOf(g.start - 18);
    const m0 = dayNo(startIso.slice(0, 8) + "01");
    return { start: m0, end: g.end + (g.end === t ? 24 : 26) };
  });
}

/* ---------- the best move ---------- */

function bestMove(c: Case): BestMove | null {
  const seen = new Set<string>();
  const o = [...c.options].sort((a, b) => a.rank - b.rank).find((x) => !seen.has(x.title) && seen.add(x.title));
  if (!o) return null;
  let transfer: BestMove["transfer"] = null;
  const m = /^Transfer (\d+(?:\.\d+)?) from (.+?) to (.+)$/.exec(o.title);
  if (o.kind === "transfer" && o.transfer) {
    const t = o.transfer;
    transfer = { qty: t.qty, from: t.from, to: t.to, fromDays: t.fromDays.toFixed(1), toDays: t.toDays.toFixed(1), after: t.toAfter.toFixed(1), fromAfter: t.fromAfter.toFixed(1), unit: t.unit, presentation: t.presentation };
  } else if (o.kind === "transfer" && m) {
    const from = m[2];
    const to = m[3];
    const fd = new RegExp(`${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} has ([\\d.]+) days`).exec(o.detail)?.[1] ?? null;
    const td = new RegExp(`${to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} has ([\\d.]+) days`).exec(o.detail)?.[1] ?? null;
    const after = /would reach (\d+(?:\.\d+)?)/.exec(o.detail)?.[1] ?? null;
    transfer = { qty: Number(m[1]), from, to, fromDays: fd, toDays: td, after };
  }
  return { kind: o.kind, title: tallMan(o.title), detail: tallMan(o.detail), why: o.why, needs: o.needs, evidence: o.evidence, transfer };
}

function shelfFormOf(pd: { strength: string; container: string }, form: string): string {
  const solid = /tablet|capsule/i.test(pd.container) || /tablet|capsule/i.test(form);
  const f = solid ? (pd.container || form).toLowerCase() : form.toLowerCase();
  const head = [pd.strength, f].filter(Boolean).join(" ");
  return !solid && pd.container ? `${head}, ${pd.container.toLowerCase()}` : head;
}

/* ---------- the model ---------- */

export function buildDesk(c: Case, slug: string): DeskModel {
  const title = drugTitle(c.molecule);
  const words = c.molecule.toLowerCase().split(/[^a-z]+/);
  const band: Band = words.some((w) => ANTINEOPLASTIC.has(w))
    ? { kind: "hazard", label: "HAZARDOUS DRUG" }
    : (() => {
        const k = words.map((w) => CLASS_OF[w]).find(Boolean);
        return k ? { kind: "class" as const, ...CLASS_BAND[k] } : null;
      })();

  // Shelf: days on hand per hospital. With presentations on record, each hospital shows its shortest
  // presentation (a 5 mL vial at 1.4 days is not hidden inside 18 days of 60 mL vials); older recordings pool.
  const shelf: ShelfDay[] = [];
  for (const h of HOSPITALS) {
    const lines = c.stock.filter((s) => s.hospital === h);
    if (!lines.length) continue;
    const pres = (c.presentations ?? [])
      .map((p) => ({ p, at: p.hospitals.find((x) => x.hospital === h) }))
      .filter((x): x is { p: (typeof x)["p"]; at: NonNullable<(typeof x)["at"]> } => Boolean(x.at))
      .sort((a, b) => (a.at.days ?? Infinity) - (b.at.days ?? Infinity))[0];
    if (pres) {
      const derived = Object.values(c.evidence).filter((e) => e.queryId === "derived" && e.fields?.hospital === h).map((e) => e.id);
      const kinds = new Set((c.presentations ?? []).filter((p) => p.hospitals.some((x) => x.hospital === h)).map((p) => p.key)).size;
      shelf.push({
        hospital: h,
        short: h.replace(/^Corvale\s+/, ""),
        days: pres.at.days,
        onHand: pres.at.onHand,
        dailyUse: pres.at.dailyUse,
        unit: pres.p.unit,
        presentation: kinds > 1 ? unitLabel(pres.p.label, pres.p.short) : undefined,
        evidence: [...pres.at.evidence, ...derived].slice(0, 4),
      });
      continue;
    }
    const onHand = lines.reduce((a, s) => a + (s.onHand || 0), 0);
    const dailyUse = lines.reduce((a, s) => a + (s.dailyUse || 0), 0);
    const derived = Object.values(c.evidence).filter((e) => e.queryId === "derived" && e.fields?.hospital === h).map((e) => e.id);
    shelf.push({
      hospital: h,
      short: h.replace(/^Corvale\s+/, ""),
      days: dailyUse > 0 ? onHand / dailyUse : null,
      onHand,
      dailyUse,
      unit: lines[0].unit,
      evidence: [...derived, ...lines.map((l) => l.evidence)].slice(0, 4),
    });
  }
  // NDCs as FDA's files record them (dashed package NDC); the 11-digit form only where nothing else is on file
  const pkgOf = new Map(c.chain.map((p) => [p.ndc11, p.packageNdc]));
  const ndcs = [...new Set(c.stock.map((s) => s.ndc11))].map((n) => pkgOf.get(n) ?? ndc542(n));

  // The primary chain: the listed NDC with the plant FDA has most to say about.
  const listed = new Set(c.shortage.ourNdcsListed);
  const scored = c.chain.map((p) => {
    const best = [...p.plants].sort(
      (a, b) => QUALITY_RANK[b.linkQuality] - QUALITY_RANK[a.linkQuality] || HEALTH_RANK[b.health] - HEALTH_RANK[a.health] || b.signals.length - a.signals.length,
    )[0];
    const score =
      (listed.has(p.packageNdc) ? 100 : 0) +
      (best ? QUALITY_RANK[best.linkQuality] * 20 + HEALTH_RANK[best.health] * 10 + Math.min(9, best.signals.length) : -50) +
      (c.stock.some((s) => s.ndc11 === p.ndc11) ? 5 : 0);
    return { p, best, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const info = (d: string) => {
    const x = prettyDesc(d);
    return (x.strength ? 2 : 0) + (x.container ? 1 : 0) + x.strength.length / 100;
  };
  const stockLine = [...c.stock.filter((s) => !top || s.ndc11 === top.p.ndc11)].sort((a, b) => info(b.description) - info(a.description))[0] ?? c.stock[0];
  const marketLine = top ? c.market.find((m) => m.ndc11 === top.p.ndc11) : undefined;
  const desc = stockLine?.description ?? "";
  const pd = prettyDesc(desc);
  const primaryNdc11 = top?.p.ndc11 ?? c.stock[0]?.ndc11 ?? "";

  let carton: Carton | null = null;
  if (top) {
    const upc = upcFromNdc(top.p.packageNdc) ?? upcFromNdc(top.p.ndc11);
    carton = {
      packageNdc: top.p.packageNdc,
      ndc11: top.p.ndc11,
      labeler: top.p.labeler,
      name: title,
      form: formWord(marketLine?.dosageForm, desc) || "Injection",
      strength: pd.strength,
      container: pd.container,
      listed: listed.has(top.p.packageNdc),
      setId: top.p.setId,
      upc,
      dm: dataMatrix(upc ? "01" + upc.gtin : primaryNdc11, { fnc1: Boolean(upc), minSize: 16 }),
      gs1: upc ? `(01) ${upc.gtin}` : null,
      evidence: top.p.evidence,
    };
  }

  const labelPlants = top ? top.p.plants.map((p) => plantCard(p, top.p.labeler, top.p.packageNdc)) : [];
  labelPlants.sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality] || HEALTH_RANK[b.health] - HEALTH_RANK[a.health]);
  const primary = labelPlants[0] ?? null;

  const others: PlantCard[] = [];
  const seenPlant = new Set(labelPlants.map((p) => p.fei ?? p.name));
  for (const s of scored.slice(1)) {
    for (const p of s.p.plants) {
      const k = p.fei ?? p.name;
      if (seenPlant.has(k)) continue;
      seenPlant.add(k);
      others.push(plantCard(p, s.p.labeler, s.p.packageNdc));
    }
    if (!s.p.plants.length) {
      const k = `none:${s.p.labeler}`;
      if (!seenPlant.has(k)) {
        seenPlant.add(k);
        others.push({
          name: "", fei: null, place: "", quality: "sponsor only", health: "unknown", last: null, lastClass: null,
          operations: "", labeler: s.p.labeler, ndc: s.p.packageNdc, evidence: [s.p.evidence],
        });
      }
    }
  }
  others.sort((a, b) => HEALTH_RANK[b.health] - HEALTH_RANK[a.health] || QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality]);
  const SHOW = 3;

  const hangs = buildHangs(c);
  const today = c.timeline.find((t) => t.kind === "today")?.date ?? c.asOf;
  const posted = c.shortage.firstPosting;
  const stillListed = c.shortage.listed && c.shortage.status !== "Resolved";
  const stated = c.timeline.find((t) => t.kind === "today")?.label.match(/\((\d+) months?\)/)?.[1];
  const months = stated ? Number(stated) : posted && stillListed ? monthsBetween(posted, today) : null;

  // The "today" card: still listed, or not on the list.
  const td = blankHang("today", "today", today);
  const ourCo = c.shortage.companies.find((x) => x.status === "Current") ?? c.shortage.companies[0];
  if (stillListed && months !== null) {
    td.title = "STILL LISTED";
    td.ref = `${months} mo`;
    td.note = ourCo
      ? `${ourCo.company.replace(/,? (Inc\.?|LLC|Corp\.?|Corporation|Limited)$/i, "")}'s entry updated ${ourCo.updated}.${ourCo.info ? ` ${ourCo.info.split(/[/;]/)[0].trim()}.` : ""}`
      : "On FDA's shortage list today.";
    td.evidence = ourCo?.evidence ? [ourCo.evidence] : [];
    td.tone = "carbon";
  } else {
    td.title = posted ? "RESOLVED" : "NOT LISTED";
    td.ref = null;
    td.note = posted ? `FDA marks this shortage ${c.shortage.status?.toLowerCase() ?? "resolved"}.` : "Not on FDA's shortage list today.";
    td.tone = "ink";
  }
  const hangsAll = [...hangs, td];

  const dims: Dim[] = [];
  if (posted) {
    const pre = hangs.filter((h) => (h.kind === "letter" || h.kind === "warning_letter" || h.kind === "import_alert" || h.kind === "action") && h.date < posted && daysBetween(h.date, posted) <= 730);
    const preOai = hangs.filter((h) => h.kind === "oai" && h.date < posted && daysBetween(h.date, posted) <= 730);
    const known = pre.sort((a, b) => b.date.localeCompare(a.date))[0];
    const firstOai = preOai.sort((a, b) => b.date.localeCompare(a.date))[0];
    if (stillListed && months !== null && months > 0)
      dims.push({ from: posted, to: null, label: `${months} months on the list, and counting`, short: `${months} months`, tone: "carbon", big: false, evidence: null });
    if (firstOai) {
      const d = daysBetween(firstOai.date, posted);
      dims.push({ from: firstOai.date, to: posted, label: `${d} days from the inspection's end`, short: `${d} days`, tone: "ink", big: false, evidence: firstOai.evidence[0] ?? null });
    }
    if (known) {
      const d = daysBetween(known.date, posted);
      const what = known.kind === "letter" ? "the OAI letter" : known.kind === "warning_letter" ? "the warning letter" : known.kind === "import_alert" ? "the import alert" : "FDA's action";
      dims.push({ from: known.date, to: posted, label: `${d} days`, short: `from ${what} to the shortage posting`, tone: "red", big: true, evidence: known.evidence[0] ?? null });
    }
  }

  const segments = buildSegments([...hangs.map((h) => h.date), ...(posted ? [posted] : [])], today);

  const plantsAll = c.chain.flatMap((p) => p.plants);
  const placed = plantsAll.filter((p) => p.linkQuality === "registered plant").length;
  const hospitals = shelf.length;
  const v = c.explanation?.verifier;
  const state = c.explanation?.state ?? null;
  const shelfWord = hospitals === 1 ? "shelf" : "shelves";
  const plantPhrase =
    plantsAll.length === 0
      ? "the labels behind it, which name no plant"
      : plantsAll.length === 1
        ? "the plant its label names"
        : `the ${plantsAll.length} plants its labels name`;
  const dek =
    `Upstream followed the ${c.molecule.toLowerCase()} on our ${shelfWord} upstream to ${plantPhrase}, then read every inspection, warning letter and import alert FDA holds for ${placed === 1 ? "that plant" : placed ? `the ${placed} it could place` : "them"}. ` +
    (hangs.length ? "The red thread below is FDA's record, laid out to scale." : "FDA's record has nothing to hang on the thread, and the desk says so.");

  let nothing: string | null = null;
  if (!hangs.length) {
    nothing = plantsAll.length === 0
      ? "None of our labels names a plant, so there is no FDA file to join. Upstream does not guess the factory."
      : placed === 0
        ? "No plant on our labels could be placed in FDA's registration file, so none of FDA's records can be joined to them."
        : "FDA holds no inspection, warning letter, import alert or recall for the plants on our labels in the years this record covers.";
  }

  const why = (c.explanation?.sentences ?? []).map((x) => ({ text: tallMan(x.text), cites: x.cites }));
  const whyRows: DeskModel["whyRows"] = {};
  for (const id of new Set(why.flatMap((x) => x.cites))) {
    const e = c.evidence[id];
    if (!e) continue;
    whyRows[id] = {
      label: e.label,
      queryId: e.queryId,
      row: e.row,
      fields: Object.entries(e.fields ?? {})
        .filter(([, v]) => v !== null && v !== "")
        .slice(0, 9)
        .map(([k, v]) => [k.replace(/_/g, " "), String(v)]),
    };
  }

  return {
    slug,
    molecule: c.molecule,
    title,
    question: c.question,
    askedAt: c.askedAt,
    asOf: c.asOf,
    caseShort: c.id.slice(-6),
    state,
    headline: c.explanation?.headline ? tallMan(c.explanation.headline).replace(/\.?$/, ".") : `${title}: Upstream found no explanation it could verify.`,
    dek,
    verdict: {
      checked: v?.checked ?? 0,
      rejected: v?.rejected.length ?? 0,
      repaired: v?.repaired ?? 0,
      sentences: c.explanation?.sentences.length ?? 0,
      queries: c.usage.zetarisQueries,
      seconds: (c.usage.zetarisMs / 1000).toFixed(1),
      hospitals,
      // Physical systems the statements read, from the SQL text (USL tables resolved to their sources).
      systems: caseSystems(c).length,
      hospitalSystems: caseSystems(c).filter((x) => x.kind === "hospital").length,
    },
    band,
    shelfName: title,
    shelfForm: shelfFormOf(pd, formWord(marketLine?.dosageForm, desc)),
    shelf,
    ndcs,
    dmShelf: dataMatrix(primaryNdc11 || "0", { minSize: 14 }),
    carton,
    primary,
    labelPlants,
    others: others.slice(0, SHOW),
    othersMore: Math.max(0, others.length - SHOW),
    hangs: hangsAll,
    dims,
    segments,
    posted,
    today,
    listed: c.shortage.listed,
    months,
    best: bestMove(c),
    nothing,
    why,
    whyRows,
  };
}

/** Days to the nearest tenth below ten, whole above. */
export { fmtD as fmtDaysShort };
