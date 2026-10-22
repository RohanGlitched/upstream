// Upstream's Markovian layer: the overnight formulary watch, built on the
// vendored Meterless Markovian reference (vendor/meterless/markovian,
// Apache-2.0, commit 1742dec).
//
// Design (research/METERLESS.md sections 1.3 and 6, pitfalls 14-17):
//   * The drug list, the cursor and every finding live in World Model (a
//     WatchRun entity plus "watch-status" facts on each drug). The Markovian
//     carryover only carries a short checkpoint (cursor, counts), and the
//     checkpoint is rebuilt from World Model each chunk, never trusted from a
//     model. A crashed watch resumes from World Model.
//   * A run is capped at 32 chunks (pitfall 14), so the batch size is
//     ceil(N / maxChunks) and, if a run still ends "max-chunks", further runs
//     are chained from the World Model cursor.
//   * Tool calls (the drug checker) happen inside the generator, because the
//     engine ignores [NEEDS_TOOL] (pitfall 15).
//   * The generator is pluggable (LLM later, deterministic stub now). It only
//     writes the narrative; this wrapper appends the marker block.
//   * Accounting is what we can measure: per-chunk prompt size, output size,
//     checker and generator latency, wall time. Tokens are chars/4 and
//     labelled "estimated" unless the generator returns provider usage, which
//     is labelled "measured". We do not report the engine's modeled savings
//     (pitfall 16): with tiny chunk outputs they are not meaningful.
//   * reflect defaults to false here (the reference default true costs one
//     extra generator call per run; pitfall 17).

import {
  Markovian,
  estimateTokens,
  type ChunkConfig,
  type MarkovianRun,
} from "../../vendor/meterless/markovian/reference/src/index.ts";
import { idFor, src, type UpstreamWorld } from "./world-model.ts";

export * from "../../vendor/meterless/markovian/reference/src/index.ts";

export interface WatchDrug {
  /** World Model id of the Drug (or HospitalItem) entity; must already exist. */
  id: string;
  name: string;
}

export interface DrugFinding {
  drugId: string;
  status: "ok" | "flagged" | "error";
  reasons: string[];
  /** World Model ids that support the finding (sites, recalls, shortage records...). */
  evidenceIds?: string[];
}

export type DrugChecker = (batch: WatchDrug[], ctx: { world: UpstreamWorld; runId: string; step: number }) => Promise<DrugFinding[]>;

export interface WatchGeneratorInput {
  prompt: string;
  step: number;
  batch: WatchDrug[];
  findings: DrugFinding[];
  cursor: number;
  total: number;
  flaggedSoFar: number;
  done: boolean;
}

export interface WatchGeneratorOutput {
  text: string;
  /** Provider-reported usage, if the generator called a model. Reported as "measured". */
  usage?: { promptTokens: number; completionTokens: number };
}

export type WatchGenerator = (input: WatchGeneratorInput) => Promise<WatchGeneratorOutput>;

/** Deterministic stub generator: a plain-English line per chunk, no model call. */
export const deterministicWatchGenerator: WatchGenerator = async (i) => {
  const flagged = i.findings.filter((f) => f.status === "flagged");
  const names = flagged.map((f) => i.batch.find((b) => b.id === f.drugId)?.name ?? f.drugId);
  const lines = [`>> checked ${i.batch.length} drugs (${i.cursor}/${i.total})`];
  lines.push(flagged.length ? `>> flagged: ${names.join(", ")}` : ">> flagged: none in this batch");
  for (const f of flagged) lines.push(`   - ${i.batch.find((b) => b.id === f.drugId)?.name ?? f.drugId}: ${f.reasons.join("; ")}`);
  return { text: lines.join("\n") };
};

export interface ChunkAccount {
  step: number;
  runId: string;
  drugsInChunk: number;
  promptChars: number;
  promptTokens: { value: number; label: "estimated" | "measured" };
  outputTokens: { value: number; label: "estimated" | "measured" };
  checkerMs: number;
  generatorMs: number;
  chunkMs: number;
}

