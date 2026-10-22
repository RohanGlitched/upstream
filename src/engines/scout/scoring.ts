// ScoringService (AGENTS.md section 4, docs/scoring.md).
//
// Stage 1 (always on, pure rules): a weighted trigger/n-gram scan over the
// whole registry. Each intent's vocabulary is built from its examples
// (unigrams + bigrams), its id words, its declared triggers, and (weakly) its
// description, all IDF-weighted across intents. For a prompt we compute:
//   coverage  = IDF weight of prompt features the intent matches, as a
//               fraction of the prompt's matched (in-vocabulary) weight
//               (the spec's "winner's score as a fraction of matched weight")
//   exemplar  = best weighted Dice overlap with a single example
//   trigger   = saturating sum of matched trigger-phrase weights
//   lexical   = max(0.5 coverage + 0.3 exemplar + 0.2 trigger, exemplar) * support
// where support discounts prompts that are mostly out-of-vocabulary.
//
// Merge: finalScore = (0.40 lexical + 0.35 semantic + 0.20 contextual
// + 0.05 recency) / (sum of ACTIVE weights) - riskPenalty.
// SPEC GAP: by the canonical formula, Stage 1 alone (lexical + recency) caps
// at 0.45, so Medium (>= 0.55) and High (>= 0.80) are unreachable without
// Stage 2. We renormalise by the weights of the terms that actually ran, so a
// Stage-1-only score lives on the same 0..1 scale the bands assume. Terms that
// did not run (no Stage-2 model, no context, no session history) are inactive,
// not zero.
//
// Stage 2 (optional): plug a `semantic(prompt, intent)` scorer (e.g. a local
// embedding model or Nemotron embeddings). Not shipped: Upstream runs Stage 1
// only today, and decisions report stage2: "skipped".

import { STOP_WORDS, stem, words } from "../text.ts";
import type { Lexicon } from "./lexicon.ts";
import type { Intent, IntentCandidate } from "./types.ts";
import type { IntentRegistry } from "./registry.ts";

export const WEIGHTS = { lexical: 0.4, semantic: 0.35, contextual: 0.2, recency: 0.05 } as const;

/** Synonyms used only by the intent scanner (stemmed keys). */
const SCAN_SYNONYMS: Record<string, string> = {
  short: "shortage",
  backorder: "shortage",
  backordered: "shortage",
  unavailable: "shortage",
  outage: "shortage",
  substitut: "alternative",
  substitute: "alternative",
  substitution: "alternative",
  interchange: "alternative",
  equivalent: "alternative",
  manufactur: "manufacture",
  manufacturer: "manufacture",
  manufacture: "manufacture",
  vial: "unit",
  bag: "unit",
  box: "unit",
  dose: "dose",
  dos: "dose",
  dosing: "dose",
  facility: "hospital",
  facilitie: "hospital",
  campus: "hospital",
  approv: "approve",
  approval: "approve",
  decid: "decision",
  decide: "decision",
  "one-pager": "brief",
  pager: "brief",
};

export function scanTokens(normalisedText: string): string[] {
  const out: string[] = [];
  for (const w of words(normalisedText)) {
    if (w.length < 2 && w !== "&") continue;
    if (STOP_WORDS.has(w)) continue;
    const s = stem(w);
    out.push(SCAN_SYNONYMS[w] ?? SCAN_SYNONYMS[s] ?? s);
  }
  return out;
}

export function features(tokens: string[]): string[] {
  const f = new Set<string>(tokens);
  for (let i = 0; i + 1 < tokens.length; i++) f.add(`${tokens[i]}_${tokens[i + 1]}`);
  return [...f];
}

interface IntentModel {
  intent: Intent;
  vocab: Map<string, number>; // feature -> weight in [0,1]
  examples: Set<string>[];
  drugScoped: boolean;
  triggers: { tokens: string[]; weight: number }[];
}

export interface ScoreTerms {
  lexical: number;
  semantic?: number;
  contextual?: number;
  recency?: number;
  riskPenalty?: number;
}

export interface SenseOptions {
  semantic?: (prompt: string, intent: Intent) => number | undefined;
  /** intent id -> 0..1 */
  contextual?: Record<string, number>;
  /** intent id -> 0..1 */
  recency?: Record<string, number>;
  riskPenalty?: (intent: Intent) => number;
}

export interface SenseResult {
  candidates: (IntentCandidate & { terms: ScoreTerms })[];
  stage2: "used" | "skipped";
  ms: number;
}

export class Scorer {
  private readonly models: IntentModel[];
  private readonly idf = new Map<string, number>();
  private readonly n: number;

  constructor(private readonly registry: IntentRegistry, private readonly lexicon: Lexicon) {
    const tok = (s: string) => scanTokens(this.lexicon.normalise(s).text);
    this.models = registry.all().map((intent) => {
      const vocab = new Map<string, number>();
      const put = (f: string, w: number) => vocab.set(f, Math.max(vocab.get(f) ?? 0, w));
      const examples = intent.examples.map((e) => new Set(features(tok(e))));
      for (const ex of examples) for (const f of ex) put(f, 1);
      for (const t of tok(intent.id.replace(/[._]/g, " "))) put(t, 0.8);
      for (const t of tok(intent.description)) put(t, 0.25);
      const triggers = (intent.triggers ?? []).map((t) => ({ tokens: tok(t.phrase), weight: t.weight })).filter((t) => t.tokens.length);
      for (const t of triggers) for (const f of features(t.tokens)) put(f, Math.min(1, 0.5 + t.weight / 6));
      const drugScoped = Object.values(intent.parameters?.properties ?? {}).some((p) => p.entity === "drug");
      return { intent, vocab, examples, triggers, drugScoped };
    });
    this.n = this.models.length;
    const df = new Map<string, number>();
    for (const m of this.models) for (const f of m.vocab.keys()) df.set(f, (df.get(f) ?? 0) + 1);
    for (const [f, d] of df) this.idf.set(f, Math.log(1 + this.n / d));
  }

