// The shelf-to-factory chain and the lead-time ruler, derived from one case.
import type { Case, Hospital, Plant, Signal, StockLine } from "../../src/agent/types";
import { daysBetween, fmtDate, monthsBetween } from "./format";

export type Tone = "signal" | "caution" | "clear" | "unknown";

export interface ShelfNode {
  hospital: Hospital;
  short: string;
  days: number | null;
  onHand: number;
  dailyUse: number;
  unit: string;
  ndcs: string[];
  lines: StockLine[];
  evidence: string[];
}

export interface ActionTag {
  kind: Signal["kind"];
  label: string;
  date: string;
  detail: string;
  tone: Tone;
  evidence: string;
}

export interface RowPlant {
  plant: Plant;
  actions: ActionTag[];
  quiet: string | null; // a summary of the weaker history not shown as tags
  hidden: number;
}

export interface TraceRow {
  key: string;
  ndc11: string;
  packageNdc: string;
  labeler: string;
  hospitals: Hospital[];
  plants: RowPlant[];
  evidence: string;
  listed: boolean;
}

export interface TraceModel {
  molecule: string;
  asOf: string;
  shelf: ShelfNode[];
  rows: TraceRow[];
  posted: string | null;
}

const HOSPITALS: Hospital[] = ["Corvale General", "Corvale East", "Corvale Lakeside"];

export function shortHospital(h: string): string {
  return h.replace(/^Corvale\s+/, "");
}

export function toneOfKind(kind: string): Tone {
  switch (kind) {
    case "inspection_oai":
    case "oai_letter":
    case "warning_letter":
    case "import_alert":
    case "injunction":
    case "seizure":
      return "signal";
    case "inspection_vai":
    case "recall":
      return "caution";
    default:
      return "unknown";
  }
}

export function toneOfHealth(h: Plant["health"]): Tone {
  return h === "signal" ? "signal" : h === "watch" ? "caution" : h === "clear" ? "clear" : "unknown";
}

export const HEALTH_WORD: Record<Plant["health"], string> = {
  signal: "FDA action in the last 3 years",
  watch: "Last inspection OAI, or VAI in 2 years",
  clear: "No FDA action in the last 3 years",
  unknown: "Can't be checked",
};

function alertNumber(text: string): string | null {
  return /import alert\s+([0-9]{2}-[0-9]{2,3})/i.exec(text)?.[1] ?? null;
}

export function actionLabel(s: Pick<Signal, "kind" | "text">): string {
  switch (s.kind) {
    case "inspection_oai":
      return "OAI inspection";
    case "inspection_vai":
      return "VAI inspection";
    case "warning_letter":
      return "Warning letter";
    case "import_alert": {
      const n = alertNumber(s.text);
      return n ? `Import alert ${n}` : "Import alert";
    }
    case "recall":
      return "Recall";
    case "injunction":
      return "Injunction";
    case "seizure":
      return "Seizure";
  }
}

function actionDetail(s: Signal): string {
  if (s.kind === "inspection_oai" || s.kind === "inspection_vai") {
    const letter = s.knownBasis === "fmd145_letter" && s.knownDate !== s.date ? `, letter ${fmtDate(s.knownDate)}` : "";
    return `ended ${fmtDate(s.date)}${letter}`;
  }
  if (s.kind === "import_alert") return `listed ${fmtDate(s.date)}${s.fei ? "" : ", matched by firm name"}`;
  return fmtDate(s.date);
}

