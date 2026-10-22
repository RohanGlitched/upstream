// Saved investigations (data/cases/*.json): the hosted demo serves these when Zetaris is not reachable.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Case } from "../agent/types";
import type { Subgraph } from "../engines/world-model";

export type SavedCase = Case & { graph?: Subgraph };

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

export async function listCases(): Promise<CaseSummary[]> {
  let files: string[] = [];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: CaseSummary[] = [];
  for (const f of files) {
    const c = await getCase(f.replace(/\.json$/, ""));
    if (!c) continue;
    const days = c.stock.map((s) => s.days).filter((d): d is number => d !== null);
    out.push({
      slug: f.replace(/\.json$/, ""), question: c.question, molecule: c.molecule, state: c.explanation?.state ?? null,
      headline: c.explanation?.headline ?? null, minDays: days.length ? Math.min(...days) : null,
      status: c.shortage.status, firstPosting: c.shortage.firstPosting, askedAt: c.askedAt,
    });
  }
  return out.sort((a, b) => (a.minDays ?? 1e9) - (b.minDays ?? 1e9));
}

export async function getCase(slug: string): Promise<SavedCase | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    return JSON.parse(await readFile(path.join(DIR, `${slug}.json`), "utf8")) as SavedCase;
  } catch {
    return null;
  }
}

/** Which saved case answers a molecule, if any. */
export async function caseForMolecule(term: string): Promise<SavedCase | null> {
  const t = term.toLowerCase().trim();
  if (!t) return null;
  const direct = await getCase(t.split(/\s+/)[0]);
  if (direct) return direct;
  for (const s of await listCases()) if (s.molecule.includes(t) || t.includes(s.molecule.split(" ")[0])) return getCase(s.slug);
  return null;
}
