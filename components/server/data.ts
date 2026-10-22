// Server-side reads for pages. Every read is defensive: a missing file gives a designed empty state, not a crash.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getCase, listCases, type CaseSummary, type SavedCase } from "../../src/lib/cases";

const ROOT = process.cwd();

export async function readJson<T>(rel: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(ROOT, rel), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function readText(rel: string): Promise<string | null> {
  try {
    return await readFile(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

export async function listDir(rel: string): Promise<string[]> {
  try {
    return await readdir(path.join(ROOT, rel));
  } catch {
    return [];
  }
}

/** Saved investigations that actually ran (a refused or empty recording is not a case). */
export async function realCases(): Promise<CaseSummary[]> {
  const all = await listCases();
  return all.filter((c) => c.molecule && c.molecule.trim().length > 0);
}

export async function loadCase(slug: string): Promise<SavedCase | null> {
  const c = await getCase(slug);
  if (!c || !c.molecule) return null;
  return c;
}

export async function loadAllCases(): Promise<{ slug: string; c: SavedCase }[]> {
  const out: { slug: string; c: SavedCase }[] = [];
  for (const s of await realCases()) {
    const c = await getCase(s.slug);
    if (c) out.push({ slug: s.slug, c });
  }
  return out;
}

export interface FdaManifest {
  built: string;
  counts: Record<string, number>;
  spl_sets?: number;
}

export async function fdaManifest(): Promise<FdaManifest | null> {
  return readJson<FdaManifest>("data/fda/bundle/manifest.json");
}

export function isLive(): boolean {
  return process.env.UPSTREAM_LIVE === "1";
}
