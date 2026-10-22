// The verifier: a sentence the model writes is kept only if the rows it cites say the same thing.
// Dates, numbers and counts must be in the cited lines; a stock figure must be the field it claims to be; a day gap
// must come from the line about the event the sentence names, in the same direction; a firm and its OAI/VAI/NAI must
// sit on one cited line; causes, status changes and numbers written in words are refused unless the record says so.
// Each rule exists because a judge got a false sentence past an earlier version (scripts/verifier-adversarial.mts).
import type { Case, Evidence, Sentence } from "./types";
import FIRMS from "./firms.json";

/** Address-like fields are left out when checking: a plot number or postcode is not a figure a sentence may use. */
const ADDRESS = /address|street|city|postal|zip/i;

export function line(e: Evidence, forCheck = false): string {
  const f = Object.entries(e.fields)
    .filter(([k, v]) => v !== null && v !== "" && !(forCheck && ADDRESS.test(k)))
    .map(([k, v]) => `${k}=${forCheck ? String(v) : String(v).slice(0, 140)}`)
    .join("; ");
  return `[${e.id}] ${e.label}${f ? ` (${f})` : ""}`;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// Full names and the usual abbreviations ("Dec 3, 2022", "Sept. 2023").
const MON = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
const monthNo = (m: string) => String(MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().replace(/\.$/, "").slice(0, 3))) + 1).padStart(2, "0");

/** "1,286" and "1286" are the same number; "9-day" is "9 day". */
const normal = (s: string) => s.replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/(\d)-(?=(?:day|week|month|year|vial|unit|dose|bag)s?\b)/gi, "$1 ");

