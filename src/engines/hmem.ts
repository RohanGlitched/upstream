// Upstream's H-MEM layer: episodic memory of shortage investigations and
// pharmacist / P&T decisions, built on the vendored Meterless H-MEM reference
// (vendor/meterless/hmem, Apache-2.0, commit 1742dec).
//
// What this adds over the reference, each tied to a verified pitfall in
// research/METERLESS.md section 6:
//   1. A workable recall threshold (pitfall 1). The reference default 0.35
//      returns nothing for relevant pharmacy queries; RECALL_THRESHOLD below is
//      calibrated in src/engines/test/hmem.test.ts and reported in the README.
//   2. A better local embedder behind an interface (pharmaEmbedder, 256-dim
//      hashed lexical features with stemming, synonyms and char 4-grams), plus
//      a cached adapter for a remote embedder (e.g. NVIDIA Nemotron embeddings)
//      that is primed asynchronously, because the engine calls embed() synchronously.
//   3. Plain-word tags (pitfall 2) derived with the same tokeniser as queries.
//   4. supersede(oldId, newRecord) (pitfall 3): links supersedes/supersededBy,
//      sends "wrong" feedback to the old record, and recall drops superseded
//      records by default (or labels them).
//   5. Per-approver attribution (pitfall 4): every write runs under the named
//      approver as the ledger actor (withActor), and the approver is also
//      stamped into provenance.label and provenance.refs.
//
// The exported HMEM class is what the Meterless conformance runner loads
// (scripts/run-conformance.mjs). It is in-memory unless persistDir is given;
// openMemory() is the app entry point and persists under .state/hmem.

import fs from "node:fs";
import path from "node:path";
import {
  HMEM as BaseHMEM,
  activeEmbedder,
  setEmbedder,
  type EmbedderImpl,
  type HMEMOptions,
  type LedgerEntry,
  type MemoryRecord,
  type QueryResult,
  type RetrievedMemory,
} from "../../vendor/meterless/hmem/reference/src/index.ts";
import type { AddInput } from "../../vendor/meterless/hmem/reference/src/memoryStore.ts";
import { PHARMACY_SYNONYMS, contentTokens, hashFeatures, slug, stateDir, words } from "./text.ts";
import { quoteDecision } from "./decision-text.ts";
export { quoteDecision, parseDecisionContent, DECISION_QUOTE_MAX } from "./decision-text.ts";

export * from "../../vendor/meterless/hmem/reference/src/index.ts";
export type { AddInput } from "../../vendor/meterless/hmem/reference/src/memoryStore.ts";

// ------------------------------------------------------------------ embedders

/** Tokens used for both memory text and queries, so tags, keywords and features line up. */
export function memoryTokens(text: string): string[] {
  return contentTokens(text, PHARMACY_SYNONYMS);
}

/**
 * Local embedder: signed feature hashing of unigrams (1.0), bigrams (0.6) and
 * character 4-grams of words with 6+ letters (0.25) into 256 dims. It is a
 * lexical model, not a neural embedding: it rewards shared words, stems,
 * synonyms and drug-name morphology ("...platin"), nothing more.
 */
export const pharmaEmbedder: EmbedderImpl = {
  id: "upstream-lex-256-v1",
  dim: 256,
  embed(text: string): number[] {
    const toks = memoryTokens(text);
    const feats: [string, number][] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      feats.push([`u:${t}`, 1]);
      if (i + 1 < toks.length) feats.push([`b:${t}_${toks[i + 1]}`, 0.6]);
      if (t.length >= 6) for (let j = 0; j + 4 <= t.length; j++) feats.push([`c:${t.slice(j, j + 4)}`, 0.25]);
    }
    return hashFeatures(feats, 256);
  },
};

