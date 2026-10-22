// Saved investigations (data/cases/*.json): the hosted demo serves these when Zetaris is not reachable.
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Case } from "../agent/types";
import type { Subgraph } from "../engines/world-model";
import { withLineage } from "./lineage";

/** A recording, with the file name it was saved under (the address of its page: /case/<slug>). */
export type SavedCase = Case & { graph?: Subgraph; slug?: string };

const DIR = path.join(process.cwd(), "data", "cases");

export interface CaseSummary {
  slug: string;
  question: string;
  molecule: string;
  state: string | null;
  headline: string | null;
  minDays: number | null;
  status: string | null;
  firstPosting: string | null;
  askedAt: string;
}

// Parsed recordings and their summaries, kept per file version (mtime and size). Recordings are rewritten while
// the server runs (a re-record), so every read checks the file first; a stat is far cheaper than a parse.
const summaries = new Map<string, { v: string; s: CaseSummary }>();
const parsed = new Map<string, { v: string; c: SavedCase }>();

async function version(slug: string): Promise<string> {
  try {
    const st = await stat(path.join(DIR, `${slug}.json`));
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "missing";
  }
}

export async function listCases(): Promise<CaseSummary[]> {
  let files: string[] = [];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: CaseSummary[] = [];
  for (const f of files) {
    const slug = f.replace(/\.json$/, "");
    // Every page's footer and index reads this list: keep each summary until its file changes on disk.
    const v = await version(slug);
    const hit = summaries.get(slug);
    if (hit && hit.v === v) {
      out.push(hit.s);
      continue;
    }
    const c = await getCase(slug);
    if (!c) continue;
    // The shortest shelf is per presentation and hospital when the case has them (older recordings: per line).
    const days = (c.presentations?.length ? c.presentations.flatMap((p) => p.hospitals.map((h) => h.days)) : c.stock.map((s) => s.days))
      .filter((d): d is number => d !== null);
    const sum: CaseSummary = {
      slug, question: c.question, molecule: c.molecule, state: c.explanation?.state ?? null,
      headline: c.explanation?.headline ?? null, minDays: days.length ? Math.min(...days) : null,
      status: c.shortage.status, firstPosting: c.shortage.firstPosting, askedAt: c.askedAt,
    };
    summaries.set(slug, { v, s: sum });
    out.push(sum);
  }
  return out.sort((a, b) => (a.minDays ?? 1e9) - (b.minDays ?? 1e9));
}

/** Whether a recording is on file, without reading it (some are a megabyte). */
export async function caseExists(slug: string): Promise<boolean> {
  if (!/^[a-z0-9-]+$/.test(slug)) return false;
  try {
    await access(path.join(DIR, `${slug}.json`));
    return true;
  } catch {
    return false;
  }
}

export async function getCase(slug: string): Promise<SavedCase | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const v = await version(slug);
  if (v === "missing") return null;
  const hit = parsed.get(slug);
  if (hit && hit.v === v) return hit.c;
  try {
    // Lineage is recomputed from each query's SQL: older recordings stored truncated source names.
    const c = withLineage(JSON.parse(await readFile(path.join(DIR, `${slug}.json`), "utf8")) as SavedCase);
    c.slug = slug;
    parsed.set(slug, { v, c });
    return c;
  } catch {
    return null;
  }
}

// Words that name a salt, an ion or a form. On their own they never pick a case: "sodium" is in a dozen products.
const SALT_WORDS = new Set(["sodium", "potassium", "calcium", "magnesium", "chloride", "sulfate", "acetate", "phosphate", "citrate", "hydrochloride", "hcl", "bromide", "water", "injection", "and"]);

const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** True when the words of `name` appear, in order and adjacent, in `term`. */
const containsPhrase = (term: string, name: string) => ` ${words(term).join(" ")} `.includes(` ${words(name).join(" ")} `);

/** Which saved case answers a molecule, if any: the whole name first, then the longest name on file that the
 *  term contains, then the shortest molecule the term begins. A bare salt word ("sodium") never picks a case. */
