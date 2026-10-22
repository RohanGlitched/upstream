// Grounding check for model-written prose that has no per-sentence citations (the P&T memo, the morning brief).
// Runs after the model call, so recorded replies still replay. Every date, every number of two or more digits,
// every decimal, and every single digit followed by a unit word ("3 days", "5 vials") must appear in the source
// lines the model was given. A number written with less precision than its source counts ("12 days" for 11.8).
// Causal claims ("caused", "due to", "led to", "resulted in") are refused unless the cause they name is in FDA's
// own stated reason (the shortage list's reasons, a recall's reason). Sentences that fail are dropped and returned
// with the reason; section headers and list numbers stay.
import type { Case, Evidence } from "./types";
import { caseClaimProblem } from "./verify";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const monthNo = (m: string) => String(MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3))) + 1).padStart(2, "0");
const UNIT = "days?|weeks?|months?|years?|hours?|vials?|units?|bags?|doses?|packages?|packs?|cartons?|bottles?|syringes?|mg|mcg|g|ml|l|percent";
const NUMBER_WORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/i;
const CAUSAL = /\b(caus(?:ed|es|ing)|due to|led to|leads? to|leading to|result(?:ed|s)? in|resulting from|as a result of|driven by|drove|because of|stems? from|owing to|attributable to)\b/gi;
const NEGATION = /\b(not|never|no|nor|neither|without|cannot)\b|n't\b/i;

export interface Dropped {
  text: string;
  reason: string;
}

export interface Grounding {
  /** sentences checked */
  checked: number;
  /** dates and numbers matched against the source lines */
  tokens: number;
  dropped: Dropped[];
}

interface Haystack {
  text: string;
  numbers: number[];
  isoDates: Set<string>;
  causal: string;
  /** what the lines are called in a refusal reason */
  label: string;
}

const ungroup = (s: string) => s.replace(/(\d),(?=\d{3}\b)/g, "$1");

/** Build the haystack: the lines the model saw. Numbers are parsed; ISO dates are kept whole (and their years). */
export function haystack(lines: string[], fdaReasons: string[] = [], label = "evidence lines"): Haystack {
  const text = ungroup(lines.join("\n"));
  const isoDates = new Set<string>();
  const numbers: number[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})/g)) {
    isoDates.add(`${m[1]}-${m[2]}-${m[3]}`);
    numbers.push(Number(m[1]));
  }
  const rest = text.replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, " ");
  for (const m of rest.matchAll(/\d+(?:\.\d+)?/g)) numbers.push(Number(m[0]));
  return { text, numbers, isoDates, causal: fdaReasons.join(" \n ").toLowerCase(), label };
}

interface Claim {
  token: string;
  ok: boolean;
}

function checkDate(iso: string | null, ym: string | null, md: string | null, h: Haystack): boolean {
  const all = [...h.isoDates];
  if (iso) return h.isoDates.has(iso);
  if (ym) return all.some((d) => d.startsWith(ym));
  if (md) return all.some((d) => d.endsWith(md));
  return false;
}

/** Does the haystack hold this number at the precision it is written with? */
function checkNumber(raw: string, h: Haystack): boolean {
  const v = Number(raw);
  const dec = raw.includes(".") ? raw.split(".")[1].length : 0;
  const f = 10 ** dec;
  return h.numbers.some((n) => Math.abs(Math.round(n * f) / f - v) < 1e-9);
}

/** The dates and numbers a sentence states, each checked against the haystack. */
export function claimsIn(sentence: string, h: Haystack): Claim[] {
  const out: Claim[] = [];
  let s = ungroup(sentence.replace(/[‐‑]/g, "-"));
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => Claim) => {
    s = s.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      out.push(fn(m));
      return " ";
    });
  };
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => ({ token: m[0], ok: checkDate(`${m[1]}-${m[2]}-${m[3]}`, null, null, h) }));
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (${MON})\\.? (\\d{4})\\b`, "gi"), (m) => ({ token: m[0], ok: checkDate(`${m[3]}-${monthNo(m[2])}-${m[1].padStart(2, "0")}`, null, null, h) }));
  take(new RegExp(`\\b(${MON})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})\\b`, "gi"), (m) => ({ token: m[0], ok: checkDate(`${m[3]}-${monthNo(m[1])}-${m[2].padStart(2, "0")}`, null, null, h) }));
  take(new RegExp(`\\b(${MON})\\.? (\\d{4})\\b`, "gi"), (m) => ({ token: m[0], ok: checkDate(null, `${m[2]}-${monthNo(m[1])}`, null, h) }));
  take(new RegExp(`\\b(${MON})\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"), (m) => ({ token: m[0], ok: checkDate(null, null, `-${monthNo(m[1])}-${m[2].padStart(2, "0")}`, h) }));
  // Codes (NDCs, item keys): the whole code must be in the source text.
  take(/\b\d+(?:-\d+){1,3}\b(?![-\s]?(?:day|week|month|year|hour)s?\b)/gi, (m) => ({ token: m[0], ok: h.text.includes(m[0]) || h.text.includes(m[0].replace(/-/g, "")) }));
  // Numbers: 2+ digits, any decimal, or a single digit followed by a unit word.
  for (const m of s.matchAll(new RegExp(`(?<![\\w.-])(\\d+(?:\\.\\d+)?)(?:\\s?(%)|[-\\s]?(${UNIT})\\b)?(?!\\w)`, "gi"))) {
    const raw = m[1];
    if (raw.replace(".", "").length < 2 && !m[2] && !m[3]) continue;
    out.push({ token: m[0].trim(), ok: checkNumber(raw, h) });
  }
  return out;
}

