#!/usr/bin/env node
// Runs every Meterless conformance suite against OUR integration modules and
// writes CONFORMANCE.md + conformance.json at the repo root. Exit 1 if any fails.
//
//   H-MEM        vendor/meterless/hmem/conformance/runner.ts         HMEM_IMPL=src/engines/hmem.ts
//   World Model  vendor/meterless/world-model/conformance/runner.ts  WORLD_MODEL_IMPL=src/engines/world-model.ts
//   Markovian    vendor/meterless/markovian/conformance/runner.ts    MARKOVIAN_IMPL=src/engines/markovian.ts
//   Scout Intent vendor/meterless/scout-intent/evals/runner/index.ts SCOUT_IMPL=src/engines/scout/index.ts
//
// The Scout harness overwrites vendor/meterless/scout-intent/evals/reports/latest.md;
// we keep the vendored file untouched (restored afterwards) and save the
// generated report to src/engines/results/scout-harness-report.md instead.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), process.env.UPSTREAM_ROOT ?? "..");
const V = (p) => path.join(root, "vendor/meterless", p);
const S = (p) => path.join(root, "src/engines", p);
const fwd = (p) => p.split("\\").join("/"); // Meterless docs: forward slashes and an absolute path on Windows
const tsx = path.join(root, "node_modules/.bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
if (!fs.existsSync(tsx)) {
  console.error("tsx not found; run npm install in the repo root first");
  process.exit(2);
}

const suites = [
  { engine: "H-MEM", spec: "vendor/meterless/hmem/AGENTS.md", module: "src/engines/hmem.ts", cwd: V("hmem/reference"), args: [fwd(V("hmem/conformance/runner.ts"))], env: { HMEM_IMPL: fwd(S("hmem.ts")) } },
  { engine: "World Model", spec: "vendor/meterless/world-model/AGENTS.md", module: "src/engines/world-model.ts", cwd: V("world-model/reference"), args: [fwd(V("world-model/conformance/runner.ts"))], env: { WORLD_MODEL_IMPL: fwd(S("world-model.ts")) } },
  { engine: "Markovian", spec: "vendor/meterless/markovian/AGENTS.md", module: "src/engines/markovian.ts", cwd: V("markovian/reference"), args: [fwd(V("markovian/conformance/runner.ts"))], env: { MARKOVIAN_IMPL: fwd(S("markovian.ts")) } },
  { engine: "Scout Intent", spec: "vendor/meterless/scout-intent/AGENTS.md", module: "src/engines/scout/index.ts", cwd: V("scout-intent"), args: ["evals/runner/index.ts", "all"], env: { SCOUT_IMPL: fwd(S("scout/index.ts")) } },
];

const reportFile = V("scout-intent/evals/reports/latest.md");
const originalReport = fs.existsSync(reportFile) ? fs.readFileSync(reportFile) : undefined;

const results = [];
for (const s of suites) {
  const t0 = Date.now();
  const r = spawnSync(tsx, s.args, { cwd: s.cwd, env: { ...process.env, ...s.env }, encoding: "utf8", shell: process.platform === "win32", timeout: 300_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "") + (r.error ? String(r.error) : "");
  const m = out.match(/(\d+)\/(\d+) checks passed/);
  let summary = m ? `${m[1]}/${m[2]} checks passed` : null;
  let metrics;
  if (s.engine === "Scout Intent") {
    const get = (k) => {
      const v = out.match(new RegExp(k + String.raw`\s*│\s*([\d.]+)`))?.[1];
      return v === undefined ? null : Number(v);
    };
    metrics = Object.fromEntries(["intent_top1", "intent_top3_recall", "injection_precision", "injection_recall", "tool_precision", "clarification_rate", "override_frequency"].map((k) => [k, get(k)]));
    const n = out.match(/Loaded (\d+) examples/)?.[1];
    summary = `${r.status === 0 ? "gate PASS" : `gate FAIL (exit ${r.status})`} on ${n ?? "?"} examples: top1 ${metrics.intent_top1}, top3 ${metrics.intent_top3_recall}, injection P/R ${metrics.injection_precision}/${metrics.injection_recall}, tool ${metrics.tool_precision}, clarification rate ${metrics.clarification_rate}`;
    if (fs.existsSync(reportFile)) {
      fs.mkdirSync(S("results"), { recursive: true });
      fs.copyFileSync(reportFile, S("results/scout-harness-report.md"));
    }
    if (originalReport) fs.writeFileSync(reportFile, originalReport);
  }
  results.push({ engine: s.engine, module: s.module, spec: s.spec, exit: r.status, pass: r.status === 0, summary: summary ?? `exit ${r.status}`, metrics, ms: Date.now() - t0, tail: out.trim().split("\n").slice(-12).join("\n") });
}

const at = new Date().toISOString();
fs.writeFileSync(path.join(root, "conformance.json"), JSON.stringify({ at, vendorCommit: "1742dec56a66e58eef9dda2d2b865823758ca8cd", node: process.version, platform: process.platform, results }, null, 2) + "\n");
const md = [
  "# Meterless conformance",
  "",
  `_Run ${at} on ${process.platform}, Node ${process.version}, against Upstream's integration modules (vendored engines at commit 1742dec). Regenerate with \`npm run conformance\`._`,
  "",
  "| Engine | Our module | Result | Detail |",
  "|---|---|---|---|",
  ...results.map((r) => `| ${r.engine} | \`${r.module}\` | ${r.pass ? "PASS" : "FAIL"} | ${r.summary} |`),
  "",
  "## What these numbers mean",
  "",
  "- **H-MEM, World Model, Markovian**: the Meterless conformance runners, unmodified, loading our modules through `HMEM_IMPL`, `WORLD_MODEL_IMPL` and `MARKOVIAN_IMPL`. They check spec invariants (feedback deltas, ranking order, sleep guardrails, stable ids, merge bands, provenance, idempotency, bitemporal edges, config bounds, marker protocol). H-MEM runs with Upstream's pharmacy embedder installed. World Model conformance uses in-memory storage, so it does not exercise our deferred-persistence patch; `src/engines/test/world-model.test.ts` does.",
  "- **Scout Intent**: the Meterless eval harness, unmodified, with its own CRM fixture registry and 32-example v1 corpus. Every intent-labelled prompt in that corpus also appears verbatim in the fixture registry's examples, so a lexical scorer is expected to score 1.0; the harness also never compares clarification, non-block risk or multi-intent expectations, and never exercises signing, expiry or scope enforcement. Treat a PASS as \"the plumbing is spec-shaped\", not as a quality claim. Our own measurements are in `src/engines/results/` (pharmacy eval with a held-out split, the harness's unscored expectations, and contract tests).",
  "",
].join("\n");
fs.writeFileSync(path.join(root, "CONFORMANCE.md"), md);
console.log(md);
process.exit(results.every((r) => r.pass) ? 0 : 1);