/** A remote embedder (async, batched). */
export interface RemoteEmbedder {
  id: string;
  dim: number;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export type PrimableEmbedder = EmbedderImpl & { prime(texts: string[]): Promise<void>; cacheSize(): number };

/**
 * Wrap an async remote embedder so the engine can call it synchronously.
 * Every text must be primed first; an unprimed text throws instead of
 * silently mixing vector spaces. UpstreamMemory primes before each write/query.
 */
export function cachedEmbedder(remote: RemoteEmbedder, maxEntries = 20_000): PrimableEmbedder {
  const cache = new Map<string, number[]>();
  const unit = (v: number[]) => {
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return n === 0 ? v : v.map((x) => x / n);
  };
  return {
    id: remote.id,
    dim: remote.dim,
    embed(text: string): number[] {
      const hit = cache.get(text);
      if (!hit) throw new Error(`cachedEmbedder(${remote.id}): text was not primed before a synchronous embed()`);
      return hit;
    },
    async prime(texts: string[]): Promise<void> {
      const missing = [...new Set(texts)].filter((t) => !cache.has(t));
      for (let i = 0; i < missing.length; i += 64) {
        const batch = missing.slice(i, i + 64);
        const vecs = await remote.embedBatch(batch);
        if (vecs.length !== batch.length) throw new Error(`cachedEmbedder(${remote.id}): got ${vecs.length} vectors for ${batch.length} texts`);
        batch.forEach((t, k) => {
          if (vecs[k].length !== remote.dim) throw new Error(`cachedEmbedder(${remote.id}): expected dim ${remote.dim}, got ${vecs[k].length}`);
          cache.set(t, unit(vecs[k]));
        });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
      }
    },
    cacheSize: () => cache.size,
  };
}

/**
 * OpenAI-compatible /embeddings adapter (NVIDIA API catalog / NIM). Unit-tested
 * against a fake fetch only; not exercised against the live API in this repo.
 */
export function openAICompatibleEmbedder(opts: {
  model: string;
  dim: number;
  apiKey?: string;
  baseUrl?: string;
  inputType?: "passage" | "query";
  fetchFn?: typeof fetch;
}): RemoteEmbedder {
  const base = (opts.baseUrl ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
  const f = opts.fetchFn ?? fetch;
  return {
    id: `remote:${opts.model}`,
    dim: opts.dim,
    async embedBatch(texts: string[]): Promise<number[][]> {
      const res = await f(`${base}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
        body: JSON.stringify({ model: opts.model, input: texts, input_type: opts.inputType ?? "passage", encoding_format: "float" }),
      });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    },
  };
}

// Upstream runs H-MEM with the pharmacy embedder process-wide (the vendored
// embeddings.ts was patched to make embed() swappable; see PROVENANCE.md).
setEmbedder(pharmaEmbedder);

// ------------------------------------------------------------------ the wrapper

/**
 * Recall threshold on the final H-MEM score (after the confidence multiplier).
 * Chosen by scripts/hmem-calibrate.ts on the labelled fixture in
 * test/fixtures/hmem-calibration.ts (8 decisions, 2 investigations, 12
 * queries incl. 4 distractors): at 0.25 mean recall 1.0, mean precision 0.94,
 * all distractors silent. The margin is thin (lowest relevant 0.263, highest
 * distractor 0.226) and it was tuned on that same fixture, so treat it as a
 * calibration, not an evaluation. The reference default 0.35 returned 1 of 8.
 */
export const RECALL_THRESHOLD = 0.25;

export interface DecisionInput {
  drug: string;
  ndcs?: string[];
  decision: string;
  /** Named human approver, e.g. "J. Patel, PharmD". Required. */
  approvedBy: string;
  rationale: string;
  evidenceRefs?: string[];
  /** Shortage episode / investigation id this decision belongs to. */
  episodeId?: string;
  /** epoch ms; defaults to the instance clock */
  at?: number;
}

export interface InvestigationInput {
  investigationId: string;
  drug: string;
  ndcs?: string[];
  summary: string;
  evidenceRefs?: string[];
  at?: number;
}

export interface RecalledMemory {
  memory: MemoryRecord;
  relevance: number;
  superseded: boolean;
  supersededBy?: string;
  approvedBy?: string;
  matchedBy: ("drug-tag" | "ranking")[];
}

export interface RecallResult {
  memories: RecalledMemory[];
  /** H-MEM reinjection block ([MEMORY CONTEXT] ... with <mem-id> citations), current records only. */
  context: string;
  threshold: number;
}

export interface AuditTrail {
  record: MemoryRecord;
  entries: LedgerEntry[];
  reads: number;
  actors: string[];
  approvedBy?: string;
  supersedes: string[]; // chain of older records this one replaced (newest first)
  supersededBy: string[]; // chain of newer records that replaced this one (oldest first)
}

export interface UpstreamHmemOptions extends HMEMOptions {
  /** Embedder to install process-wide. Default pharmaEmbedder. */
  embedder?: EmbedderImpl;
}

const SERVICES = ["store", "retrieval", "conflicts", "sleep", "dreaming"] as const;

export class HMEM extends BaseHMEM {
  readonly persistDir?: string;
  readonly defaultActor: string;

  constructor(opts: UpstreamHmemOptions = {}) {
    if (opts.embedder) setEmbedder(opts.embedder);
    super(opts);
    this.persistDir = opts.persistDir;
    this.defaultActor = opts.actor ?? "system";
    this.syncEmbedderMeta();
  }

  // ---------------------------------------------------------- actor handling

  /**
   * Run fn with every service's ledger actor set to `actor`. The reference
   * stamps one actor per instance; Upstream needs one per approver, and two
   * HMEM instances sharing a persistDir in one process would diverge (each
   * holds its own seq counter), so we switch the actor on one instance
   * instead. Safe because the reference services are fully synchronous.
   */
  withActor<T>(actor: string, fn: () => T): T {
    if (!actor || !actor.trim()) throw new Error("H-MEM: actor must be a non-empty name");
    const svcs = SERVICES.map((k) => this[k] as unknown as { actor: string });
    const prev = svcs.map((s) => s.actor);
    svcs.forEach((s) => (s.actor = actor));
    try {
      return fn();
    } finally {
      svcs.forEach((s, i) => (s.actor = prev[i]));
    }
  }

  /** A per-approver handle onto the same store and ledger. */
  forActor(actor: string): {
    add: (input: AddInput) => MemoryRecord;
    feedback: (id: string, kind: "helpful" | "not_helpful" | "wrong") => void;
    supersede: (oldId: string, input: AddInput) => { old: MemoryRecord; replacement: MemoryRecord };
  } {
    return {
      add: (input) => this.withActor(actor, () => this.add(input)),
      feedback: (id, kind) => this.withActor(actor, () => this.feedback(id, kind)),
      supersede: (oldId, input) => this.supersede(oldId, input, actor),
    };
  }

  // ---------------------------------------------------------- embedder handling

  private embedderMetaFile(): string | undefined {
    return this.persistDir ? path.join(this.persistDir, "embedder.json") : undefined;
  }

  /** If persisted vectors came from a different embedder, re-embed them with the active one. */
  private syncEmbedderMeta(): void {
    const file = this.embedderMetaFile();
    const active = activeEmbedder();
    if (!file) return;
    let saved: { id: string; dim: number } | undefined;
    if (fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, "utf-8"));
    const records = this.store.all();
    const stale = saved ? saved.id !== active.id : records.some((r) => r.embedding.length !== active.dim);
    if (stale && records.length) {
      for (const r of records) r.embedding = active.embed(r.content);
      this.store.persist();
    }
    if (!saved || saved.id !== active.id) fs.writeFileSync(file, JSON.stringify({ id: active.id, dim: active.dim }) + "\n");
  }

  /** Install a different embedder and re-embed every stored record (primes remote embedders first). */
  async useEmbedder(e: EmbedderImpl | PrimableEmbedder): Promise<void> {
    if ("prime" in e) await e.prime(this.store.all().map((r) => r.content));
    setEmbedder(e);
    for (const r of this.store.all()) r.embedding = e.embed(r.content);
    this.store.persist();
    const file = this.embedderMetaFile();
    if (file) fs.writeFileSync(file, JSON.stringify({ id: e.id, dim: e.dim }) + "\n");
  }

  private async prime(texts: string[]): Promise<void> {
    const e = activeEmbedder() as EmbedderImpl & Partial<PrimableEmbedder>;
    if (typeof e.prime === "function") await e.prime(texts);
  }

  // ---------------------------------------------------------- writes

  /**
   * Replace an old record with a new one: new.supersedes = old,
   * old.supersededBy = new, and "wrong" feedback on the old record (-0.20
   * confidence plus the "review" tag). The reference add({supersedes}) sets
   * only the forward link, so a revoked approval kept outranking its
   * revocation (pitfall 3). Nothing is deleted.
   */
  supersede(oldId: string, input: AddInput, actor = this.defaultActor): { old: MemoryRecord; replacement: MemoryRecord } {
    const old = this.store.get(oldId);
    if (!old) throw new Error(`H-MEM: cannot supersede unknown memory ${oldId}`);
    if (old.supersededBy) throw new Error(`H-MEM: ${oldId} is already superseded by ${old.supersededBy}`);
    return this.withActor(actor, () => {
      const replacement = this.add({ ...input, supersedes: oldId });
      this.store.update(oldId, { supersededBy: replacement.id });
      this.feedback(oldId, "wrong");
      return { old: this.store.get(oldId)!, replacement };
    });
  }

  /** Record a pharmacist / P&T decision, attributed to the named approver. */
  async rememberDecision(d: DecisionInput): Promise<MemoryRecord> {
    const input = this.decisionInput(d);
    await this.prime([input.content]);
    return this.withActor(d.approvedBy.trim(), () => this.add(input));
  }

  /** Supersede an earlier decision (e.g. a reversal) with a new approved decision. */
  async reviseDecision(oldId: string, d: DecisionInput): Promise<{ old: MemoryRecord; replacement: MemoryRecord }> {
    const input = this.decisionInput(d);
    await this.prime([input.content]);
    return this.supersede(oldId, input, d.approvedBy.trim());
  }

  /** Remember a finished investigation (agent-authored, lower confidence than a human decision). */
  async rememberInvestigation(inv: InvestigationInput, actor = "upstream-agent"): Promise<MemoryRecord> {
    const at = inv.at ?? this.clock();
    const ndcs = inv.ndcs ?? [];
    const input: AddInput = {
      content: `Investigation of ${inv.drug} shortage: ${inv.summary}${ndcs.length ? ` NDCs: ${ndcs.join(", ")}.` : ""}`,
      source: `investigation:${inv.investigationId}`,
      type: "factual",
      layer: "working",
      confidence: 0.7,
      tags: [...new Set([...drugTags(inv.drug), "investigation", "shortage"])],
      provenance: { origin: "plan_completion", learnedAt: at, label: `Upstream investigation ${inv.investigationId}`, refs: [...(inv.evidenceRefs ?? []), ...ndcs.map((n) => `ndc:${n}`)] },
      missionId: inv.investigationId,
    };
    await this.prime([input.content]);
    return this.withActor(actor, () => this.add(input));
  }

  private decisionInput(d: DecisionInput): AddInput {
    if (!d.approvedBy || !d.approvedBy.trim()) throw new Error("H-MEM: a decision needs a named human approver (approvedBy)");
    if (!d.drug || !d.decision) throw new Error("H-MEM: a decision needs drug and decision text");
    const at = d.at ?? this.clock();
    const ndcs = d.ndcs ?? [];
    const day = new Date(at).toISOString().slice(0, 10);
    // The decision is the approver's free text: stored as quoted data, never as instructions or as Upstream's words.
    const quote = quoteDecision(d.decision);
    if (!quote) throw new Error("H-MEM: a decision needs drug and decision text");
    return {
      content:
        `Decision on ${d.drug}, in the approver's words: "${quote}". Rationale: ${d.rationale}. Approved by ${d.approvedBy.trim()}.` +
        (ndcs.length ? ` NDCs: ${ndcs.join(", ")}.` : ""),
      source: `pharmacy-decision:${day}:${slug(d.approvedBy)}`,
      type: "factual",
      layer: "long_term",
      confidence: 0.9,
      tags: [...new Set([...drugTags(d.drug), "decision", "shortage"])],
      provenance: {
        origin: "manual",
        learnedAt: at,
        label: `Decision approved by ${d.approvedBy.trim()}`,
        refs: [`approver:${d.approvedBy.trim()}`, ...(d.evidenceRefs ?? []), ...ndcs.map((n) => `ndc:${n}`)],
      },
      missionId: d.episodeId,
    };
  }

  // ---------------------------------------------------------- reads

  /**
   * Ranked recall with Upstream's threshold and query normalisation (stop
   * words removed before the engine's top-8 keyword window, which otherwise
   * fills up with "what did we do..."). Superseded records are dropped unless
   * includeSuperseded is set, in which case they are labelled.
   */
  async recall(query: string, opts: { topN?: number; threshold?: number; includeSuperseded?: boolean; actor?: string } = {}): Promise<RecallResult> {
    await this.prime([normaliseQuery(query)]);
    return this.rank(normaliseQuery(query), opts);
  }

  /** Everything we know about past episodes for one drug: drug-tag matches plus ranked related memories. */
  async recallForDrug(drug: string, opts: { topN?: number; threshold?: number; includeSuperseded?: boolean; actor?: string; question?: string } = {}): Promise<RecallResult> {
    const q = normaliseQuery(`${opts.question ?? ""} ${drug} shortage decision`);
    await this.prime([q]);
    const tags = drugTags(drug);
    return this.rank(q, { topN: 10, ...opts }, (m) => tags.every((t) => m.tags.includes(t)));
  }

  private rank(
    q: string,
    opts: { topN?: number; threshold?: number; includeSuperseded?: boolean; actor?: string },
    drugFilter?: (m: MemoryRecord) => boolean,
  ): RecallResult {
    const threshold = opts.threshold ?? RECALL_THRESHOLD;
    const topN = opts.topN ?? 5;
    const scored: RecalledMemory[] = [];
    for (const m of this.store.all()) {
      const superseded = !!m.supersededBy;
      if (superseded && !opts.includeSuperseded) continue;
      const relevance = this.retrieval.scoreOne(m, q);
      const tagHit = drugFilter ? drugFilter(m) : false;
      const matchedBy: RecalledMemory["matchedBy"] = [];
      if (tagHit) matchedBy.push("drug-tag");
      if (relevance >= threshold) matchedBy.push("ranking");
      if (!matchedBy.length) continue;
      scored.push({ memory: m, relevance, superseded, supersededBy: m.supersededBy, approvedBy: approverOf(m), matchedBy });
    }
    scored.sort((a, b) => b.relevance - a.relevance || a.memory.id.localeCompare(b.memory.id));
    const top = scored.slice(0, topN);
    // Same side effects as the engine's query(): touch + one "read" ledger entry per returned record.
    this.withActor(opts.actor ?? this.defaultActor, () => {
      for (const r of top) {
        this.store.touch(r.memory.id);
        this.ledger.log(r.memory.id, "read", opts.actor ?? this.defaultActor, { details: { query: q } });
      }
    });
    const current: RetrievedMemory[] = top.filter((r) => !r.superseded).map((r) => ({ memory: r.memory, relevance: r.relevance }));
    return { memories: top, context: this.retrieval.formatReinjection(current), threshold };
  }

  /** Engine query with Upstream's threshold default (keeps the reference QueryResult shape). */
  queryUpstream(query: string, opts?: { topN?: number; threshold?: number; chatId?: string }): QueryResult {
    return this.query(normaliseQuery(query), { threshold: RECALL_THRESHOLD, ...opts });
  }

  /** Ledger trail for one memory plus its supersede chain in both directions. */
  auditTrail(id: string): AuditTrail {
    const record = this.store.get(id);
    if (!record) throw new Error(`H-MEM: unknown memory id ${id}`);
    const entries = this.ledger.history(id);
    const supersedes: string[] = [];
    for (let cur = record.supersedes, guard = 0; cur && guard < 100; guard++) {
      supersedes.push(cur);
      cur = this.store.get(cur)?.supersedes;
    }
    const supersededBy: string[] = [];
    for (let cur = record.supersededBy, guard = 0; cur && guard < 100; guard++) {
      supersededBy.push(cur);
      cur = this.store.get(cur)?.supersededBy;
    }
    return {
      record,
      entries: entries.filter((e) => e.action !== "read"),
      reads: entries.filter((e) => e.action === "read").length,
      actors: [...new Set(entries.map((e) => e.actor))],
      approvedBy: approverOf(record),
      supersedes,
      supersededBy,
    };
  }
}

/** Open the app's persistent memory (default <repo>/.state/hmem). */
export function openMemory(opts: UpstreamHmemOptions = {}): HMEM {
  return new HMEM({ actor: "upstream-agent", ...opts, persistDir: opts.persistDir ?? stateDir("hmem") });
}

// ------------------------------------------------------------------ helpers

/** Plain-word tags for a drug name ("Sodium Bicarbonate 8.4%" -> ["sodium", "bicarbonate", "8"]). */
export function drugTags(drug: string): string[] {
  return [...new Set(memoryTokens(drug).filter((t) => t.length > 1))];
}

export function normaliseQuery(q: string): string {
  return memoryTokens(q).join(" ");
}

function approverOf(m: MemoryRecord): string | undefined {
  const ref = m.provenance?.refs?.find((r) => r.startsWith("approver:"));
  return ref ? ref.slice("approver:".length) : undefined;
}

/** Plain words of a string, for callers that build their own tags. */
export function plainWords(s: string): string[] {
  return words(s);
}
