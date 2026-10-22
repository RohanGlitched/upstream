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

/** A molecule search term from a free-text question: the drug word the buyer used. */
export function moleculeTerm(drug: string): string {
  return drug
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(injection|injectable|vials?|tablets?|mg|ml|solution|for|usp|hydrochloride|hcl|sodium|sulfate)\b/g, " ")
    .trim()
    .split(/\s+/)[0] ?? "";
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
