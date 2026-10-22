// The "why" in a brief. Rules decide the state; Nemotron writes the sentences from numbered evidence lines;
// a verifier drops any sentence whose citations, dates or numbers are not in the evidence it cites.
import { chat, parseJson, MODELS } from "../lib/nemotron";
import type { Case, Evidence, Explanation, Sentence } from "./types";
import { daysBetween, round, tallMan } from "./util";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Derived facts (counts, day gaps) get their own evidence ids, so every number a sentence uses is citable. */
function derive(c: Case): Evidence[] {
  const out: Evidence[] = [];
  let n = 0;
  const add = (label: string, fields: Record<string, string | number | null>) => {
    const e: Evidence = { id: `D${++n}`, queryId: "derived", row: -1, label, fields };
    out.push(e);
    c.evidence[e.id] = e;
  };
  const byH = new Map<string, { onHand: number; daily: number }>();
  for (const s of c.stock) {
    const h = byH.get(s.hospital) ?? { onHand: 0, daily: 0 };
    h.onHand += s.onHand;
    h.daily += s.dailyUse;
    byH.set(s.hospital, h);
  }
  for (const [h, v] of byH) {
    const days = v.daily > 0 ? round(v.onHand / v.daily, 0) : null;
    add(`${h} holds ${round(v.onHand, 0)} units of ${c.molecule} at ${round(v.daily, 1)} a day: ${days ?? "no recent use, so no"} days on hand`, { hospital: h, on_hand: round(v.onHand, 0), daily_use: round(v.daily, 1), days_on_hand: days });
  }
  if (c.shortage.firstPosting) {
    for (const t of c.timeline) {
      if (t.kind === "today" || t.kind === "shortage_posted" || t.daysBeforePosting === null) continue;
      const rel = t.daysBeforePosting >= 0 ? `${t.daysBeforePosting} days before` : `${-t.daysBeforePosting} days after`;
      add(`${t.label} — ${rel} FDA posted the shortage on ${c.shortage.firstPosting}`, { date: t.date, posted: c.shortage.firstPosting, days: Math.abs(t.daysBeforePosting) });
    }
    for (const pc of c.chain) for (const p of pc.plants) for (const s of p.signals) {
      if (s.kind !== "inspection_oai" || s.knownBasis !== "fmd145_letter" || !s.knownDate) continue;
      const gap = daysBetween(s.knownDate, c.shortage.firstPosting);
      add(`FDA's OAI classification letter to ${p.name} is dated ${s.knownDate}, ${Math.abs(gap)} days ${gap >= 0 ? "before" : "after"} FDA posted the shortage on ${c.shortage.firstPosting}`, { letter: s.knownDate, posted: c.shortage.firstPosting, days: Math.abs(gap) });
    }
    const months = Math.round(daysBetween(c.shortage.firstPosting, c.asOf) / 30.4);
    add(`As of ${c.asOf} the shortage has been on FDA's list for ${months} months`, { as_of: c.asOf, posted: c.shortage.firstPosting, months });
  }
  return out;
}

function line(e: Evidence): string {
  const f = Object.entries(e.fields)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => `${k}=${String(v).slice(0, 140)}`)
    .join("; ");
  return `[${e.id}] ${e.label}${f ? ` (${f})` : ""}`;
}

/** Evidence lines the writer may use: the chain, signals, shortage, options, data quality. Not every stock row. */
function pack(c: Case, derived: Evidence[]): Evidence[] {
  const ids = new Set<string>();
  for (const pc of c.chain) for (const p of pc.plants) {
    p.evidence.forEach((id) => ids.add(id));
    p.signals.forEach((s) => ids.add(s.evidence));
  }
  for (const t of c.timeline) if (t.evidence) ids.add(t.evidence);
  for (const co of c.shortage.companies.slice(0, 12)) ids.add(co.evidence);
  for (const o of c.options.slice(0, 4)) o.evidence.slice(0, 2).forEach((id) => ids.add(id));
  const base = [...ids].map((id) => c.evidence[id]).filter(Boolean);
  // Give plant links readable labels with the plant facts.
  for (const pc of c.chain) for (const p of pc.plants) {
    const e = c.evidence[p.evidence[0]];
    if (e) e.fields = { product_labeler: pc.labeler, ndc11: pc.ndc11, plant: p.name, fei: p.fei, country: p.country, operations: p.operations, link: p.linkQuality, last_inspection: p.lastClassification ? `${p.lastClassification.classification} ${p.lastClassification.endDate}` : null };
  }
  return [...derived, ...base];
}

export function decideState(c: Case): Explanation["state"] {
  const window = (d: string) => !c.shortage.firstPosting || daysBetween(d, c.shortage.firstPosting) <= 365 * 3;
  const strong = c.chain.some((pc) => pc.plants.some((p) => p.linkQuality === "registered plant" && p.signals.some((s) => s.kind !== "inspection_vai" && window(s.date))));
  if (strong) return "confirmed";
  const weak = c.chain.some((pc) => pc.plants.some((p) => p.signals.length > 0)) || c.dataQuality.some((d) => d.invalid > 0 && d.rule.includes(c.molecule));
  return weak ? "check" : "no_signal";
}

