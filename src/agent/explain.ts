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
    for (const o of c.options.slice(0, 3)) add(`Option ranked ${o.rank} by rule: ${o.title}. ${o.detail}`, { kind: o.kind, needs: o.needs });
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

/** "1,286" and "1286" are the same number: drop digit-grouping commas before comparing. */
const ungroup = (s: string) => s.replace(/(\d),(?=\d{3}\b)/g, "$1");

/** Numbers of two or more digits, outside dates and NDC/FEI-looking codes. */
function numbersIn(text: string): string[] {
  // Remove dates (checked separately) before collecting numbers; only real month names count as dates.
  const mon = MONTHS.join("|");
  const stripped = ungroup(text)
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(new RegExp(`\\b\\d{1,2} (${mon}) \\d{4}\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(${mon}) \\d{1,2},? \\d{4}\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(${mon}) \\d{4}\\b`, "gi"), " ");
  return [...stripped.matchAll(/(?<![\w.-])(\d{2,}(?:\.\d+)?)(?![\w-])/g)].map((m) => m[1]);
}

/** Missing dates and numbers: the tokens a sentence uses that its cited lines do not contain. */
function missingTokens(s: Sentence, c: Case): string[] {
  const hay = ungroup(s.cites.filter((id) => c.evidence[id]).map((id) => line(c.evidence[id])).join(" "));
  const out: string[] = [];
  for (const d of datesIn(s.text)) {
    const tok = d.iso ?? d.ym!;
    if (!hay.includes(tok)) out.push(tok);
  }
  for (const n of numbersIn(s.text)) if (!new RegExp(`(?<![\\d.])${n.replace(".", "\\.")}(?![\\d])`).test(hay)) out.push(n);
  return out;
}

/** If a sentence fails only because it cited the wrong line, and exactly one line in the pack holds each missing
 *  token, attach that line and check again. Repairs are counted and shown; nothing is added that the verifier
 *  would not accept on its own. */
export function repairCites(s: Sentence, c: Case, pack: Evidence[]): Sentence | null {
  const missing = missingTokens(s, c);
  if (!missing.length || s.cites.some((id) => !c.evidence[id])) return null;
  const add: string[] = [];
  for (const tok of missing) {
    const hits = pack.filter((e) => ungroup(line(e)).includes(tok));
    if (hits.length !== 1) return null;
    if (!s.cites.includes(hits[0].id) && !add.includes(hits[0].id)) add.push(hits[0].id);
  }
  const fixed = { text: s.text, cites: [...s.cites, ...add] };
  return verifySentence(fixed, c) ? null : fixed;
}

export function verifySentence(s: Sentence, c: Case): string | null {
  if (!s.cites?.length) return "cites nothing";
  const unknown = s.cites.filter((id) => !c.evidence[id]);
  if (unknown.length) return `cites unknown evidence ${unknown.join(", ")}`;
  const hay = ungroup(s.cites.map((id) => line(c.evidence[id])).join(" "));
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
The headline says what the record shows, never a cause: for example "FDA's records trace our supply to a plant classified OAI <N> days before the posting" (with N taken from a D line), not "the shortage is caused by" or "linked to". The headline names at most one number of days; when several plants or postings qualify, name the count of plants and the closest one.
Day counts and durations are in the D lines: cite the D line whenever you use one.
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
    const r = await chat([{ role: "system", content: SYSTEM }, { role: "user", content: ask }], { model: MODELS.reason, maxTokens: 1500 });
    const j = parseJson<{ headline?: string; headline_cites?: string[]; sentences?: Sentence[] }>(r.text);
    const rejected: Explanation["verifier"]["rejected"] = [];
    const kept: Sentence[] = [];
    let repaired = 0;
    const check = (s: Sentence): Sentence | string => {
      const why = verifySentence(s, c);
      if (!why) return s;
      const fixed = repairCites(s, c, ev);
      if (fixed) {
        repaired++;
        return fixed;
      }
      return why;
    };
    for (const s of j.sentences ?? []) {
      const res = check({ text: s.text, cites: s.cites ?? [] });
      if (typeof res === "string") rejected.push({ text: s.text, reason: res });
      else kept.push(res);
    }
    let headline = fallbackHeadline;
    if (j.headline) {
      const res = check({ text: j.headline, cites: j.headline_cites ?? [] });
      if (typeof res === "string") rejected.push({ text: j.headline, reason: `headline: ${res}` });
      else headline = res.text;
    }
    return {
      state, headline, sentences: kept,
      verifier: { checked: (j.sentences?.length ?? 0) + (j.headline ? 1 : 0), rejected, repaired }, model: r.model,
    };
  } catch (e) {
    return { state, headline: fallbackHeadline, sentences: [], verifier: { checked: 0, rejected: [{ text: "", reason: `model unavailable: ${(e as Error).message.slice(0, 120)}` }] }, model: MODELS.reason };
  }
}