function datesIn(text: string): { iso?: string; ym?: string }[] {
  const out: { iso?: string; ym?: string }[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push({ iso: `${m[1]}-${m[2]}-${m[3]}` });
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2}) (${MON})\\.? (\\d{4})\\b`, "gi"))) out.push({ iso: `${m[3]}-${monthNo(m[2])}-${m[1].padStart(2, "0")}` });
  for (const m of text.matchAll(new RegExp(`\\b(${MON})\\.? (\\d{1,2}),? (\\d{4})\\b`, "gi"))) out.push({ iso: `${m[3]}-${monthNo(m[1])}-${m[2].padStart(2, "0")}` });
  for (const m of text.matchAll(new RegExp(`\\b(${MON})\\.? (\\d{4})\\b`, "gi"))) out.push({ ym: `${m[2]}-${monthNo(m[1])}` });
  return out;
}

const stripDates = (text: string) =>
  text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(new RegExp(`\\b\\d{1,2} (${MON})\\.? \\d{4}\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(${MON})\\.? \\d{1,2},? \\d{4}\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(${MON})\\.? \\d{4}\\b`, "gi"), " ");

/** Numbers of two or more digits, outside dates. */
function numbersIn(text: string): string[] {
  return [...stripDates(normal(text)).matchAll(/(?<![\w.-])(\d{2,}(?:\.\d+)?)(?![\w-])/g)].map((m) => m[1]);
}

/** Single digits count too when they are a quantity: "9 days", "3 plants", "a 9-day supply". */
const UNIT = "days?|weeks?|months?|years?|vials?|units?|packages?|bags?|doses?|syringes?|plants?|sites?|inspections?|labelers?|manufacturers?|makers?|companies|recalls?|letters?|alerts?|hospitals?|options?|lines?|rows?|mL|mg|mcg|g|L";
function smallCounts(text: string): string[] {
  return [...stripDates(normal(text)).matchAll(new RegExp(`(?<![\\w.,-])(\\d(?:\\.\\d+)?)\\s+(?:${UNIT})\\b`, "gi"))].map((m) => m[1]);
}

/** The cited lines, each normalised for matching. */
function citedLines(s: Sentence, c: Case): string[] {
  return s.cites.filter((id) => c.evidence[id]).map((id) => normal(line(c.evidence[id], true)));
}

const has = (hay: string, n: string): boolean =>
  new RegExp(`(?<![\\d.])${n.replace(".", "\\.")}(?![\\d])`).test(hay) || (/\.0+$/.test(n) && has(hay, n.replace(/\.0+$/, "")));

/** A term counts as denied only when a negation sits right before it ("no OAI", "not classified OAI", "has not been
 *  classified OAI"). "without a doubt" and "did not deny" assert, they do not deny. */
function negated(text: string, at: number): boolean {
  const before = text.slice(0, at);
  const m = before.match(/\b(no|not|nor|never|without|none)\b((?:\W+\w+){0,2})\W*$/i);
  if (!m) return false;
  return !/^\W*(a\s+doubt|doubt|deny|denied|dispute|disputed|question)\b/i.test(m[2]);
}

/** Missing dates and numbers: the tokens a sentence uses that its cited lines do not contain. */
function missingTokens(s: Sentence, c: Case): string[] {
  const hay = citedLines(s, c).join(" ");
  const out: string[] = [];
  for (const d of datesIn(s.text)) {
    const tok = d.iso ?? d.ym!;
    if (!hay.includes(tok)) out.push(tok);
  }
  for (const n of [...numbersIn(s.text), ...smallCounts(s.text)]) if (!has(hay, n)) out.push(n);
  return out;
}

/** If a sentence fails only because it cited the wrong line, and exactly one line in the pack holds each missing
 *  date or number, attach that line and check again. Names and classifications are never repaired: attaching the
 *  line that names a different plant would make a wrong-plant sentence pass. Repairs are counted and shown; nothing
 *  is added that the verifier would not accept on its own. */
export function repairCites(s: Sentence, c: Case, pack: Evidence[]): Sentence | null {
  const missing = missingTokens(s, c);
  if (!missing.length || s.cites.some((id) => !c.evidence[id])) return null;
  const add: string[] = [];
  for (const tok of missing) {
    const hits = pack.filter((e) => normal(line(e, true)).includes(tok));
    if (hits.length !== 1) return null;
    if (!s.cites.includes(hits[0].id) && !add.includes(hits[0].id)) add.push(hits[0].id);
  }
  const fixed = { text: s.text, cites: [...s.cites, ...add] };
  return verifySentence(fixed, c) ? null : fixed;
}

const NUMBER_WORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen|twice|double|triple|half|quarter|(?<![\d.]\s)a (?:day|week|month|year)|several days|several weeks|several months|several years)\b/i;
const CAUSAL = /\b(caus(?:e|es|ed|ing)|due to|led to|leads to|lead to|leading to|resulted in|results in|result of|as a result|because|responsible for|blamed?|triggered|stems? from|stemmed from|owing to|attributable to|drove|driven by|contributed to|root cause|thanks to|is the reason|the reason (?:for|why)|reason (?:that|why)|explains why|accounts? for|(?:is|lies|was) behind|source of the shortage)\b/i;
// Words that change a status: each must be in the record the sentence cites (by its first six letters).
const STATUS = /\b(resolved|resolution|recalled|discontinu\w*|resum\w*|restock\w*|back in stock|confirmed|confirms|withdr\w*|lifted|reinstat\w*)\b/i;
const CLASSES = ["OAI", "VAI", "NAI"];
// Words too common in company names, or in Corvale's own names, to identify a firm.
const GENERIC = new Set(["pharma", "pharmaceutical", "pharmaceuticals", "laboratories", "laboratory", "labs", "limited", "private", "health", "healthcare", "medical", "company", "corporation", "industries", "international", "global", "sterile", "products", "the", "and", "usa", "inc", "llc", "corp", "corvale", "general", "east", "lakeside", "united", "american", "national", "north", "south", "west", "care", "life", "drug", "drugs", "injection", "solutions", "specialities", "specialty", "group", "holdings"]);

const keyOf = (name: string | null | undefined, molecule: string) => {
  const w = (name ?? "").toLowerCase().match(/[a-z][a-z-]{3,}/g)?.find((x) => !GENERIC.has(x));
  return w && !(molecule ?? "").toLowerCase().includes(w) ? w : null;
};

/** Firms the sentence might name, keyed by a distinctive first word ("intas", "teyro", "hikma"): this case's
 *  labelers and plants, every company on FDA's shortage list and every plant in the atlas. */
function firmKeys(c: Case): Map<string, string> {
  const out = new Map<string, string>();
  const add = (name: string | null | undefined) => {
    const k = keyOf(name, c.molecule);
    if (k && !out.has(k)) out.set(k, name!);
  };
  for (const pc of c.chain ?? []) {
    add(pc.labeler);
    for (const p of pc.plants) add(p.name);
  }
  for (const co of c.shortage?.companies ?? []) add(co.company);
  for (const m of c.market ?? []) {
    add(m.labeler);
    for (const p of m.plants) add(p.name);
  }
  return out;
}

/** Firms from outside this case (FDA's shortage list, the plant atlas) count only when written as a capitalised
 *  name: "Hikma" is a firm, "purchasing" is a word. */
let outsideKeys: { key: string; name: string }[] | null = null;
function outsideFirms(text: string, c: Case, inCase: Map<string, string>): Map<string, string> {
  outsideKeys ??= (FIRMS as string[]).map((name) => ({ key: keyOf(name, "") ?? "", name })).filter((x) => x.key);
  const out = new Map<string, string>();
  for (const { key, name } of outsideKeys) {
    if (inCase.has(key) || out.has(key) || (c.molecule ?? "").toLowerCase().includes(key)) continue;
    if (new RegExp(`\\b${key.charAt(0).toUpperCase()}${key.slice(1)}\\b`).test(text)) out.set(key, name);
  }
  return out;
}

/** FDA's long names for a classification, read as the short ones so the same checks apply. */
function shortClasses(text: string): string {
  return text.replace(/\bOfficial Action Indicated\b/gi, "OAI").replace(/\bVoluntary Action Indicated\b/gi, "VAI").replace(/\bNo Action Indicated\b/gi, "NAI");
}

/** OAI/VAI/NAI the sentence asserts (not ones it says are absent). */
function claimedClasses(text: string): string[] {
  return CLASSES.filter((k) => [...text.matchAll(new RegExp(`\\b${k}\\b`, "g"))].some((m) => !negated(text, m.index!)));
}

function claimedFirms(text: string, c: Case): string[] {
  const inCase = firmKeys(c);
  return [...[...inCase.keys()].filter((key) => new RegExp(`\\b${key}\\b`, "i").test(text)), ...outsideFirms(text, c, inCase).keys()];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(String(v).replace(/,/g, "")));
// "15 days" for 15.1 is the same figure, rounded; "16" for 15.1 is not.
const same = (a: number, b: number) => Math.abs(a - b) < 0.051 || Math.abs(a - b) / Math.max(Math.abs(b), 1) < 0.005 || (Number.isInteger(a) && Math.round(b) === a);

/** Stock figures name what they are; the cited row must hold that figure in that field. */
const FIELD_CLAIMS: { re: RegExp; fields: string[]; what: string }[] = [
  { re: new RegExp(`\\b(?:holds?|holding|has|have|stocks?)\\s+(\\d[\\d.]*)\\s+(?!days?\\b|weeks?\\b|months?\\b)(?:${UNIT})?`, "gi"), fields: ["on_hand", "onHand", "on_hand_units"], what: "on hand" },
  { re: new RegExp(`(\\d[\\d.]*)\\s+(?:(?:${UNIT})\\s+)?(?:a|per)\\s+day\\b`, "gi"), fields: ["daily_use", "dailyUse"], what: "used a day" },
  { re: /\buses?\s+(\d[\d.]*)\b/gi, fields: ["daily_use", "dailyUse"], what: "used a day" },
  { re: /(\d[\d.]*)\s+days?\s+(?:on hand|of (?:supply|stock)|supply|left)\b/gi, fields: ["days_on_hand", "days", "minDays", "from_after", "to_after"], what: "days on hand" },
  { re: /\b(?:retains?|retaining|keeps?|keeping|leaves?|leaving)\s+(?:\w+\s+){0,2}?(\d[\d.]*)\s+days?\b/gi, fields: ["from_after"], what: "days the donor keeps" },
  { re: /\b(?:reach(?:es|ing)?|bring(?:s|ing)?\s+\w+\s+to|rise\s+to|rises\s+to|give\s+\w+(?:\s+\w+)?)\s+(\d[\d.]*)\s+days?\b/gi, fields: ["to_after"], what: "days after the transfer" },
];

type Signal = Case["chain"][number]["plants"][number]["signals"][number];

/** Every FDA action the case holds, with the plant it was at. */
function caseSignals(c: Case): { plant: string; s: Signal }[] {
  return (c.chain ?? []).flatMap((pc) => pc.plants.flatMap((p) => p.signals.map((s) => ({ plant: p.name.toLowerCase(), s }))));
}

const ACTION_KINDS: [RegExp, Signal["kind"][]][] = [
  [/warning letters?/i, ["warning_letter"]],
  [/import alerts?/i, ["import_alert"]],
  [/recalls?/i, ["recall"]],
  [/\bOAI\b/, ["inspection_oai"]],
  [/action|enforcement|signal|finding/i, ["inspection_oai", "warning_letter", "import_alert", "injunction", "seizure"]],
];

function absenceProblem(text: string, c: Case, named: string[], firms: Map<string, string>): string | null {
  const all = caseSignals(c);
  const scope = named.length ? all.filter((x) => named.some((k) => x.plant.includes(k))) : all;
  const who = named.length ? named.map((k) => firms.get(k)).join(" or ") : "our plants";
  // "before the posting" / "precedes": only actions dated before the case's posting count.
  const timed = /\b(before|precede[sd]?|prior to|ahead of|earlier than)\b/i.test(text) && c.shortage?.firstPosting;
  const inScope = (x: { s: Signal }) => !timed || x.s.date < c.shortage!.firstPosting!;
  const m = text.match(/\b(?:no|never|without any|zero|0)\s+(?:\w+\s+){0,2}?(warning letters?|import alerts?|recalls?|OAI|actions?|enforcement|signals?|findings?)\b/i);
  if (m) {
    const kinds = ACTION_KINDS.find(([re]) => re.test(m[1]))?.[1] ?? [];
    const hit = scope.find((x) => kinds.includes(x.s.kind) && inScope(x));
    if (hit) return `"${m[0]}" is false: the record holds ${hit.s.kind.replace(/_/g, " ")} ${hit.s.date} at ${hit.plant}`;
  }
  // "never inspected": false if any cited-or-case row is an FDA inspection of that plant.
  if (/\bnever (?:been )?inspected\b|\bno (?:FDA )?inspections?\b/i.test(text)) {
    const insp = Object.values(c.evidence ?? {}).find((e) => "inspection_id" in e.fields && (!named.length || named.some((k) => line(e).toLowerCase().includes(k))));
    if (insp) return `the record holds FDA inspection ${insp.fields.inspection_id} for ${who}`;
  }
  const only = text.match(/\bonly\s+(?:\w+\s+){0,2}?(VAI|NAI)\b/);
  if (only) {
    const worse = scope.find((x) => x.s.kind === "inspection_oai" || (only[1] === "NAI" && x.s.kind === "inspection_vai"));
    if (worse) return `"${only[0]}" is false for ${who}: the record holds ${worse.s.kind.replace(/_/g, " ")} ${worse.s.date}`;
    if (only[1] === "VAI" && named.length) {
      const nai = Object.values(c.evidence).find((e) => /\bNAI\b/.test(String(e.fields.classification ?? "")) && named.some((k) => line(e).toLowerCase().includes(k)));
      if (nai) return `"${only[0]}" is false for ${who}: the record holds an NAI inspection (${nai.id})`;
    }
  }
  return null;
}

const EVENTS: [RegExp, RegExp][] = [
  [/\bwarning letter/i, /warning letter/i],
  [/\bimport alert/i, /import alert/i],
  [/\brecall/i, /recall/i],
  [/\b(?:classification )?letter\b|\bFMD-145\b/i, /letter/i],
  [/\binspection\b/i, /inspection/i],
];

export function verifySentence(s: Sentence, c: Case): string | null {
  if (!s.cites?.length) return "cites nothing";
  const unknown = s.cites.filter((id) => !c.evidence[id]);
  if (unknown.length) return `cites unknown evidence ${unknown.join(", ")}`;
  const lines = citedLines(s, c);
  const hay = lines.join(" ");
  const low = hay.toLowerCase();
  s = { ...s, text: shortClasses(s.text) };
  const text = normal(s.text);
  if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}\/\d{1,2}\/\d{1,2}\b/.test(s.text)) return "dates must be written as the evidence writes them (YYYY-MM-DD)";
  // "no longer on the list", "off the list": an ending the record must state.
  const ended = s.text.match(/\bno longer (?:on|listed|in shortage|short)\b|\boff (?:the|FDA'?s) (?:shortage )?list\b|\bremoved from\b|\b(?:has|have) ended\b|\bis over\b|\bcleared\b/i);
  if (ended && !/resolved|not on fda'?s current|listed=no|not listed/i.test(hay)) return `"${ended[0]}" is a status the cited record does not state`;
  // An inspection the sentence says was "not classified VAI" must not be VAI in its cited row.
  for (const m of s.text.matchAll(/\b(\d{6,8})\b[^.]*?\bnot\s+(?:been\s+)?classified\s+(OAI|VAI|NAI)\b/g)) {
    if (lines.some((l) => l.includes(m[1]) && new RegExp(`\\b${m[2]}\\b`).test(l))) return `inspection ${m[1]} was classified ${m[2]} in the cited row`;
  }

  for (const d of datesIn(s.text)) {
    if (d.iso && !hay.includes(d.iso)) return `date ${d.iso} is not in the cited evidence`;
    if (d.ym && !hay.includes(d.ym)) return `month ${d.ym} is not in the cited evidence`;
  }
  for (const n of numbersIn(s.text)) if (!has(hay, n)) return `number ${n} is not in the cited evidence`;
  for (const n of smallCounts(s.text)) if (!has(hay, n)) return `count ${n} is not in the cited evidence`;
  const word = s.text.match(NUMBER_WORDS);
  if (word) return `"${word[1]}" is a number in words; numbers must be digits from the evidence`;

  // A stock figure must be the field it says it is ("holds 3.6" when 3.6 is the daily use fails).
  const cited = s.cites.map((id) => c.evidence[id]).filter(Boolean);
  // A transfer's direction must be the cited option's: "from Lakeside to East" is not "from East to Lakeside".
  for (const m of text.matchAll(/\bfrom (?:Corvale )?(General|East|Lakeside)\b.{0,40}?\bto (?:Corvale )?(General|East|Lakeside)\b/gi)) {
    const moves = cited.filter((e) => "from" in e.fields && "to" in e.fields);
    if (moves.length && !moves.some((e) => String(e.fields.from).endsWith(m[1]) && String(e.fields.to).endsWith(m[2]))) return `the cited transfer does not run from ${m[1]} to ${m[2]}`;
  }
  for (const fc of FIELD_CLAIMS) {
    for (const m of text.matchAll(fc.re)) {
      const v = num(m[1]);
      if (Number.isNaN(v)) continue;
      // The figure belongs to the hospital named just before it, when the sentence names one.
      const site = [...text.slice(0, m.index!).matchAll(/\b(General|East|Lakeside)\b/g)].pop()?.[1];
      const holders = cited.filter((e) => fc.fields.some((f) => f in e.fields) && (!site || !e.fields.hospital || String(e.fields.hospital).endsWith(site)));
      if (site && !holders.length && cited.some((e) => fc.fields.some((f) => f in e.fields))) return `no cited row gives Corvale ${site} that ${fc.what} figure`;
      if (!holders.length) continue;
      if (!holders.some((e) => fc.fields.some((f) => same(num(e.fields[f]), v)))) return `${m[1]} is not the ${fc.what} figure in the cited rows`;
    }
  }

  // Day gaps: the line that holds "N days before" must be about the event the sentence names, in the same direction.
  // When the posting is the subject ("FDA posted the shortage 23 days before the letter"), the direction flips.
  for (const m of text.matchAll(/(\d[\d.]*)\s+(days?|weeks?|months?|years?)\s+(before|after|earlier|later|ahead of|prior to)\b/gi)) {
    let dir = /before|earlier|ahead|prior/i.test(m[3]) ? "before" : "after";
    const lead = text.slice(0, m.index!), tail = text.slice(m.index! + m[0].length);
    if (/\bpost(?:ed|ing|s)?\b|\blist(?:ed|ing)\b/i.test(lead) && !/\bpost(?:ed|ing|s)?\b|\blist(?:ed|ing)\b/i.test(tail)) dir = dir === "before" ? "after" : "before";
    const n = m[1].replace(".", "\\.");
    const phrase = new RegExp(`(?<![\\d.])${n}\\s+\\w+\\s+${dir}`, "i");
    const holders = lines.filter((l) => phrase.test(l));
    if (!holders.length) {
      const other = dir === "before" ? "after" : "before";
      if (lines.some((l) => new RegExp(`(?<![\\d.])${n}\\s+\\w+\\s+${other}`, "i").test(l))) return `the evidence says ${m[1]} ${m[2]} ${other}, not ${dir}`;
      continue;
    }
    const named = EVENTS.filter(([inSentence]) => inSentence.test(s.text));
    if (named.length && !holders.some((l) => named.some(([, inLine]) => inLine.test(l)))) return `the ${m[1]}-${m[2]} gap in the cited rows is about a different event`;
    // The date the sentence gives with the gap must be the date that line measured it from: "letter dated
    // 2020-05-25, 819 days before" fails when 819 days is from the inspection's end date.
    const held = cited.filter((e, i) => phrase.test(lines[i]) && (e.fields.date || e.fields.letter));
    if (held.length) {
      const skip = new Set([...held.map((e) => String(e.fields.posted ?? "")), c.asOf]);
      const near = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].filter((d) => !skip.has(d[0]));
      const stated = near.filter((d) => d.index! < m.index!).pop() ?? near.find((d) => d.index! > m.index!);
      if (stated && !held.some((e) => [e.fields.date, e.fields.letter].map(String).includes(stated[0]))) {
        return `the ${m[1]}-${m[2]} gap in the cited rows is measured from ${held.map((e) => e.fields.date ?? e.fields.letter).join(" or ")}, not from ${stated[0]}`;
      }
    }
  }

  // A firm or plant named with an FDA action and a date: one cited line must hold the firm (or its FEI), the action
  // and that date. "Baxter's plant received a warning letter on 2017-02-14" fails when the letter went to Hospira.
  {
    const firmsHere = claimedFirms(s.text, c);
    const feis = [...s.text.matchAll(/\bFEI\s*#?\s*(\d{5,12})\b/gi)].map((x) => x[1]);
    const ids = [...firmsHere, ...feis];
    const acts = [...s.text.matchAll(/\b(warning letters?|import alerts?|OAI|recall(?:s|ed)?|injunctions?|seizures?)\b/gi)]
      .filter((x) => !negated(s.text, x.index!))
      .map((x) => x[1].toLowerCase().replace(/(?:s|ed)$/, "").replace(/^oai$/, "OAI"));
    if (ids.length && acts.length) {
      const words = [...new Set(acts)].map((a) => (a === "OAI" ? "\\bOAI\\b" : a.replace(/ /g, "\\s+")));
      if (/\b(VAI|NAI|inspect\w*)\b/.test(s.text)) words.push("\\bVAI\\b", "\\bNAI\\b", "inspection");
      const actRe = new RegExp(words.join("|"), "i");
      for (const d of datesIn(s.text)) {
        const tok = d.iso ?? d.ym!;
        if (tok === c.shortage?.firstPosting || tok === c.asOf) continue;
        const ok = lines.some((l) => l.includes(tok) && actRe.test(l) && ids.some((k) => l.toLowerCase().includes(k)));
        const who = new Map([...firmKeys(c), ...outsideFirms(s.text, c, firmKeys(c))]);
        if (!ok) return `no cited line gives ${ids.map((k) => who.get(k) ?? `FEI ${k}`).join(" or ")} the ${acts[0]} dated ${tok}`;
      }
    }
  }

  // A firm and the classification the sentence gives it must sit on one cited line.
  const firms = new Map([...firmKeys(c), ...outsideFirms(s.text, c, firmKeys(c))]);
  const named = claimedFirms(s.text, c);
  for (const key of named) if (!low.includes(key)) return `${firms.get(key)} is not in the cited evidence`;
  for (const k of claimedClasses(s.text)) {
    const re = new RegExp(`\\b${k}\\b`);
    if (!re.test(hay)) return `classification ${k} is not in the cited evidence`;
    if (named.length && !lines.some((l) => re.test(l) && named.some((key) => l.toLowerCase().includes(key)))) return `no cited line gives ${named.map((x) => firms.get(x)).join(" or ")} the classification ${k}`;
  }

  // A plant named only as the application's sponsor is not a manufacturing plant.
  if (/\bmanufactur|\bmade (?:by|at)\b|\bmakes\b|\bproduced\b/i.test(s.text)) {
    for (const key of named) {
      // Only lines where this firm is the plant, not the labeler of a product made elsewhere.
      const about = lines.filter((l) => new RegExp(`plant=[^;)]*\\b${key}`, "i").test(l));
      if (about.length && about.every((l) => /sponsor only|drugsfda_sponsor/i.test(l))) return `${firms.get(key)} is named only as the application's sponsor, not as a manufacturing plant`;
    }
  }

  // Absence claims are checked against the whole case, not just the cited lines: "no OAI", "only VAI",
  // "no FDA action ... before the posting" are false if the record holds one.
  const absence = absenceProblem(s.text, c, named, firms);
  if (absence) return absence;

  const cause = s.text.match(CAUSAL);
  if (cause && !negated(s.text, cause.index!) && !low.includes(cause[1].toLowerCase())) return `causal claim ("${cause[1]}") that the cited record does not make`;
  const status = s.text.match(STATUS);
  if (status && !negated(s.text, status.index!) && !low.includes(status[1].toLowerCase().slice(0, 6))) return `status claim ("${status[1]}") that the cited record does not make`;
  return null;
}

