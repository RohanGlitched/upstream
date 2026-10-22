// The "why" in a brief. Rules decide the state; Nemotron writes the sentences from numbered evidence lines;
// a verifier drops any sentence whose citations, dates or numbers are not in the evidence it cites.
import { chat, parseJson, MODELS } from "../lib/nemotron";
import type { Case, Evidence, Explanation, Sentence } from "./types";
import { daysBetween, round, tallMan } from "./util";
import { line, repairCites, verifySentence } from "./verify";

export { repairCites, verifySentence };

// FDA's shortage database gives 2012-01-01 to shortages already running when it began: a floor, not a posting date.
export const FDA_DB_START = "2012-01-01";
const dated = (c: Case) => !!c.shortage.firstPosting && c.shortage.firstPosting !== FDA_DB_START;


/** Derived facts (counts, day gaps) get their own evidence ids, so every number a sentence uses is citable. */
function derive(c: Case): Evidence[] {
  const out: Evidence[] = [];
  let n = 0;
  const add = (label: string, fields: Record<string, string | number | null>) => {
    const e: Evidence = { id: `D${++n}`, queryId: "derived", row: -1, label, fields };
    out.push(e);
    c.evidence[e.id] = e;
  };
  // Days on hand per presentation: a 5 mL vial's stock never covers a 60 mL vial's shortfall.
  for (const p of (c.presentations ?? []).filter((x) => !x.key.startsWith("unplaced:"))) {
    for (const h of p.hospitals) {
      const days = h.dailyUse > 0 ? round(h.onHand / h.dailyUse, 1) : null;
      add(`${h.hospital} holds ${round(h.onHand, 0)} ${p.unit}s of ${c.molecule} ${p.short} at ${round(h.dailyUse, 1)} a day: ${days ?? "no recent use, so no"} days on hand`,
        { hospital: h.hospital, presentation: p.label, on_hand: round(h.onHand, 0), daily_use: round(h.dailyUse, 1), days_on_hand: days });
    }
  }
  const byH = new Map<string, { onHand: number; daily: number }>();
  for (const s of c.presentations?.length ? [] : c.stock) {
    const h = byH.get(s.hospital) ?? { onHand: 0, daily: 0 };
    h.onHand += s.onHand;
    h.daily += s.dailyUse;
    byH.set(s.hospital, h);
  }
  for (const [h, v] of byH) {
    const days = v.daily > 0 ? round(v.onHand / v.daily, 0) : null;
    add(`${h} holds ${round(v.onHand, 0)} units of ${c.molecule} at ${round(v.daily, 1)} a day: ${days ?? "no recent use, so no"} days on hand`, { hospital: h, on_hand: round(v.onHand, 0), daily_use: round(v.daily, 1), days_on_hand: days });
  }
  const posted = c.shortage.firstPosting;
  if (posted && !dated(c)) {
    add(`FDA's shortage list gives ${FDA_DB_START} as the first posting, the earliest date its database holds: the shortage began on or before then, so no gap is measured from it`, { posted: FDA_DB_START, note: "database start date" });
    if (!c.shortage.listed) add(`${c.molecule} is not on FDA's current shortage list as of ${c.asOf}`, { as_of: c.asOf, listed: "no" });
  } else if (posted) {
    // One dated event per line, with the firm and FEI it happened at: an inspection's end date and its
    // classification letter are two lines, so a sentence cannot pair the letter's date with the end date's gap.
    for (const t of c.timeline) {
      if (t.kind === "today" || t.kind === "shortage_posted" || t.daysBeforePosting === null) continue;
      const rel = t.daysBeforePosting >= 0 ? `${t.daysBeforePosting} days before` : `${-t.daysBeforePosting} days after`;
      const f = (t.evidence && c.evidence[t.evidence]?.fields) || {};
      const firm = String(f.legal_name ?? f.firm ?? f.recalling_firm ?? "") || null;
      const fei = f.fei ? String(f.fei) : null;
      const what = t.label.replace(/; classification letter \d{4}-\d{2}-\d{2}/, "");
      const at = firm && t.kind !== "recall" ? ` at ${firm}${fei ? ` (FEI ${fei})` : ""}` : "";
      const lbl = /^FDA inspection \d+/.test(what) ? what.replace(/^(FDA inspection \d+)/, `$1${at}`) : `${what}${at}`;
      add(`${lbl} — ${rel} FDA posted the shortage on ${posted}`, { date: t.date, posted, days: Math.abs(t.daysBeforePosting), firm, fei });
    }
    const letters = new Set<string>();
    for (const pc of c.chain) for (const p of pc.plants) for (const s of p.signals) {
      if ((s.kind !== "inspection_oai" && s.kind !== "inspection_vai") || s.knownBasis !== "fmd145_letter" || !s.knownDate) continue;
      const id = s.text.match(/inspection (\d+)/)?.[1] ?? s.knownDate;
      if (letters.has(id)) continue;
      letters.add(id);
      const gap = daysBetween(s.knownDate, posted);
      const cls = s.kind === "inspection_oai" ? "OAI" : "VAI";
      add(`FDA's ${cls} classification letter for inspection ${id} at ${p.name}${p.fei ? ` (FEI ${p.fei})` : ""} is dated ${s.knownDate}, ${Math.abs(gap)} days ${gap >= 0 ? "before" : "after"} FDA posted the shortage on ${posted}`, { letter: s.knownDate, posted, days: Math.abs(gap), fei: p.fei });
    }
    // A shortage that is not on the current list gets no running total.
    if (!c.shortage.listed) {
      add(`${c.molecule} is not on FDA's current shortage list as of ${c.asOf}; FDA's history shows an earlier shortage first posted on ${posted}, since resolved`, { as_of: c.asOf, posted, listed: "no", status: "resolved" });
    } else {
      const months = Math.round(daysBetween(posted, c.asOf) / 30.4);
      add(`As of ${c.asOf} the shortage has been on FDA's list for ${months} months`, { as_of: c.asOf, posted, months });
    }
  } else {
    add(`${c.molecule} is not on FDA's drug shortage list as of ${c.asOf}`, { as_of: c.asOf, listed: "no" });
  }
  c.options.slice(0, 3).forEach((o, i) => {
    const t = o.transfer;
    add(`Option ranked ${i + 1} by rule: ${o.title}. ${o.detail}`, t
      ? { kind: o.kind, needs: o.needs, qty: t.qty, unit: t.unit, from: t.from, to: t.to, from_days: t.fromDays, to_days: t.toDays, from_after: t.fromAfter, to_after: t.toAfter }
      : { kind: o.kind, needs: o.needs });
  });
  return out;
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

/** "confirmed" needs the drug on FDA's current list with a dated posting, and an FDA action (not a VAI) at a
 *  registered plant in the 3 years before it.
 *  Actions after the posting, or with no posting at all, can make a case worth checking, never confirmed. */
export function decideState(c: Case): Explanation["state"] {
  const posted = dated(c) && c.shortage.listed ? c.shortage.firstPosting : null;
  const before = (d: string) => {
    if (!posted) return false;
    const gap = daysBetween(d, posted);
    return gap >= 0 && gap <= 365 * 3;
  };
  const strong = c.chain.some((pc) => pc.plants.some((p) => p.linkQuality === "registered plant" && p.signals.some((s) => s.kind !== "inspection_vai" && before(s.date))));
  if (strong) return "confirmed";
  const weak = c.chain.some((pc) => pc.plants.some((p) => p.signals.length > 0)) || c.dataQuality.some((d) => d.invalid > 0 && d.rule.includes(c.molecule));
  return weak ? "check" : "no_signal";
}

const SYSTEM = `You write the "why" section of a drug shortage brief for a hospital pharmacy buyer.
Use only the numbered evidence lines you are given. Every sentence must cite the ids it relies on.
Write dates exactly as they appear in the evidence (YYYY-MM-DD), and use only numbers that appear in the cited lines.
Say what FDA's records show and when; do not claim a cause FDA has not stated. Never give dosing or clinical advice.
If the drug is not on FDA's current shortage list, say so and never say it is listed, remains listed or has been on the list for a time; an earlier, resolved episode may be mentioned as past. Never claim there was no FDA action unless the evidence says so for every plant. Write every number as digits copied from the cited lines, including small counts and numbers under ten (write 3, not three). When a sentence names a company or plant, or says OAI, VAI or NAI, cite a line that contains it.
The headline says what the record shows, never a cause: for example "FDA's records trace our supply to a plant classified OAI <N> days before the posting" (with N taken from a D line), not "the shortage is caused by" or "linked to". The headline names at most one number of days; when several plants or postings qualify, name the count of plants and the closest one. When the state is confirmed, the headline names an FDA action dated before the posting (a D line that says "before"), never one after it.
Day counts and durations are in the D lines: cite the D line whenever you use one. When a sentence gives a day count, the date it states with that count is the date on the same D line (an inspection's end date and its classification letter are separate lines with separate counts).
When a sentence names a firm or plant together with an FDA action and a date, cite the line that holds all three.
Plain sentence case, calm, specific. 4 to 7 sentences. Reply with JSON only:
{"headline": "...", "headline_cites": ["E1"], "sentences": [{"text": "...", "cites": ["E3", "D2"]}]}`;

export async function explain(c: Case): Promise<Explanation> {
  const state = decideState(c);
  const derived = derive(c);
  const ev = pack(c, derived);
  const best = c.options[0];
  const listing = !c.shortage.firstPosting ? "not listed" : `${c.shortage.status ?? "listed"}, first posted ${c.shortage.firstPosting}`;
  const ask = [
    `Question: ${c.question}`,
    `Drug: ${tallMan(c.molecule)}. Today: ${c.asOf}. FDA shortage list: ${listing}.`,
    `State decided by rule: ${state} (${state === "confirmed" ? "a registered plant on our products' labels has an FDA action in the 3 years before the posting" : state === "check" ? "there are FDA actions or weak links, but no action before a posting at a registered plant, or some records fail data checks; say what to check" : "no public FDA signal at our plants; say so plainly"}).`,
    best ? `Best option by rule: ${best.title}. ${best.detail}` : "No option found.",
    "",
    "Evidence:",
    ...ev.map((e) => line(e)),
  ].join("\n");
  const posted = !!c.shortage.firstPosting;
  // Written by rule when the model's own headline is refused: it names the plant, the finding and the gap.
  const KIND: Record<string, string> = { inspection_oai: "an OAI inspection", warning_letter: "a warning letter", import_alert: "an import alert", injunction: "an injunction", seizure: "a seizure" };
  const lead = c.chain.flatMap((pc) => pc.plants.filter((p) => p.linkQuality === "registered plant").flatMap((p) => p.signals.map((s) => ({ p, s }))))
    .filter(({ s }) => s.kind in KIND && c.shortage.firstPosting && daysBetween(s.date, c.shortage.firstPosting) >= 0 && daysBetween(s.date, c.shortage.firstPosting) <= 365 * 3)
    .sort((a, b) => b.s.date.localeCompare(a.s.date))[0];
  const fallbackHeadline = state === "confirmed" && lead
    ? `FDA's records show ${KIND[lead.s.kind]} at ${lead.p.name}${lead.p.fei ? ` (FEI ${lead.p.fei})` : ""}, a plant on our labels, ${daysBetween(lead.s.date, c.shortage.firstPosting!)} days before the shortage posting`
    : state === "confirmed" ? `FDA's records trace this shortage to a plant on our own labels`
    : state === "check"
      ? posted ? "The public record is incomplete; check the flagged links" : "Not on FDA's shortage list; FDA's record shows actions at plants on our labels"
      : posted ? "FDA's records show no signal at our plants" : "Not on FDA's shortage list, and no FDA signal at our plants";
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
      // A confirmed state rests on an action before the posting: a headline that leads with one after it misstates why.
      const late = state === "confirmed" && /\b\d[\d,]*\s+days?\s+after\b|\bafter (?:the |FDA'?s? )?(?:shortage )?post/i.test(j.headline)
        ? "a confirmed headline must name the FDA action before the posting, not one after it" : null;
      const res = late ?? check({ text: j.headline, cites: j.headline_cites ?? [] });
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
