// Entity lexicon and slot normalisation for the Sense and Interpret stages.
// Drug names and NDCs are replaced by slot tokens ("drugname", "ndccode")
// before scoring, so "why is cisplatin short" and "why is carboplatin short"
// score identically, and the bound values are kept for Interpret.
//
// The built-in drug list is a broad list of commonly stocked hospital drugs
// (injectables and common orals, many of them recurrent FDA shortage items).
// In the app the lexicon is extended with the hospital formulary from
// Zetaris and the Drug entities already in World Model (Scout option
// `drugLexicon`). A suffix heuristic catches unlisted generic names.

export const DEFAULT_DRUGS: string[] = [
  "acetaminophen", "acetylcysteine", "acyclovir", "adenosine", "albumin", "albuterol", "alteplase", "amikacin", "amiodarone",
  "amoxicillin", "amphotericin b", "ampicillin", "atropine", "azithromycin", "bivalirudin", "bleomycin", "bumetanide",
  "bupivacaine", "buprenorphine", "calcium chloride", "calcium gluconate", "carboplatin", "cefazolin", "cefepime", "ceftriaxone",
  "chlorpromazine", "cisplatin", "clindamycin", "cyclophosphamide", "cytarabine", "dacarbazine", "daptomycin", "dexamethasone",
  "dexmedetomidine", "dextrose", "diazepam", "digoxin", "diltiazem", "diphenhydramine", "dobutamine", "dopamine", "doxorubicin",
  "enoxaparin", "epinephrine", "ertapenem", "esmolol", "etomidate", "etoposide", "famotidine", "fentanyl", "fluorouracil",
  "fluconazole", "fosphenytoin", "furosemide", "gemcitabine", "gentamicin", "glucagon", "haloperidol", "heparin",
  "hydralazine", "hydrocortisone", "hydromorphone", "ibuprofen", "insulin", "ipratropium", "irinotecan", "iron sucrose",
  "ketamine", "ketorolac", "labetalol", "lactated ringer", "levetiracetam", "levofloxacin", "lidocaine", "lorazepam",
  "magnesium sulfate", "mannitol", "meropenem", "methotrexate", "methylprednisolone", "metoclopramide", "metoprolol",
  "metronidazole", "midazolam", "milrinone", "morphine", "naloxone", "neostigmine", "nicardipine", "nitroglycerin",
  "norepinephrine", "normal saline", "octreotide", "ondansetron", "oxaliplatin", "oxytocin", "paclitaxel", "pantoprazole",
  "phenylephrine", "piperacillin", "potassium chloride", "potassium phosphate", "prochlorperazine", "promethazine",
  "propofol", "protamine", "remifentanil", "rocuronium", "ropivacaine", "sodium bicarbonate", "sodium chloride",
  "sterile water", "succinylcholine", "sugammadex", "tacrolimus", "tranexamic acid", "vancomycin", "vasopressin",
  "vecuronium", "vinblastine", "vincristine", "vitamin k", "zoledronic acid",
];

/** Generic-name suffixes; a word with one of these (and 6+ letters) is treated as a drug name. */
const DRUG_SUFFIX = /^[a-z]{3,}(platin|mycin|micin|cillin|cycline|floxacin|azole|parin|caine|pril|sartan|olol|statin|prazole|tidine|setron|azepam|zolam|tinib|ciclib|mab|vir|dronate|terol|triptan|fentanil|phine|sone|olone|semide|thiazide|dipine|xaban|gatran|rubicin|taxel|tecan|bine|lukast|navir)$/;

/** Words that look like drug suffix matches but are not drugs. */
const NOT_DRUGS = new Set(["none", "phone", "someone", "anyone", "everyone", "zone", "done", "alone", "combine", "machine", "online", "routine", "medicine", "decline", "baseline", "pipeline", "deadline", "guideline", "timeline", "fluorine"]);

export interface Normalised {
  /** lowercased text with slot tokens substituted */
  text: string;
  drugs: string[];
  ndcs: string[];
  numbers: number[];
  quantities: { value: number; unit: string }[];
}

const NDC_RE = /\b\d{4,5}-\d{3,4}(?:-\d{1,2})?\b/g;
const QTY_RE = /\b(\d[\d,]*)\s*(vials?|bags?|boxes?|units?|doses?|ampules?|ampoules?|syringes?|bottles?|cartons?|packs?|cases?|pens?|tablets?|caps?)\b/g;
const PROTECTED_NUMBERS = new Set(["483"]);

export class Lexicon {
  private readonly phrases: string[];

  constructor(drugs: string[] = DEFAULT_DRUGS) {
    this.phrases = [...new Set(drugs.map((d) => d.toLowerCase().trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  }

  extend(drugs: string[]): Lexicon {
    return new Lexicon([...this.phrases, ...drugs]);
  }

  normalise(input: string): Normalised {
    let t = ` ${input.toLowerCase().replace(/[‘’]/g, "'")} `;
    t = t.replace(/pharmacy\s+(and|&)\s+therapeutics/g, " p&t ").replace(/\bp\s*(&|and)\s*t\b/g, " p&t ");
    const ndcs: string[] = [];
    t = t.replace(NDC_RE, (m) => {
      ndcs.push(m);
      return " ndccode ";
    });
    const quantities: { value: number; unit: string }[] = [];
    for (const m of t.matchAll(QTY_RE)) quantities.push({ value: Number(m[1].replace(/,/g, "")), unit: m[2].replace(/e?s$/, "") });
    const drugs: string[] = [];
    for (const p of this.phrases) {
      const re = new RegExp(`(^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z])`, "g");
      t = t.replace(re, (_m, pre: string) => {
        drugs.push(p);
        return `${pre} drugname `;
      });
    }
    t = t.replace(/[a-z]+/g, (w) => {
      if (w.length >= 6 && DRUG_SUFFIX.test(w) && !NOT_DRUGS.has(w)) {
        drugs.push(w);
        return "drugname";
      }
      return w;
    });
    const numbers: number[] = [];
    t = t.replace(/\$?\b(\d[\d,]*(?:\.\d+)?)(k)?\b/g, (m, n: string, k?: string) => {
      if (PROTECTED_NUMBERS.has(n)) return m;
      numbers.push(Number(n.replace(/,/g, "")) * (k ? 1000 : 1));
      return " num ";
    });
    return { text: t.replace(/\s+/g, " ").trim(), drugs: [...new Set(drugs)], ndcs, numbers, quantities };
  }
}