function datesIn(text: string): { iso?: string; ym?: string }[] {
  const out: { iso?: string; ym?: string }[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push({ iso: `${m[1]}-${m[2]}-${m[3]}` });
  const mon = MONTHS.join("|");
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2}) (${mon}) (\\d{4})\\b`, "gi"))) out.push({ iso: `${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}` });
  for (const m of text.matchAll(new RegExp(`\\b(${mon}) (\\d{1,2}),? (\\d{4})\\b`, "gi"))) out.push({ iso: `${m[3]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}` });
  for (const m of text.matchAll(new RegExp(`\\b(${mon}) (\\d{4})\\b`, "gi"))) out.push({ ym: `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}` });
  return out;
}

/** Numbers of two or more digits, outside dates and NDC/FEI-looking codes. */
function numbersIn(text: string): string[] {
  const stripped = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ").replace(/\b\d{1,2} [A-Za-z]+ \d{4}\b/g, " ").replace(/\b[A-Za-z]+ \d{1,2},? \d{4}\b/g, " ").replace(/\b[A-Za-z]+ \d{4}\b/g, " ");
  return [...stripped.matchAll(/(?<![\w.-])(\d{2,}(?:\.\d+)?)(?![\w-])/g)].map((m) => m[1]);
}

export function verifySentence(s: Sentence, c: Case): string | null {
  if (!s.cites?.length) return "cites nothing";
  const unknown = s.cites.filter((id) => !c.evidence[id]);
  if (unknown.length) return `cites unknown evidence ${unknown.join(", ")}`;
  const hay = s.cites.map((id) => line(c.evidence[id])).join(" ");
  for (const d of datesIn(s.text)) {
    if (d.iso && !hay.includes(d.iso)) return `date ${d.iso} is not in the cited evidence`;
    if (d.ym && !hay.includes(d.ym)) return `month ${d.ym} is not in the cited evidence`;
  }
  for (const n of numbersIn(s.text)) {
    if (!new RegExp(`(?<![\\d.])${n.replace(".", "\\.")}(?![\\d])`).test(hay)) return `number ${n} is not in the cited evidence`;
  }
  return null;
}

const SYSTEM = `You write the "why" section of a drug shortage brief for a hospital pharmacy buyer.
Use only the numbered evidence lines you are given. Every sentence must cite the ids it relies on.
Write dates exactly as they appear in the evidence (YYYY-MM-DD), and use only numbers that appear in the cited lines.
Say what FDA's records show and when; do not claim a cause FDA has not stated. Never give dosing or clinical advice.
Plain sentence case, calm, specific. 4 to 7 sentences. Reply with JSON only:
{"headline": "...", "headline_cites": ["E1"], "sentences": [{"text": "...", "cites": ["E3", "D2"]}]}`;

export async function explain(c: Case): Promise<Explanation> {
  const state = decideState(c);
  const derived = derive(c);
  const ev = pack(c, derived);
  const best = c.options[0];
  const ask = [
    `Question: ${c.question}`,
    `Drug: ${tallMan(c.molecule)}. Today: ${c.asOf}. State decided by rule: ${state} (${state === "confirmed" ? "a registered plant on our products' labels has an FDA action within 3 years before the posting" : state === "check" ? "the links are weak or some records fail data checks; say what to check" : "no public FDA signal at our plants; say so plainly"}).`,
    best ? `Best option by rule: ${best.title}. ${best.detail}` : "No option found.",
    "",
    "Evidence:",
    ...ev.map(line),
  ].join("\n");
  const fallbackHeadline = state === "confirmed"
    ? `FDA's records trace this shortage to a plant on our own labels`
    : state === "check" ? "The public record is incomplete; check the flagged links" : "FDA's records show no signal at our plants";
  try {
    const r = await chat([{ role: "system", content: SYSTEM }, { role: "user", content: ask }], { model: MODELS.reason, maxTokens: 900 });
    const j = parseJson<{ headline?: string; headline_cites?: string[]; sentences?: Sentence[] }>(r.text);
    const rejected: Explanation["verifier"]["rejected"] = [];
    const kept: Sentence[] = [];
    for (const s of j.sentences ?? []) {
      const why = verifySentence(s, c);
      if (why) rejected.push({ text: s.text, reason: why });
      else kept.push({ text: s.text, cites: s.cites });
    }
    const head: Sentence = { text: j.headline ?? fallbackHeadline, cites: j.headline_cites ?? [] };
    const headBad = j.headline ? verifySentence(head, c) : "no headline";
    if (headBad && j.headline) rejected.push({ text: j.headline, reason: `headline: ${headBad}` });
    return {
      state, headline: headBad ? fallbackHeadline : head.text, sentences: kept,
      verifier: { checked: (j.sentences?.length ?? 0) + (j.headline ? 1 : 0), rejected }, model: r.model,
    };
  } catch (e) {
    return { state, headline: fallbackHeadline, sentences: [], verifier: { checked: 0, rejected: [{ text: "", reason: `model unavailable: ${(e as Error).message.slice(0, 120)}` }] }, model: MODELS.reason };
  }
}
