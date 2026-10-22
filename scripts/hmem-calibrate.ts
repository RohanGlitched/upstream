// Measures H-MEM recall quality on the labelled pharmacy fixture for:
//   A. the reference engine as shipped (FNV-1a 64-dim embedder, raw query, default threshold 0.35)
//   B. the reference engine with the starter's workaround (threshold 0.1)
//   C. Upstream's wrapper (pharmaEmbedder, normalised query, RECALL_THRESHOLD) over a threshold sweep
// Writes src/engines/results/hmem-calibration.json. Run: npm run hmem:calibrate
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HMEM, RECALL_THRESHOLD, hashEmbed, pharmaEmbedder, setEmbedder } from "../src/engines/hmem.ts";
import { DAY, DECISIONS, INVESTIGATIONS, QUERIES, T0 } from "../src/engines/test/fixtures/hmem-calibration.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function build(embedder: "hash" | "pharma") {
  setEmbedder(embedder === "hash" ? { id: "fnv1a-64", dim: 64, embed: hashEmbed } : pharmaEmbedder);
  const mem = new HMEM({ clock: () => T0 + DAY });
  const ids: Record<string, string> = {};
  for (const d of DECISIONS) ids[d.key] = (await mem.rememberDecision(d)).id;
  for (const i of INVESTIGATIONS) ids[i.key] = (await mem.rememberInvestigation(i)).id;
  const keyOf = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return { mem, keyOf };
}

type Row = { config: string; threshold: number; meanPrecision: number; meanRecall: number; top1: number; distractorsSilent: number; relevantMin: number; distractorMax: number };

function score(results: { q: (typeof QUERIES)[number]; got: { key: string; relevance: number }[] }[], config: string, threshold: number): Row {
  const real = results.filter((r) => r.q.relevant.length);
  const dist = results.filter((r) => !r.q.relevant.length);
  const decisionKeys = new Set(DECISIONS.map((d) => d.key));
  let p = 0, rc = 0, t1 = 0;
  for (const r of real) {
    const got = r.got.filter((g) => decisionKeys.has(g.key)); // investigations are allowed extras
    const hits = got.filter((g) => r.q.relevant.includes(g.key)).length;
    p += got.length ? hits / got.length : 0;
    rc += hits / r.q.relevant.length;
    t1 += got[0] && r.q.relevant.includes(got[0].key) ? 1 : 0;
  }
  const relevantScores = real.flatMap((r) => r.got.filter((g) => r.q.relevant.includes(g.key)).map((g) => g.relevance));
  const distractorScores = dist.flatMap((r) => r.got.map((g) => g.relevance));
  const round = (x: number) => Number(x.toFixed(3));
  return {
    config,
    threshold,
    meanPrecision: round(p / real.length),
    meanRecall: round(rc / real.length),
    top1: round(t1 / real.length),
    distractorsSilent: round(dist.filter((r) => r.got.length === 0).length / dist.length),
    relevantMin: round(relevantScores.length ? Math.min(...relevantScores) : 0),
    distractorMax: round(distractorScores.length ? Math.max(...distractorScores) : 0),
  };
}

async function main() {
  const rows: Row[] = [];
  for (const [label, emb, th] of [["A reference, raw query, default 0.35", "hash", 0.35], ["B reference, raw query, 0.10", "hash", 0.1]] as const) {
    const { mem, keyOf } = await build(emb);
    const res = QUERIES.map((q) => ({ q, got: mem.query(q.q, { threshold: th, topN: 5 }).memories.map((m) => ({ key: keyOf[m.memory.id], relevance: m.relevance })) }));
    rows.push(score(res, label, th));
  }
  for (const emb of ["hash", "pharma"] as const) {
    for (const th of [0.15, 0.2, 0.25, 0.3, 0.35]) {
      const { mem, keyOf } = await build(emb);
      const res = [];
      for (const q of QUERIES) {
        const r = await mem.recall(q.q, { threshold: th, topN: 5 });
        res.push({ q, got: r.memories.map((m) => ({ key: keyOf[m.memory.id], relevance: m.relevance })) });
      }
      rows.push(score(res, `C upstream recall(), ${emb === "hash" ? "fnv1a-64" : pharmaEmbedder.id}, normalised query`, th));
    }
  }
  setEmbedder(pharmaEmbedder);
  const out = { at: new Date().toISOString(), fixture: { decisions: DECISIONS.length, investigations: INVESTIGATIONS.length, queries: QUERIES.length, distractors: QUERIES.filter((q) => !q.relevant.length).length }, chosenThreshold: RECALL_THRESHOLD, rows };
  fs.mkdirSync(path.join(root, "src/engines/results"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/engines/results/hmem-calibration.json"), JSON.stringify(out, null, 2) + "\n");
  console.table(rows);
}

main();