const STOP = new Set(["the", "and", "for", "with", "this", "that", "from", "our", "its", "their", "other", "some", "drug", "product", "products", "shortage", "supply"]);

/** A causal claim FDA's own reason text does not make, or null. The claim passes when the stated cause (the words
 *  after "due to", "caused by" ...) is in an FDA reason, e.g. "due to discontinuation of manufacture" against FDA's
 *  "Discontinuation of the manufacture of the drug". Negated mentions ("FDA has not said ... caused") pass. */
function unsupportedCause(sentence: string, h: Haystack): string | null {
  for (const m of sentence.matchAll(CAUSAL)) {
    const at = m.index ?? 0;
    if (NEGATION.test(sentence.slice(Math.max(0, at - 60), at))) continue;
    const after = sentence.slice(at + m[0].length).replace(/^\s*by\b/i, "").split(/[.;:,(]|\band\b|\bwhile\b/)[0];
    // An inspection that "resulted in" a classification states its outcome, not a cause of the shortage.
    if (/^result/i.test(m[1]) && /^\s*(?:an?\s+)?(?:OAI|VAI|NAI)\b/i.test(after)) continue;
    const words = [...new Set(after.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((w) => !STOP.has(w)).slice(0, 3);
    const hits = words.filter((w) => h.causal.includes(w.replace(/(ing|ion|ed|es|s)$/, "")));
    if (!words.length || hits.length < Math.ceil(words.length / 2)) return `the causal claim "${m[1]}${after.trim() ? ` ${after.trim().split(/\s+/).slice(0, 5).join(" ")}` : ""}" is not in FDA's stated reason`;
  }
  return null;
}

function checkSentence(sentence: string, h: Haystack): { reason: string | null; tokens: number } {
  const claims = claimsIn(sentence, h);
  const bad = claims.find((c) => !c.ok);
  if (bad) return { reason: `"${bad.token}" is not in the ${h.label}`, tokens: claims.length };
  // A count written in words ("Sixteen drugs") cannot be checked against the rows, so it is not allowed.
  const word = sentence.match(NUMBER_WORDS);
  if (word) return { reason: `"${word[1]}" is a number in words, so it cannot be checked`, tokens: claims.length };
  return { reason: unsupportedCause(sentence, h), tokens: claims.length };
}

/** Split into sentences without breaking decimals, "U.S." style abbreviations or list numbers. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(“"'])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const HEADER = /^((?:Situation|Why(?: \(FDA record\))?|Our position|Recommended actions|Not recommended)\s*:)\s*/i;
const ITEM = /^(\d+[.)]|[-*•])\s+/;
const REMOVED = "[Removed by the verifier; see the dropped sentences below.]";

/** Check a memo-shaped text line by line: headers and list markers stay, failing sentences are dropped. */
export function groundText(text: string, h: Haystack, extra?: (sentence: string) => string | null): { text: string } & Grounding {
  const g: Grounding = { checked: 0, tokens: 0, dropped: [] };
  const out: string[] = [];
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      out.push("");
      continue;
    }
    let prefix = "";
    let body = line.replace(/\*\*/g, "");
    const hm = HEADER.exec(body);
    if (hm) {
      prefix = hm[1];
      body = body.slice(hm[0].length);
    }
    const im = ITEM.exec(body);
    if (im) {
      prefix = prefix ? `${prefix} ${im[1]}` : im[1];
      body = body.slice(im[0].length);
    }
    if (!body) {
      out.push(prefix);
      continue;
    }
    const kept: string[] = [];
    for (const s of sentences(body)) {
      g.checked++;
      const r = checkSentence(s, h);
      if (!r.reason && extra) r.reason = extra(s);
      g.tokens += r.tokens;
      if (r.reason) g.dropped.push({ text: s, reason: r.reason });
      else kept.push(s);
    }
    const rest = kept.join(" ");
    out.push([prefix, rest || (prefix ? REMOVED : "")].filter(Boolean).join(" "));
  }
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), ...g };
}