function plantActions(p: Plant): RowPlant {
  const sorted = [...p.signals].sort((a, b) => b.date.localeCompare(a.date));
  const strong = sorted.filter((s) => toneOfKind(s.kind) === "signal");
  const weak = sorted.filter((s) => toneOfKind(s.kind) !== "signal");
  const shown: Signal[] = [...strong];
  // With no strong action on file, the latest weaker one still says something.
  if (!strong.length && weak.length) shown.push(weak[0]);
  const rest = weak.filter((s) => !shown.includes(s));
  const MAX = 4;
  const visible = shown.slice(0, MAX).sort((a, b) => a.date.localeCompare(b.date));
  const hidden = Math.max(0, shown.length - MAX);
  let quiet: string | null = null;
  if (rest.length) {
    const years = rest.map((s) => s.date.slice(0, 4)).sort();
    const vai = rest.filter((s) => s.kind === "inspection_vai").length;
    const noun = vai === rest.length ? (vai === 1 ? "VAI inspection" : "VAI inspections") : rest.length === 1 ? "other action" : "other actions";
    const span = years[0] === years[years.length - 1] ? `in ${years[0]}` : `from ${years[0]} to ${years[years.length - 1]}`;
    quiet = `${rest.length} ${noun} ${span}`;
  }
  return {
    plant: p,
    actions: visible.map((s) => ({
      kind: s.kind,
      label: actionLabel(s),
      date: s.date,
      detail: actionDetail(s),
      tone: toneOfKind(s.kind),
      evidence: s.evidence,
    })),
    quiet,
    hidden,
  };
}

function derivedFor(c: Case, hospital: string): string[] {
  return Object.values(c.evidence)
    .filter((e) => e.queryId === "derived" && e.fields && e.fields.hospital === hospital)
    .map((e) => e.id);
}

export function buildTrace(c: Case): TraceModel {
  const shelf: ShelfNode[] = [];
  for (const h of HOSPITALS) {
    const lines = c.stock.filter((s) => s.hospital === h);
    if (!lines.length) continue;
    const onHand = lines.reduce((a, s) => a + (s.onHand || 0), 0);
    const dailyUse = lines.reduce((a, s) => a + (s.dailyUse || 0), 0);
    shelf.push({
      hospital: h,
      short: shortHospital(h),
      days: dailyUse > 0 ? onHand / dailyUse : null,
      onHand,
      dailyUse,
      unit: lines[0].unit,
      ndcs: [...new Set(lines.map((l) => l.ndc11))],
      lines,
      evidence: [...derivedFor(c, h), ...lines.map((l) => l.evidence)],
    });
  }

  const listed = new Set(c.shortage.ourNdcsListed);
  const rows: TraceRow[] = c.chain.map((p, i) => ({
    key: `${p.ndc11}-${i}`,
    ndc11: p.ndc11,
    packageNdc: p.packageNdc,
    labeler: p.labeler,
    hospitals: HOSPITALS.filter((h) => c.stock.some((s) => s.hospital === h && s.ndc11 === p.ndc11)),
    plants: p.plants.map(plantActions),
    evidence: p.evidence,
    listed: listed.has(p.packageNdc),
  }));
  // Stock whose NDC the label search did not reach still belongs on the chain, with an honest gap.
  for (const s of c.stock) {
    if (rows.some((r) => r.ndc11 === s.ndc11)) continue;
    rows.push({
      key: `${s.ndc11}-stock`,
      ndc11: s.ndc11,
      packageNdc: s.ndc11,
      labeler: s.labeler ?? "Labeler not found",
      hospitals: HOSPITALS.filter((h) => c.stock.some((x) => x.hospital === h && x.ndc11 === s.ndc11)),
      plants: [],
      evidence: s.evidence,
      listed: false,
    });
  }
  return { molecule: c.molecule, asOf: c.asOf, shelf, rows, posted: c.shortage.firstPosting };
}

// ---------- The lead-time ruler ----------

export interface RulerEvent {
  key: string;
  date: string;
  kind: string;
  label: string;
  detail: string;
  tone: Tone | "anchor" | "today";
  evidence: string | null;
  before: number | null; // days before the posting (negative after)
}

export interface Lead {
  from: string;
  to: string;
  days: number;
  label: string;
  evidence: string | null;
}

export interface RulerModel {
  events: RulerEvent[];
  posted: string | null;
  today: string;
  stillListed: boolean;
  months: number | null;
  lead: Lead | null;
  inspectionLead: Lead | null;
}

