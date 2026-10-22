// Modified by Upstream (2026-10-22): embed() delegates to a swappable embedder (setEmbedder/activeEmbedder); the default FNV-1a 64-dim embedder is unchanged. See vendor/meterless/PROVENANCE.md.
// Deterministic mock embedder: FNV-1a hash per token into a 64-dim vector,
// summed and L2-normalized. Pure function of the input text, so retrieval
// scores are reproducible across runs and machines. Swap in a real provider
// by replacing embed() in your own implementation; the contract is just
// text -> number[].

const DIM = 64;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Upstream addition: a synchronous text -> unit-vector embedder. */
export interface EmbedderImpl {
  id: string;
  dim: number;
  embed(text: string): number[];
}

const hashEmbedder: EmbedderImpl = { id: "fnv1a-64", dim: DIM, embed: (t) => hashEmbed(t) };
let activeImpl: EmbedderImpl = hashEmbedder;

/** Upstream addition: swap the process-wide embedder used by add() and query(). Pass null to restore the default. */
export function setEmbedder(impl: EmbedderImpl | null): void {
  activeImpl = impl ?? hashEmbedder;
}

export function activeEmbedder(): EmbedderImpl {
  return activeImpl;
}

export function embed(text: string): number[] {
  return activeImpl.embed(text);
}

/** The original reference embedder (FNV-1a hash per token into 64 dims). */
export function hashEmbed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  for (const token of tokenize(text)) {
    const h = fnv1a(token);
    const idx = h % DIM;
    const sign = (h >>> 8) % 2 === 0 ? 1 : -1;
    const mag = 1 + ((h >>> 16) % 8) / 8;
    vec[idx] += sign * mag;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length); // Upstream: guard against mixed-dimension vectors
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // both vectors are unit-length
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}