export interface WatchReport {
  watchId: string;
  status: "completed" | "incomplete" | "errored";
  error?: string;
  resumedFrom: number;
  total: number;
  processed: number;
  flagged: string[];
  batchSize: number;
  markovianRuns: { id: string; status: MarkovianRun["status"]; chunks: number }[];
  chunks: ChunkAccount[];
  totals: {
    chunks: number;
    promptTokens: number;
    outputTokens: number;
    tokenLabel: "estimated" | "measured" | "mixed";
    promptTokensMin: number;
    promptTokensMax: number;
    checkerMs: number;
    generatorMs: number;
    wallMs: number;
  };
}

export interface FormularyWatchOptions {
  world: UpstreamWorld;
  checker: DrugChecker;
  generator?: WatchGenerator;
  /** drugs per chunk; default ceil(N / maxChunks) */
  batchSize?: number;
  chunkConfig?: Partial<ChunkConfig>;
  historyDir?: string;
  /** H-MEM reinjection block for chunk 1 (standing decisions). */
  memoryContext?: string;
  reflect?: boolean;
  /** Called before each tool use with the capability it needs; throw to refuse (Scout contract check). */
  guard?: (capability: "zetaris.read" | "world.write", step: number) => void | Promise<void>;
  /** max chained Markovian runs (each <= maxChunks). Default 8. */
  maxRuns?: number;
  clock?: () => number;
  /** time source for provenance on World Model writes */
  now?: () => Date;
}

const GOAL = "Overnight formulary watch: check every formulary drug for FDA shortage, recall, inspection, warning-letter and import-alert signals; flag exposure. Drug list, cursor and findings are in World Model.";

export class FormularyWatch {
  private readonly o: FormularyWatchOptions;
  constructor(opts: FormularyWatchOptions) {
    this.o = opts;
  }

  /** Read the durable cursor for a watch run from World Model. */
  state(watchId: string): { cursor: number; total: number; drugIds: string[]; status: string; flagged: string[] } | undefined {
    const id = idFor("WatchRun", watchId);
    const e = this.o.world.entity(id);
    if (!e) return undefined;
    return {
      cursor: Number(e.attrs.cursor ?? 0),
      total: Number(e.attrs.total ?? 0),
      drugIds: (e.attrs.drugIds as string[]) ?? [],
      status: String(e.attrs.status ?? "running"),
      flagged: (e.attrs.flagged as string[]) ?? [],
    };
  }