export async function caseForMolecule(term: string): Promise<SavedCase | null> {
  const t = words(term).join(" ");
  if (!t) return null;
  // The whole name first: "sodium bicarbonate" must not land on the sodium chloride case through "sodium".
  const whole = await getCase(slugOf(t));
  if (whole) return whole;
  const all = await listCases();
  // Each file answers to its own name (from the slug) and then to the molecule recorded inside it. File names
  // come first, so a tie goes to the file named for the drug (the sort below is stable).
  const names = [
    ...all.map((s) => ({ slug: s.slug, name: s.slug.replace(/-/g, " ") })),
    ...all.map((s) => ({ slug: s.slug, name: words(s.molecule).join(" ") })),
  ].filter((n) => n.name);
  const exact = names.find((n) => n.name === t);
  if (exact) return getCase(exact.slug);
  const contained = names
    .filter((n) => containsPhrase(t, n.name) && !SALT_WORDS.has(n.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (contained) return getCase(contained.slug);
  if (words(t).every((w) => SALT_WORDS.has(w))) return null;
  const begun = names.filter((n) => n.name.startsWith(`${t} `)).sort((a, b) => a.name.length - b.name.length)[0];
  return begun ? getCase(begun.slug) : null;
}

// Brand names buyers say, mapped to the generic. Only common ones; the rest fall to spelling suggestions.
const BRANDS: Record<string, string> = {
  ozempic: "semaglutide", wegovy: "semaglutide", rybelsus: "semaglutide", mounjaro: "tirzepatide", zepbound: "tirzepatide",
  trulicity: "dulaglutide", victoza: "liraglutide", saxenda: "liraglutide", tylenol: "acetaminophen", ofirmev: "acetaminophen",
  advil: "ibuprofen", motrin: "ibuprofen", lasix: "furosemide", eliquis: "apixaban", xarelto: "rivaroxaban", pradaxa: "dabigatran",
  lipitor: "atorvastatin", zofran: "ondansetron", diprivan: "propofol", versed: "midazolam", ativan: "lorazepam", valium: "diazepam",
  xanax: "alprazolam", narcan: "naloxone", keppra: "levetiracetam", coumadin: "warfarin", plavix: "clopidogrel", zosyn: "piperacillin",
  rocephin: "ceftriaxone", ancef: "cefazolin", decadron: "dexamethasone", toradol: "ketorolac", benadryl: "diphenhydramine",
  levophed: "norepinephrine", precedex: "dexmedetomidine", neupogen: "filgrastim", neulasta: "pegfilgrastim", paraplatin: "carboplatin",
  taxol: "paclitaxel", taxotere: "docetaxel", adriamycin: "doxorubicin", gemzar: "gemcitabine", lovenox: "enoxaparin", bridion: "sugammadex",
  zithromax: "azithromycin", cipro: "ciprofloxacin", levaquin: "levofloxacin", flagyl: "metronidazole", protonix: "pantoprazole",
  nexium: "esomeprazole", prilosec: "omeprazole", pepcid: "famotidine", zoloft: "sertraline", prozac: "fluoxetine", lyrica: "pregabalin",
  neurontin: "gabapentin", lantus: "insulin", humalog: "insulin", novolog: "insulin", tamiflu: "oseltamivir", zyprexa: "olanzapine",
  seroquel: "quetiapine", haldol: "haloperidol", dilaudid: "hydromorphone", ultram: "tramadol", cardizem: "diltiazem", lopressor: "metoprolol",
  zestril: "lisinopril", norvasc: "amlodipine", activase: "alteplase", angiomax: "bivalirudin", cubicin: "daptomycin", zyvox: "linezolid",
  keytruda: "pembrolizumab", humira: "adalimumab",
};

// The words a question is made of that are not the drug.
const STOP = new Set(
  (
    "why is are was the a an short shortage shortages shorted out of what do does we our us about for on in at to again and or how many much " +
    "days day have has left tell me there it its supply supplied stock stocks drug drugs medicine whats going happening still so now today this " +
    "week explain please can could you hospital hospitals corvale backorder backordered back ordered allocation allocated available availability " +
    "running run low who makes made where from vial vials injection injections tablet tablets bag bags any options option should i get find s"
  ).split(" "),
);

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export interface Clarify {
  /** What the buyer seems to have named, as typed. */
  term: string | null;
  /** The generic, when the term is a brand we know. */
  generic: string | null;
  /** True when that drug is on the formulary list Scout reads. */
  onFormulary: boolean;
  /** Close formulary names, best first. */
  suggestions: string[];
}

/** When Scout cannot tell which drug a question names: what it looked like, and close names on the formulary. */
export function clarifyDrug(question: string, formulary: string[]): Clarify {
  const toks = words(question).filter((w) => !STOP.has(w) && !/^\d+$/.test(w));
  const term = toks.length ? toks.slice(0, 3).join(" ") : null;
  if (!term) return { term: null, generic: null, onFormulary: false, suggestions: [] };
  const plain = [...new Set(formulary.map((f) => words(f).join(" ")).filter((f) => f && f.split(" ").length <= 3))];
  const generic = toks.map((w) => BRANDS[w]).find(Boolean) ?? null;
  const target = generic ?? term;
  const onFormulary = plain.includes(target);
  const stem = (q: string, w: string) => {
    let s = 0;
    while (s < Math.min(q.length, w.length) && q[q.length - 1 - s] === w[w.length - 1 - s]) s++;
    let p = 0;
    while (p < Math.min(q.length, w.length) && q[p] === w[p]) p++;
    return Math.max(s, p);
  };
  const score = (name: string) => {
    let best = Infinity;
    for (const q of [target, ...toks]) {
      for (const w of new Set([name, name.split(" ")[0]])) {
        // A shared stem of five letters at either end ("sema-glutide", "lira-glutide") counts as close.
        const d = (distance(q, w) / Math.max(q.length, w.length)) * (stem(q, w) >= 5 ? 0.45 : 1);
        best = Math.min(best, d);
      }
    }
    return best;
  };
  const suggestions = plain
    .filter((name) => name !== target)
    .map((name) => ({ name, s: score(name) }))
    .filter((x) => x.s <= 0.4)
    .sort((a, b) => a.s - b.s || a.name.length - b.name.length)
    .filter((x, i, arr) => arr.findIndex((y) => y.name.split(" ")[0] === x.name.split(" ")[0]) === i)
    .slice(0, 5)
    .map((x) => x.name);
  if (onFormulary) suggestions.unshift(target);
  return { term, generic, onFormulary, suggestions };
}