export function lowerFirst(s: string): string {
  return /^[A-Z][A-Z]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

function signalByEvidence(c: Case): Map<string, Signal> {
  const m = new Map<string, Signal>();
  for (const p of c.chain) for (const pl of p.plants) for (const s of pl.signals) m.set(s.evidence, s);
  return m;
}

function shortLabel(kind: string, text: string): string {
  if (kind === "shortage_posted") return "FDA posts the shortage";
  if (kind === "today") return "Today";
  return actionLabel({ kind: kind as Signal["kind"], text });
}

export function buildRuler(c: Case): RulerModel {
  const posted = c.shortage.firstPosting;
  const bySig = signalByEvidence(c);
  const events: RulerEvent[] = [];
  let today = c.asOf;
  for (const [i, t] of c.timeline.entries()) {
    if (t.kind === "today") {
      today = t.date;
      continue;
    }
    const sig = t.evidence ? bySig.get(t.evidence) : undefined;
    const firm = sig?.firm ? sig.firm : "";
    const isInspection = t.kind === "inspection_oai" || t.kind === "inspection_vai";
    events.push({
      key: `t${i}`,
      date: t.date,
      kind: t.kind,
      label: isInspection ? `${t.kind === "inspection_oai" ? "OAI" : "VAI"} inspection ends` : shortLabel(t.kind, t.label),
      detail: t.kind === "shortage_posted" ? t.label : firm ? `${t.label.replace(/;\s*classification letter.*$/, "")}. ${firm}.` : t.label,
      tone: t.kind === "shortage_posted" ? "anchor" : toneOfKind(t.kind),
      evidence: t.evidence,
      before: posted ? daysBetween(t.date, posted) : null,
    });
    // An OAI classification letter is the day the finding became known: it gets its own mark.
    if (t.kind === "inspection_oai" && sig && sig.knownBasis === "fmd145_letter" && sig.knownDate !== sig.date) {
      const derived = Object.values(c.evidence).find((e) => e.queryId === "derived" && e.fields?.letter === sig.knownDate);
      events.push({
        key: `t${i}-letter`,
        date: sig.knownDate,
        kind: "oai_letter",
        label: "OAI letter",
        detail: `FDA's letter classifying inspection ${/inspection (\d+)/.exec(sig.text)?.[1] ?? ""} as OAI. ${sig.firm}.`,
        tone: "signal",
        evidence: derived?.id ?? sig.evidence,
        before: posted ? daysBetween(sig.knownDate, posted) : null,
      });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "shortage_posted" ? 1 : 0) - (b.kind === "shortage_posted" ? 1 : 0));

  const stillListed = c.shortage.listed && c.shortage.status !== "Resolved";
  // The case states its own month count ("Still on FDA's list (42 months)"); use it so every page agrees.
  const stated = c.timeline.find((t) => t.kind === "today")?.label.match(/\((\d+) months?\)/)?.[1];
  const months = stated ? Number(stated) : posted ? monthsBetween(posted, today) : null;

  let lead: Lead | null = null;
  let inspectionLead: Lead | null = null;
  if (posted) {
    const known = events.filter(
      (e) => e.tone === "signal" && e.kind !== "inspection_oai" && e.before !== null && e.before > 0 && e.before <= 730,
    );
    if (known.length) {
      const first = known.reduce((a, b) => (a.before! >= b.before! ? a : b));
      lead = {
        from: first.date,
        to: posted,
        days: first.before!,
        label: `${first.before} days from the ${lowerFirst(first.label)} to the posting`,
        evidence: first.evidence,
      };
    }
    const insp = events.filter((e) => e.kind === "inspection_oai" && e.before !== null && e.before > 0 && e.before <= 730);
    if (insp.length) {
      const first = insp.reduce((a, b) => (a.before! >= b.before! ? a : b));
      if (!lead || first.before !== lead.days) {
        inspectionLead = {
          from: first.date,
          to: posted,
          days: first.before!,
          label: `${first.before} days from the end of the inspection`,
          evidence: first.evidence,
        };
      }
    }
  }
  return { events, posted, today, stillListed, months, lead, inspectionLead };
}
