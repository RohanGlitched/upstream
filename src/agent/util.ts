// Small shared helpers for the investigator.

const SUFFIX =
  /\b(private|pvt|limited|ltd|llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|gmbh|ag|sa|s\.a|spa|s\.p\.a|srl|s\.r\.l|plc|bv|b\.v|nv|kg|kgaa|sas|s\.a\.s|ab|as|oy|pte|pty|sdn|bhd|kk|k\.k|lp|l\.p|usa|us|the|of|and|unit|plant|division|formulation|formulations|pharmaceuticals?|pharma|laboratories|laboratory|labs?|healthcare|industries|industry|international|holdings?|group|manufacturing|mfg)\b/g;

/** Firm name key, identical to data/fda/build_bundle.py norm(): the import-alert and recall join key. */
export function firmKey(s: string | null | undefined): string {
  let t = (s ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
  t = t.replace(/\(.*?\)/g, " ").replace(/&/g, " and ");
  t = t.replace(/[^a-z0-9 ]/g, " ").replace(SUFFIX, " ");
  return t.split(/\s+/).filter(Boolean).join(" ");
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** SQL IN-list of string literals. */
export function inList(values: Iterable<string>): string {
  const vs = [...new Set([...values].filter(Boolean))];
  return vs.length ? vs.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ") : "''";
}

// Words that are not the drug: dosage forms, packaging and units a buyer may type after the name.
const FORM_WORDS = /\b(injection|injectable|inj|vials?|tablets?|tabs?|capsules?|caps?|mg|mcg|ml|solution|for|usp|oral|iv|premix(ed)?|bags?|syringes?|ampules?|short|shortage)\b/g;

/** A molecule search term from a free-text drug name: every word of the active ingredient, forms and numbers
 *  dropped ("Calcium chloride 10% injection" -> "calcium chloride"). Salt words stay, so calcium chloride is
 *  never searched as "calcium" (which would pull in leucovorin calcium). */
export function moleculeTerm(drug: string): string {
  return drug
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, " ")
    .replace(FORM_WORDS, " ")
    .replace(/\b[0-9.]+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The dosage form a question names, if any, as a fragment of FDA's dosage_form ("inject", "tablet", "capsule"). */
export function formTerm(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(injection|injectable|inj|iv|vials?|infusion|premix(ed)?|bags?|syringes?)\b/.test(t)) return "inject";
  if (/\b(tablets?|tabs?)\b/.test(t)) return "tablet";
  if (/\b(capsules?|caps)\b/.test(t)) return "capsule";
  return null;
}

// Salt, ester and hydrate words that may sit next to an active ingredient without changing the molecule:
// "heparin" matches HEPARIN SODIUM, but "calcium chloride" never matches LEUCOVORIN CALCIUM.
export const SALTS = [
  "sodium", "disodium", "potassium", "dipotassium", "calcium", "magnesium", "hydrochloride", "dihydrochloride", "hcl",
  "hydrobromide", "sulfate", "sulphate", "phosphate", "acetate", "citrate", "chloride", "bromide", "besylate", "mesylate",
  "maleate", "tartrate", "bitartrate", "succinate", "fumarate", "gluconate", "lactate", "tromethamine", "bicarbonate",
  "carbonate", "nitrate", "hyclate", "propionate", "dipropionate", "valerate", "acetonide", "pamoate", "decanoate",
  "meglumine", "lysine", "anhydrous", "monohydrate", "dihydrate", "trihydrate", "hexahydrate", "base", "free",
];
const S = `(?:${SALTS.join("|")})`;
const SEP = "[^a-z0-9-]+";
// After the ingredient's words: the end of the name, or a word boundary. Anchoring at the start and matching whole
// words is what keeps "calcium chloride" off LEUCOVORIN CALCIUM and "atracurium" off CISATRACURIUM; what follows
// may be a strength, a form, a second ingredient or a family member (insulin glargine), split later by presentation.
const TAIL = `(?:$|[^a-z0-9-].*)`;

function core(term: string): string | null {
  const words = moleculeTerm(term).split(" ").filter(Boolean).map((w) => w.replace(/[^a-z0-9-]/g, ""));
  if (!words.length) return null;
  // A biosimilar's four-letter suffix (filgrastim-sndz) is the same molecule; pegfilgrastim is not.
  const w = words.map((x) => `${x}(?:-[a-z]{4})?`);
  // "Sterile water" and "water" are the same product on different labels: "sterile" is optional.
  if (words[0] === "sterile" && words.length > 1) w[0] = "(?:sterile)?";
  // Salt words before the ingredient sit in the same name ("potassium chloride"), never across a comma: "sodium
  // chloride, sodium lactate, potassium chloride" is Lactated Ringer's, not potassium chloride.
  return w.map((x, i) => (i === 0 ? `(?:${S} +)*${x}` : `${i === 1 && words[0] === "sterile" ? `(?:${SEP})?` : SEP}${x}`) + `(?:${SEP}${S})*`).join("");
}

/** Java/JS regex (no backslashes, so it survives a Lightning SQL literal) matching a lower-cased generic name or
 *  stock description whose first active ingredient is the term: every word, whole words only, salts allowed. */
export function moleculeRegex(term: string): string {
  const c = core(term);
  // A cabinet description may lead with its strength ("2% lidocaine hcl").
  return c ? `^(?:[0-9.,]+ ?%?${SEP})?${c}${TAIL}` : "^$";
}

/** The same ingredient anywhere in a longer text (a recall's product description), still on word boundaries. */
export function moleculeFindRegex(term: string): string {
  const c = core(term);
  return c ? `(?:^|[^a-z0-9-])${c}(?:[^a-z0-9-]|$)` : "^$";
}

export function round(n: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** FDA's own Tall Man casing for look-alike names (FDA and ISMP list), used in headings. */
const TALL_MAN: Record<string, string> = {
  carboplatin: "CARBOplatin", cisplatin: "CISplatin", vinblastine: "vinBLAStine", vincristine: "vinCRIStine",
  hydralazine: "hydrALAZINE", hydroxyzine: "hydrOXYzine", hydromorphone: "HYDROmorphone", dobutamine: "DOBUTamine",
  dopamine: "DOPamine", nifedipine: "NIFEdipine", nicardipine: "niCARdipine", oxcarbazepine: "OXcarbazepine",
  carbamazepine: "carBAMazepine", pentobarbital: "PENTobarbital", phenobarbital: "PHENobarbital",
  glipizide: "glipiZIDE", glyburide: "glyBURIDE", prednisone: "predniSONE", prednisolone: "prednisoLONE",
  methylprednisolone: "methylPREDNISolone", ketorolac: "KETorolac",
};

export function tallMan(name: string): string {
  return name.replace(/[A-Za-z]+/g, (w) => TALL_MAN[w.toLowerCase()] ?? w);
}

// Words that do not name a drug on their own: "sodium bicarbonate", "insulin glargine" are the drugs.
const SALT_FIRST = new Set(["sodium", "potassium", "calcium", "magnesium", "sterile", "ferric", "zinc", "insulin"]);
/** Base molecule: first word, or first two when the first is a salt word ("sodium bicarbonate", "insulin aspart"). */
export function baseMolecule(name: string): string {
  const w = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!w.length) return name;
  // A label that says only "water" is sterile water for injection: one drug, one case.
  if (w[0] === "water") return "sterile water";
  return SALT_FIRST.has(w[0]) && w[1] ? `${w[0]} ${w[1]}` : w[0];
}

// Words in a product name that are not an ingredient: the form, the container, a preservative note.
const FORM_START = /\b(injections?|injectable|intraperitoneal|tablets?|capsules?|solutions?|suspensions?|irrigant|irrigation|concentrate|for (?:injection|oral|suspension|solution)|cream|ointment|gel|lotion|powder|oral|ophthalmic|topical|inhalation|aerosol|premix\w*|in plastic|kit|extended|delayed|film|usp|vials?|bags?|syringes?)\b/i;
const NOT_INGREDIENT = /preservative|\bfree\b|sulfite|plastic|container|\bdose\b|ready|bulk|pharmacy|package|cartridge|\bpen\b|lyophil|liposom|release|coated|chewable|disintegrating/i;
const SALT_SET = new Set(SALTS);

/** The ingredients a product or listing name holds, each without its salt ("lidocaine hydrochloride and epinephrine"
 *  -> {epinephrine, lidocaine}; a name that is only salt words keeps them: "potassium chloride"). */
export function ingredientsOf(name: string): string[] {
  let t = name.toLowerCase();
  const at = t.search(FORM_START);
  if (at > 0) t = t.slice(0, at);
  const out = new Set<string>();
  for (const piece of t.split(/,|\band\b|\bwith\b|\bin\b|\/|\+|;/)) {
    if (NOT_INGREDIENT.test(piece)) continue;
    const words = piece.replace(/[0-9.]+ ?%?/g, " ").replace(/[^a-z -]/g, " ").split(/\s+/).filter((x) => x.length > 1);
    if (!words.length) continue;
    const core = words.filter((x) => !SALT_SET.has(x));
    out.add((core.length ? core : words).join(" "));
  }
  return [...out].sort();
}