// ------------------------------------------------------------------ the memo's sources

const ADDRESS = /address|street|city|zip|postal|phone/i;

function evidenceLine(e: Evidence): string {
  const f = Object.entries(e.fields)
    .filter(([k, v]) => v !== null && v !== "" && !ADDRESS.test(k))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("; ");
  return `[${e.id}] ${e.label}${f ? ` (${f})` : ""}`;
}

/** The lines a memo may draw on: every evidence row (labels and values, no addresses), the derived D lines, and
 *  the case facts the memo prompt is built from (status, stock, options, verified sentences). */
export function caseHaystack(c: Case): Haystack {
  const lines = [
    `As of ${c.asOf}. FDA status ${c.shortage.status ?? "not listed"} since ${c.shortage.firstPosting ?? "-"}.`,
    ...Object.values(c.evidence).map(evidenceLine),
    ...(c.explanation ? [c.explanation.headline, ...c.explanation.sentences.map((s) => s.text)] : []),
    ...c.stock.map((s) => `${s.hospital}: ${s.description}, ${s.onHand} on hand, ${s.dailyUse} a day, ${s.days ?? "-"} days`),
    ...c.options.map((o) => `${o.title}. ${o.detail}. ${o.why}. Needs ${o.needs}.`),
    ...c.shortage.companies.map((x) => `${x.company}: ${x.status}, updated ${x.updated}. ${x.info}`),
    ...c.timeline.map((t) => `${t.date} ${t.label}`),
  ];
  // FDA's own stated reasons: the shortage list's reasons and company notes, and the reason on each recall row.
  const reasons = [...c.shortage.reasons, ...c.shortage.companies.map((x) => x.info), ...Object.values(c.evidence).map((e) => String(e.fields.reason ?? "")).filter(Boolean)];
  return haystack(lines, reasons);
}

export function groundMemo(draft: string, c: Case): { text: string } & Grounding {
  // Names, classifications, sponsors, absences and status words are checked as the case's own sentences are.
  return groundText(draft, caseHaystack(c), (s) => caseClaimProblem(s, c));
}

// ------------------------------------------------------------------ the morning brief's sources

export interface WatchRowLite {
  molecule: string;
  state: string;
  systemDays: number | null;
  minDays: number | null;
  hospital: string | null;
  signal: string;
  headline: string;
}

/** The same lines the brief prompt is built from: the run header and one line per flagged drug. */
export const watchHeader = (asOf: string, total: number, flagged: number) => `As of ${asOf}. ${total} formulary drugs checked overnight; ${flagged} flagged.`;
export const watchLine = (f: WatchRowLite) => `${f.molecule}: ${f.state}; ${f.systemDays ?? "-"} days across the system, lowest ${f.minDays ?? "-"} at ${f.hospital}; ${f.signal}`;

/** Ground the morning brief against all the watch rows, and each drug's headline against its own row. A headline
 *  that fails is replaced by the rule-written one; brief sentences that fail are dropped. */
export function groundWatch<F extends WatchRowLite>(w: { asOf: string; drugs: number; quiet?: number; brief: string; flagged: F[] }, fallback: (f: F) => string): { brief: string; flagged: F[]; grounding: Grounding } {
  const head = watchHeader(w.asOf, w.drugs, w.flagged.length);
  const extra = w.quiet !== undefined ? [`${w.quiet} quiet.`, `${w.flagged.filter((f) => f.state === "act").length} act, ${w.flagged.filter((f) => f.state === "watch").length} watch.`] : [];
  const all = haystack([head, ...extra, ...w.flagged.map(watchLine)], [], "watch rows");
  const b = groundText(w.brief, all);
  const g: Grounding = { checked: b.checked, tokens: b.tokens, dropped: [...b.dropped] };
  const flagged = w.flagged.map((f) => {
    if (!f.headline) return f;
    const r = groundText(f.headline, haystack([head, watchLine(f)], [], "watch row"));
    g.checked += r.checked;
    g.tokens += r.tokens;
    if (!r.dropped.length) return f;
    g.dropped.push(...r.dropped.map((d) => ({ text: `${f.molecule}: ${d.text}`, reason: d.reason })));
    return { ...f, headline: fallback(f) };
  });
  return { brief: b.text, flagged, grounding: g };
}