/** For text with no citations (the P&T memo): the same name, classification, sponsor, absence and status rules,
 *  checked against every row the case holds. */
export function caseClaimProblem(text: string, c: Case): string | null {
  text = shortClasses(text);
  const lines = Object.values(c.evidence ?? {}).map((e) => normal(line(e, true)));
  const low = lines.join(" ").toLowerCase();
  const firms = new Map([...firmKeys(c), ...outsideFirms(text, c, firmKeys(c))]);
  const named = claimedFirms(text, c);
  for (const key of named) if (!low.includes(key)) return `${firms.get(key)} is not in the case record`;
  for (const k of claimedClasses(text)) {
    const re = new RegExp(`\\b${k}\\b`);
    if (named.length ? !lines.some((l) => re.test(l) && named.some((key) => l.toLowerCase().includes(key))) : !re.test(low.toUpperCase()))
      return `no row in the case gives ${named.length ? named.map((x) => firms.get(x)).join(" or ") : "our plants"} the classification ${k}`;
  }
  if (/\bmanufactur|\bmade (?:by|at)\b|\bmakes\b|\bproduced\b/i.test(text)) {
    for (const key of named) {
      const about = lines.filter((l) => new RegExp(`plant=[^;)]*\\b${key}`, "i").test(l));
      if (about.length && about.every((l) => /sponsor only|drugsfda_sponsor/i.test(l))) return `${firms.get(key)} is named only as the application's sponsor, not as a manufacturing plant`;
    }
  }
  const absence = absenceProblem(text, c, named, firms);
  if (absence) return absence;
  const status = text.match(STATUS);
  if (status && !negated(text, status.index!) && !low.includes(status[1].toLowerCase().slice(0, 6))) return `status claim ("${status[1]}") that the case record does not make`;
  return null;
}