  /** IDF of a feature; out-of-vocabulary features get the maximum IDF (they are informative about being off-topic). */
  private w(f: string): number {
    return this.idf.get(f) ?? Math.log(1 + this.n / 2);
  }

  lexical(promptTokens: string[]): Map<string, number> {
    return new Map([...this.lexicalDetail(promptTokens)].map(([k, v]) => [k, v.lex]));
  }

  /** Per-intent Stage-1 components (for debugging and the README explanation). */
  lexicalDetail(promptTokens: string[]): Map<string, { coverage: number; exemplar: number; trigger: number; support: number; lex: number }> {
    const pf = features(promptTokens);
    const inVocab = pf.filter((f) => this.idf.has(f));
    const totalW = pf.reduce((s, f) => s + (f.includes("_") ? 0.5 : 1) * this.w(f), 0) || 1;
    const matchedW = inVocab.reduce((s, f) => s + (f.includes("_") ? 0.5 : 1) * this.w(f), 0);
    const support = Math.sqrt(matchedW / totalW);
    const out = new Map<string, { coverage: number; exemplar: number; trigger: number; support: number; lex: number }>();
    const joined = ` ${promptTokens.join(" ")} `;
    const hasDrug = promptTokens.includes("drugname") || promptTokens.includes("ndccode");
    for (const m of this.models) {
      let hit = 0;
      for (const f of inVocab) {
        const wt = m.vocab.get(f);
        if (wt) hit += (f.includes("_") ? 0.5 : 1) * this.w(f) * wt;
      }
      const coverage = matchedW ? hit / matchedW : 0;
      let exemplar = 0;
      const ps = new Set(pf);
      for (const ex of m.examples) {
        let inter = 0, a = 0, b = 0;
        for (const f of ps) {
          const wf = this.w(f);
          a += wf;
          if (ex.has(f)) inter += wf;
        }
        for (const f of ex) b += this.w(f);
        exemplar = Math.max(exemplar, a + b ? (2 * inter) / (a + b) : 0);
      }
      let trig = 0;
      for (const t of m.triggers) if (joined.includes(` ${t.tokens.join(" ")} `)) trig += t.weight;
      const trigger = 1 - Math.exp(-trig / 3);
      // A (near-)verbatim example is direct evidence on its own, so exemplar also acts as a floor.
      // Slot fit: a prompt that names a drug fits drug-scoped intents better than formulary-wide ones.
      const slotFit = hasDrug && !m.drugScoped && m.intent.id !== "GENERAL" ? 0.85 : 1;
      const raw = Math.max(0.65 * coverage + 0.15 * exemplar + 0.2 * trigger, exemplar) * support * slotFit;
      // Monotone calibration onto the spec bands (ranking unchanged): sqrt maps raw 0.16/0.30/0.64 to 0.40/0.55/0.80.
      const lex = Math.sqrt(Math.max(0, raw));
      out.set(m.intent.id, { coverage, exemplar, trigger, support, lex: Math.min(1, lex) });
    }
    return out;
  }

  sense(normalisedText: string, rawPrompt: string, opts: SenseOptions = {}): SenseResult {
    const t0 = performance.now();
    const toks = scanTokens(normalisedText);
    const lex = this.lexical(toks);
    let stage2: "used" | "skipped" = "skipped";
    const candidates = this.models.map((m) => {
      const terms: ScoreTerms = { lexical: lex.get(m.intent.id) ?? 0 };
      let num = WEIGHTS.lexical * terms.lexical;
      let den = WEIGHTS.lexical;
      const sem = opts.semantic?.(rawPrompt, m.intent);
      if (sem !== undefined) {
        stage2 = "used";
        terms.semantic = sem;
        num += WEIGHTS.semantic * sem;
        den += WEIGHTS.semantic;
      }
      if (opts.contextual) {
        terms.contextual = opts.contextual[m.intent.id] ?? 0;
        num += WEIGHTS.contextual * terms.contextual;
        den += WEIGHTS.contextual;
      }
      if (opts.recency) {
        terms.recency = opts.recency[m.intent.id] ?? 0;
        num += WEIGHTS.recency * terms.recency;
        den += WEIGHTS.recency;
      }
      terms.riskPenalty = opts.riskPenalty?.(m.intent) ?? 0;
      let score = num / den - terms.riskPenalty;
      if (m.intent.id === "GENERAL") score = Math.min(score, 0.39); // GENERAL is a fallback, never a winner by score
      return { intent: m.intent.id, score: round4(Math.max(0, Math.min(1, score))), terms };
    });
    candidates.sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent));
    return { candidates, stage2, ms: performance.now() - t0 };
  }
}

export function bandOf(score: number): "high" | "medium" | "low" | "reject" {
  return score >= 0.8 ? "high" : score >= 0.55 ? "medium" : score >= 0.4 ? "low" : "reject";
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
