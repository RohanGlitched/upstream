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

/** The molecule as a buyer says it, with FDA's Tall Man casing and without the salt. */
export function drugTitle(molecule: string): string {
  const base = molecule
    .replace(/\b(hydrochloride|hcl|sodium|sulfate|citrate|acetate|phosphate)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const t = tallMan(base || molecule);
  // Lower-case names get a capital first letter in headings; Tall Man names keep their casing.
  const first = t.split(/\s+/)[0];
  return first === first.toLowerCase() ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export function drugFull(molecule: string): string {
  return tallMan(molecule);
}

/** Re-case drug names inside a free sentence (the model writes "Carboplatin"; the label says CARBOplatin). */
export function tallText(text: string): string {
  return tallMan(text);
}

export function slugFor(molecule: string): string {
  return (molecule.toLowerCase().match(/[a-z0-9-]+/)?.[0] ?? "").slice(0, 60);
}
