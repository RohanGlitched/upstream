// Shared, dependency-free text helpers for Upstream's engine layer: tokenising,
// light stemming, pharmacy synonyms and feature hashing. Used by the H-MEM
// embedder (hmem.ts) and the Scout Stage-1 scorer (scout/scoring.ts).

import path from "node:path";
import { fileURLToPath } from "node:url";

/** Upstream repo root (src/engines/.. /..), overridable for tests and deployments. */
export function upstreamRoot(): string {
  if (process.env.UPSTREAM_ROOT) return path.resolve(process.env.UPSTREAM_ROOT);
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  } catch {
    return process.cwd();
  }
}

/** Default state directory: <repo>/.state, or UPSTREAM_STATE_DIR. */
export function stateDir(...parts: string[]): string {
  const base = process.env.UPSTREAM_STATE_DIR ? path.resolve(process.env.UPSTREAM_STATE_DIR) : path.join(upstreamRoot(), ".state");
  return path.join(base, ...parts);
}

// Function words only. Negations ("not", "never", "no") and modal verbs that
// change meaning ("should") are deliberately NOT stop words.
export const STOP_WORDS = new Set(
  (
    "a an the of to for and or in on at is are was were be been being am me my our ours we us you your i it its " +
    "this that these those with from by about as into so then than there here what whats which who whom " +
    "do does did doing done have has had having will would can could shall may might must " +
    "up out over just also very really please any some all each every own same such too its it's let lets"
  ).split(/\s+/),
);

/** Light, deterministic suffix stripper. Not Porter; enough to merge plurals and -ing/-ed forms. */
export function stem(t: string): string {
  if (t.length <= 3 || /\d/.test(t)) return t;
  if (t.endsWith("ies") && t.length > 4) return t.slice(0, -3) + "y";
  if (t.endsWith("sses")) return t.slice(0, -2);
  if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3);
  if (t.endsWith("ed") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("es") && t.length > 4 && /(s|x|z|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) return t.slice(0, -1);
  return t;
}

/** Raw lowercase word split (keeps & so "p&t" survives; keeps digits). */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9&\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Content tokens: words minus stop words, stemmed, then mapped through a synonym table. */
export function contentTokens(text: string, synonyms: Record<string, string> = {}): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    if (STOP_WORDS.has(w)) continue;
    const s = stem(w);
    out.push(synonyms[w] ?? synonyms[s] ?? s);
  }
  return out;
}

/** Synonyms shared by memory and intent scoring. Keys are raw or stemmed words. */
export const PHARMACY_SYNONYMS: Record<string, string> = {
  short: "shortage",
  shortage: "shortage",
  backorder: "shortage",
  backordered: "shortage",
  outage: "shortage",
  unavailable: "shortage",
  substitute: "alternative",
  substitution: "alternative",
  interchange: "alternative",
  equivalent: "alternative",
  alternative: "alternative",
  approve: "approve",
  approval: "approve",
  approv: "approve",
  decid: "decide",
  decide: "decide",
  decision: "decide",
  ration: "conserve",
  restrict: "conserve",
  conservation: "conserve",
  conserv: "conserve",
  conserve: "conserve",
  manufacturer: "manufacture",
  manufactur: "manufacture",
  manufacture: "manufacture",
  vial: "unit",
  bag: "unit",
  box: "unit",
};

/** 32-bit FNV-1a. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Signed feature hashing of weighted string features into a unit vector. */
export function hashFeatures(features: Iterable<[string, number]>, dim: number): number[] {
  const vec = new Array<number>(dim).fill(0);
  for (const [f, w] of features) {
    const h = fnv1a(f);
    vec[h % dim] += ((h >>> 16) & 1 ? 1 : -1) * w;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map((v) => v / norm);
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