  /**
   * Run (or resume) a watch. If a WatchRun with this id exists and is not
   * finished, the stored drug list and cursor win and `drugs` is ignored.
   */
  async run(watchId: string, drugs: WatchDrug[]): Promise<WatchReport> {
    const clock = this.o.clock ?? Date.now;
    const now = this.o.now ?? (() => new Date());
    const world = this.o.world;
    const runEntityId = idFor("WatchRun", watchId);
    const t0 = clock();

    let st = this.state(watchId);
    if (!st) {
      world.requireKnown(drugs.map((d) => d.id));
      await world.upsert("WatchRun", watchId, {
        name: `Formulary watch ${watchId}`,
        attrs: { drugIds: drugs.map((d) => d.id), drugNames: drugs.map((d) => d.name), total: drugs.length, cursor: 0, status: "running", flagged: [] },
        source: src("agent", "formulary-watch", now()),
      });
      await world.flush();
      st = this.state(watchId)!;
    }
    const names = new Map<string, string>(drugs.map((d) => [d.id, d.name]));
    const storedNames = (world.entity(runEntityId)?.attrs.drugNames as string[]) ?? [];
    st.drugIds.forEach((id, i) => names.set(id, names.get(id) ?? storedNames[i] ?? id));
    const resumedFrom = st.cursor;
    const total = st.total;

    const cfg = { chunkSize: 8000, carryoverTokens: 800, maxChunks: 32, ...(this.o.chunkConfig ?? {}) };
    const batchSize = this.o.batchSize ?? Math.max(1, Math.ceil(total / cfg.maxChunks));
    const generator = this.o.generator ?? deterministicWatchGenerator;
    const chunks: ChunkAccount[] = [];
    const runs: WatchReport["markovianRuns"] = [];
    let error: string | undefined;
    let step = 0;

    for (let r = 0; r < (this.o.maxRuns ?? 8); r++) {
      const cur = this.state(watchId)!;
      if (cur.cursor >= total) break;
      const markovian = new Markovian({ chunkConfig: cfg, historyDir: this.o.historyDir, clock });
      let currentRunId = "";
      const run = await markovian.run({
        goal: GOAL,
        mode: "RESEARCH",
        reflect: this.o.reflect ?? false,
        memoryContext: r === 0 ? this.o.memoryContext : undefined,
        generator: async (prompt) => {
          const c0 = clock();
          step += 1;
          const s = this.state(watchId)!; // cursor comes from World Model, not from the carryover
          const batch = s.drugIds.slice(s.cursor, s.cursor + batchSize).map((id) => ({ id, name: names.get(id) ?? id }));
          await this.o.guard?.("zetaris.read", step);
          const k0 = clock();
          const findings = await this.o.checker(batch, { world, runId: watchId, step });
          const checkerMs = clock() - k0;
          await this.o.guard?.("world.write", step);
          const at = now();
          for (const f of findings) {
            if (!batch.some((b) => b.id === f.drugId)) throw new Error(`checker returned a finding for ${f.drugId}, which is not in this batch`);
            if (f.evidenceIds?.length) world.requireKnown(f.evidenceIds);
            await world.assertFact(f.drugId, "watch-status", { watchId, status: f.status, reasons: f.reasons, evidenceIds: f.evidenceIds ?? [] }, { source: src("agent", "formulary-watch", at), confidence: 0.8 });
          }
          const flagged = [...s.flagged, ...findings.filter((f) => f.status === "flagged").map((f) => f.drugId)];
          const cursor = s.cursor + batch.length;
          const done = cursor >= total;
          await world.upsert("WatchRun", watchId, { attrs: { cursor, flagged, status: done ? "completed" : "running", lastStep: step }, source: src("agent", "formulary-watch", at) });
          await world.flush();

          const g0 = clock();
          const out = await generator({ prompt, step, batch, findings, cursor, total, flaggedSoFar: flagged.length, done });
          const generatorMs = clock() - g0;
          const marker = done
            ? "\n[TASK_COMPLETE]"
            : `\n[STATE_CHECKPOINT]\nCOMPLETED: ${cursor}/${total} drugs checked\nREMAINING: ${total - cursor} drugs; cursor=${cursor} (authoritative copy in World Model ${runEntityId})\nDECISIONS: ${flagged.length} flagged so far (findings in World Model)\nCONTEXT: watch=${watchId} batch=${batchSize}`;
          const text = out.text.replace(/\[(STATE_CHECKPOINT|TASK_COMPLETE)\][\s\S]*$/, "").trimEnd() + marker;
          chunks.push({
            step,
            runId: currentRunId,
            drugsInChunk: batch.length,
            promptChars: prompt.length,
            promptTokens: out.usage ? { value: out.usage.promptTokens, label: "measured" } : { value: estimateTokens(prompt), label: "estimated" },
            outputTokens: out.usage ? { value: out.usage.completionTokens, label: "measured" } : { value: estimateTokens(out.text), label: "estimated" },
            checkerMs,
            generatorMs,
            chunkMs: clock() - c0,
          });
          return { text };
        },
      });
      currentRunId = run.id;
      for (const c of chunks) if (!c.runId) c.runId = run.id;
      runs.push({ id: run.id, status: run.status, chunks: run.chunks.length });
      if (run.status === "errored" || run.status === "aborted") {
        error = run.error ?? run.status;
        break;
      }
    }

    const fin = this.state(watchId)!;
    const label = chunks.every((c) => c.promptTokens.label === "measured") ? "measured" : chunks.every((c) => c.promptTokens.label === "estimated") ? "estimated" : "mixed";
    const pt = chunks.map((c) => c.promptTokens.value);
    return {
      watchId,
      status: error ? "errored" : fin.cursor >= total ? "completed" : "incomplete",
      error,
      resumedFrom,
      total,
      processed: fin.cursor,
      flagged: fin.flagged,
      batchSize,
      markovianRuns: runs,
      chunks,
      totals: {
        chunks: chunks.length,
        promptTokens: pt.reduce((s, x) => s + x, 0),
        outputTokens: chunks.reduce((s, c) => s + c.outputTokens.value, 0),
        tokenLabel: label,
        promptTokensMin: pt.length ? Math.min(...pt) : 0,
        promptTokensMax: pt.length ? Math.max(...pt) : 0,
        checkerMs: chunks.reduce((s, c) => s + c.checkerMs, 0),
        generatorMs: chunks.reduce((s, c) => s + c.generatorMs, 0),
        wallMs: clock() - t0,
      },
    };
  }
}
