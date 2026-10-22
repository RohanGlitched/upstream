// Drug names and the small syringe-label class marks (ASTM D4774 / ISO 26825) shown beside them.
import { tallMan } from "../../src/agent/util";

export type SyringeClass =
  | "induction"
  | "benzodiazepine"
  | "opioid"
  | "neuromuscular"
  | "vasopressor"
  | "local"
  | "anticholinergic"
  | "antiemetic";

export const SYRINGE_LABEL: Record<SyringeClass, string> = {
  induction: "Induction agent",
  benzodiazepine: "Benzodiazepine",
  opioid: "Opioid",
  neuromuscular: "Neuromuscular blocker",
  vasopressor: "Vasopressor",
  local: "Local anaesthetic",
  anticholinergic: "Anticholinergic",
  antiemetic: "Antiemetic",
};

const CLASS_OF: Record<string, SyringeClass> = {
  propofol: "induction", ketamine: "induction", etomidate: "induction", methohexital: "induction", thiopental: "induction",
  midazolam: "benzodiazepine", lorazepam: "benzodiazepine", diazepam: "benzodiazepine",
  fentanyl: "opioid", morphine: "opioid", hydromorphone: "opioid", sufentanil: "opioid", remifentanil: "opioid",
  meperidine: "opioid", alfentanil: "opioid",
  rocuronium: "neuromuscular", vecuronium: "neuromuscular", succinylcholine: "neuromuscular",
  cisatracurium: "neuromuscular", atracurium: "neuromuscular", pancuronium: "neuromuscular",
  norepinephrine: "vasopressor", phenylephrine: "vasopressor", ephedrine: "vasopressor", vasopressin: "vasopressor",
  epinephrine: "vasopressor", dopamine: "vasopressor",
  lidocaine: "local", bupivacaine: "local", ropivacaine: "local", mepivacaine: "local", chloroprocaine: "local",
  atropine: "anticholinergic", glycopyrrolate: "anticholinergic",
  ondansetron: "antiemetic", granisetron: "antiemetic", dexamethasone: "antiemetic", metoclopramide: "antiemetic",
};

export function syringeClass(molecule: string): SyringeClass | null {
  for (const w of molecule.toLowerCase().split(/[^a-z]+/)) {
    if (CLASS_OF[w]) return CLASS_OF[w];
  }
  return null;
}

// Salt and ester words dropped from a heading ("fentanyl citrate" is said "fentanyl").
const SALT = /\b(hydrochloride|hcl|sodium|sulfate|citrate|acetate|phosphate|bromide|besylate|tartrate|mesylate)\b/gi;
// When the name starts with a mineral, the salt is the active ingredient: "sodium chloride" stays whole.
const MINERAL = /^(sodium|potassium|calcium|magnesium|ammonium|zinc|ferrous|ferric|lithium)\b/i;

/** The molecule as a buyer says it, with FDA's Tall Man casing and without the salt (unless the salt is the drug). */
export function drugTitle(molecule: string): string {
  const base = MINERAL.test(molecule.trim()) ? molecule.trim() : molecule.replace(SALT, "").replace(/\s+/g, " ").trim();
  const t = tallMan(base || molecule);
  // Lower-case names get a capital first letter in headings; Tall Man names keep their casing.
  const first = t.split(/\s+/)[0];
  return first === first.toLowerCase() ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

// Formulary lines whose generic name is not what a buyer calls the product.
const PRODUCT: [RegExp, string][] = [
  [/^(sterile )?water\b/i, "Sterile water for injection"],
  [/^bacteriostatic( water)?\b/i, "Bacteriostatic water for injection"],
  [/^isoleucine, leucine/i, "Amino acid injection (TrophAmine)"],
  [/^valine, lysine/i, "Amino acid injection (ProSol)"],
  [/^polyethylene glycol/i, "Polyethylene glycol 3350 with electrolytes"],
  [/^soybean oil/i, "Soybean oil lipid emulsion"],
  [/^technetium/i, "Technetium Tc 99m pyrophosphate"],
];

/** A formulary line as a buyer names the product: "Sterile water for injection", not "Water". */
export function productName(name: string): string {
  const d = name.trim();
  for (const [re, label] of PRODUCT) if (re.test(d)) return label;
  const parts = d.split(/,\s*|\s+and\s+/);
  return drugTitle(parts.length > 3 ? `${parts[0]} combination` : d);
}

export function drugFull(molecule: string): string {
  return tallMan(molecule);
}

/** Re-case drug names inside a free sentence (the model writes "Carboplatin"; the label says CARBOplatin). */
export function tallText(text: string): string {
  return tallMan(text);
}

/** The address a molecule's recording would have: the whole name, hyphenated ("sodium chloride" is sodium-chloride).
 *  Prefer the slug a recording carries; this is the fallback for a live answer. */
export function slugFor(molecule: string): string {
  return molecule.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
