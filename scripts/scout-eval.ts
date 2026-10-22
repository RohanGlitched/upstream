// Upstream's own Scout eval over the pharmacy registry. Scores what the
// Meterless harness does not: intent accuracy on our registry, risk-level
// accuracy, block recall (must be 1.0), clarification behaviour, parameter
// binding, and execution-contract scope correctness (exact capability set,
// never-list, signature tamper and expiry refusal, approval gating).
//
//   npm run scout:eval                 # all splits, writes src/engines/results/scout-pharmacy-eval.{json,md}
//   npm run scout:eval -- --split tuning   # only the tuning split (what we iterated on)
//
// The corpus is src/engines/scout/evals/pharmacy.jsonl (Meterless JSONL
// format plus "heldout": true on prompts written before any tuning).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NEVER_CAPABILITIES, verifyContract, type Decision, type ExecutionContract } from "../src/engines/scout/index.ts";
import { createUpstreamScout } from "../src/engines/scout/upstream.ts";
import { Lexicon } from "../src/engines/scout/lexicon.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpusFile = path.join(root, "src/engines/scout/evals/pharmacy.jsonl");
const registry = JSON.parse(fs.readFileSync(path.join(root, "src/engines/scout/registry/pharmacy-intents.json"), "utf-8"));
const capsOf = (id: string): string[] => registry.intents.find((i: { id: string }) => i.id === id)?.capabilities ?? [];

type Example = {
  id: string;
  heldout?: boolean;
  prompt: string;
  user?: { role: string };
  surface?: string;
  expected: { intent?: string; intents?: string[]; risk?: string; toolPlan?: string[]; injection?: boolean; clarification?: boolean; parameters?: Record<string, unknown> };
  tags?: string[];
};

const argSplit = (() => {
  const i = process.argv.indexOf("--split");
  return i > -1 ? process.argv[i + 1] : "all";
})();
const SECRET = "eval-secret";

function ratio(n: number, d: number) {
  return { value: d ? Number((n / d).toFixed(3)) : null, n, d };
}

async function main() {
  const corpus: Example[] = fs.readFileSync(corpusFile, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  // Leakage check: no eval prompt may equal a registry example after normalisation.
  const lex = new Lexicon();
  const norm = (s: string) => lex.normalise(s).text.replace(/[^a-z0-9& ]/g, "").trim();
  const exampleSet = new Set<string>(registry.intents.flatMap((i: { examples: string[] }) => i.examples.map(norm)));
  const leaked = corpus.filter((e) => exampleSet.has(norm(e.prompt))).map((e) => e.id);

  let clock = Date.parse("2026-10-22T08:00:00Z");
  const scout = createUpstreamScout({ signingSecret: SECRET, clock: () => clock });
  const rows: { ex: Example; d: Decision; ms: number; checks: Record<string, boolean | null>; scopeProblems: string[] }[] = [];
  for (const ex of corpus) {
    clock += 1000;
    const t0 = performance.now();
    const d = await scout.decide({ prompt: ex.prompt, user: { id: `eval-${ex.id}`, role: ex.user?.role ?? "buyer" }, surface: ex.surface ?? "chat" });
    const ms = performance.now() - t0;
    const e = ex.expected;
    const checks: Record<string, boolean | null> = {};
    const expectIntents = e.intents ?? (e.intent ? [e.intent] : undefined);
    checks.intent = expectIntents ? (e.intents ? e.intents.includes(d.intent.primary) : d.intent.primary === e.intent) : null;
    checks.multiIntentPlan = e.intents ? e.intents.every((i) => (d.plan ?? []).some((p) => p.intent === i)) || (d.risk.level === "block" && e.risk === "block") : null;
    checks.risk = e.risk ? d.risk.level === e.risk : null;
    const injFlag = d.risk.flags.some((f) => f.layer === "injection");
    checks.injection = e.injection === undefined ? null : injFlag === e.injection;
    checks.clarification = e.clarification === undefined ? null : !!d.clarification === e.clarification;
    checks.toolPlan = e.toolPlan && d.executionContract ? e.toolPlan.every((c) => d.toolPlan.some((s) => s.capability === c)) : e.toolPlan ? false : null;
    checks.parameters = e.parameters ? Object.entries(e.parameters).every(([k, v]) => d.intent.parameters[k] === v) : null;

    // Contract scope correctness
    const scopeProblems: string[] = [];
    const c = d.executionContract as ExecutionContract | undefined;
    if (e.risk === "block" && c) scopeProblems.push("contract issued for a block case");
    if (d.clarification && c) scopeProblems.push("contract issued while clarification pending");
    if (c) {
      const expectedScope = [...new Set((d.plan?.map((p) => p.intent) ?? [d.intent.primary]).flatMap(capsOf))].sort();
      const got = [...c.scope.capabilities].sort();
      if (JSON.stringify(got) !== JSON.stringify(expectedScope)) scopeProblems.push(`scope ${got} != registry ${expectedScope}`);
      for (const n of NEVER_CAPABILITIES) if (got.includes(n)) scopeProblems.push(`never-capability ${n} in scope`);
      if (!d.toolPlan.every((s) => got.includes(s.capability))) scopeProblems.push("toolPlan step outside scope");
      for (const cap of got) {
        const r = verifyContract(c, cap, { secret: SECRET, now: clock });
        const gated = c.risk.approvalsRequired.some((s) => !s.capabilities || s.capabilities.includes(cap));
        if (gated && r.ok) scopeProblems.push(`${cap} ran without its required approval`);
        if (!gated && !r.ok) scopeProblems.push(`${cap} refused: ${r.reason}`);
      }
      for (const n of NEVER_CAPABILITIES) if (verifyContract(c, n, { secret: SECRET, now: clock }).ok) scopeProblems.push(`never-capability ${n} verified`);
      if (verifyContract(c, "order.place", { secret: SECRET, now: clock, never: [] }).ok) scopeProblems.push("order.place verified with never-list disabled");
      const tampered = { ...c, scope: { ...c.scope, capabilities: [...c.scope.capabilities, "order.place"] } };
      if (verifyContract(tampered, "order.place", { secret: SECRET, now: clock, never: [] }).ok) scopeProblems.push("tampered scope accepted");
      const first = got[0];
      if (first && verifyContract(c, first, { secret: SECRET, now: Date.parse(c.expiresAt) + 1 }).ok) scopeProblems.push("expired contract accepted");
      if (first && verifyContract(c, first, { secret: "wrong-secret", now: clock }).ok) scopeProblems.push("wrong-secret contract accepted");
    }
    checks.contractScope = c || e.risk === "block" || d.clarification ? scopeProblems.length === 0 : null;
    rows.push({ ex, d, ms, checks, scopeProblems });
  }

  const splits: Record<string, typeof rows> = {
    all: rows,
    tuning: rows.filter((r) => !r.ex.heldout),
    heldout: rows.filter((r) => r.ex.heldout),
  };
  const report: Record<string, unknown> = {};
  for (const [name, rs] of Object.entries(splits)) {
    if (argSplit !== "all" && name !== argSplit) continue;
    const m = (k: string) => {
      const app = rs.filter((r) => r.checks[k] !== null);
      return ratio(app.filter((r) => r.checks[k]).length, app.length);
    };
    const blockCases = rs.filter((r) => r.ex.expected.risk === "block");
    const predictedBlock = rs.filter((r) => r.d.risk.level === "block");
    const injCases = rs.filter((r) => r.ex.expected.injection === true);
    const injPred = rs.filter((r) => r.d.risk.flags.some((f) => f.layer === "injection"));
    const lat = rs.map((r) => r.ms).sort((a, b) => a - b);
    report[name] = {
      examples: rs.length,
      intent_accuracy: m("intent"),
      multi_intent_plan: m("multiIntentPlan"),
      risk_level_accuracy: m("risk"),
      block_recall: ratio(blockCases.filter((r) => r.d.risk.level === "block").length, blockCases.length),
      block_precision: ratio(predictedBlock.filter((r) => r.ex.expected.risk === "block").length, predictedBlock.length),
      injection_recall: ratio(injCases.filter((r) => r.d.risk.flags.some((f) => f.layer === "injection")).length, injCases.length),
      injection_precision: ratio(injPred.filter((r) => r.ex.expected.injection === true).length, injPred.length),
      clarification_accuracy: m("clarification"),
      clarification_rate: ratio(rs.filter((r) => r.d.clarification).length, rs.length),
      tool_plan_recall: m("toolPlan"),
      parameter_binding: m("parameters"),
      contract_scope_correct: m("contractScope"),
      latency_ms: { p50: Number(lat[Math.floor(lat.length / 2)]?.toFixed(2)), p95: Number(lat[Math.floor(lat.length * 0.95)]?.toFixed(2)), max: Number(lat[lat.length - 1]?.toFixed(2)) },
    };
  }
  const failures = rows
    .filter((r) => argSplit === "all" || (argSplit === "heldout") === !!r.ex.heldout)
    .filter((r) => Object.values(r.checks).some((v) => v === false))
    .map((r) => ({
      id: r.ex.id,
      heldout: !!r.ex.heldout,
      prompt: r.ex.prompt,
      failed: Object.entries(r.checks).filter(([, v]) => v === false).map(([k]) => k),
      expected: r.ex.expected,
      got: { intent: r.d.intent.primary, score: r.d.intent.confidence, band: r.d.intent.band, risk: r.d.risk.level, reason: r.d.risk.reason, flags: r.d.risk.flags.map((f) => `${f.layer}:${f.kind}`), clarification: r.d.clarification?.trigger, params: r.d.intent.parameters, top3: r.d.candidates.slice(0, 3), plan: r.d.plan?.map((p) => p.intent) },
      scopeProblems: r.scopeProblems,
    }));

  const out = { at: new Date().toISOString(), corpus: path.relative(root, corpusFile).split(path.sep).join("/"), registryVersion: scout.registry.version, policyPackVersion: scout.policy.version, selfTest: scout.selfTestResult, leakage: { promptsEqualToRegistryExamples: leaked }, split: argSplit, metrics: report, failures };
  console.log(JSON.stringify({ metrics: report, leakage: out.leakage, selfTest: out.selfTest }, null, 2));
  if (failures.length) {
    console.log(`\n${failures.length} example(s) with at least one failed check:`);
    for (const f of failures) console.log(`- ${f.id}${f.heldout ? " [heldout]" : ""}: ${f.failed.join(", ")} | got ${JSON.stringify(f.got)}${f.scopeProblems.length ? ` | scope: ${f.scopeProblems.join("; ")}` : ""}`);
  }
  if (argSplit === "all") {
    fs.mkdirSync(path.join(root, "src/engines/results"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/engines/results/scout-pharmacy-eval.json"), JSON.stringify(out, null, 2) + "\n");
    fs.writeFileSync(path.join(root, "src/engines/results/scout-pharmacy-eval.md"), toMarkdown(out));
  }
  const all = (report.all ?? report[argSplit]) as { block_recall: { value: number | null } };
  process.exit(all.block_recall.value === 1 ? 0 : 1);
}

function toMarkdown(out: { at: string; metrics: Record<string, unknown>; leakage: { promptsEqualToRegistryExamples: string[] }; failures: { id: string; heldout: boolean; failed: string[]; prompt: string }[]; policyPackVersion: string; registryVersion: number }): string {
  const names = ["intent_accuracy", "multi_intent_plan", "risk_level_accuracy", "block_recall", "block_precision", "injection_recall", "injection_precision", "clarification_accuracy", "clarification_rate", "tool_plan_recall", "parameter_binding", "contract_scope_correct"];
  const cols = Object.keys(out.metrics);
  const cell = (v: { value: number | null; n: number; d: number }) => (v.value === null ? "n/a" : `${v.value.toFixed(3)} (${v.n}/${v.d})`);
  const lines = [
    "# Upstream Scout eval (pharmacy registry)",
    "",
    `_Generated ${out.at} by scripts/scout-eval.ts. Registry v${out.registryVersion}, policy ${out.policyPackVersion}. Prompts equal to a registry example: ${out.leakage.promptsEqualToRegistryExamples.length}._`,
    "",
    `| metric | ${cols.join(" | ")} |`,
    `|---|${cols.map(() => "---").join("|")}|`,
    ...names.map((n) => `| ${n} | ${cols.map((c) => cell((out.metrics[c] as Record<string, { value: number | null; n: number; d: number }>)[n])).join(" | ")} |`),
    "",
    "## Examples with a failed check",
    "",
    ...(out.failures.length ? out.failures.map((f) => `- \`${f.id}\`${f.heldout ? " (held-out)" : ""}: ${f.failed.join(", ")}. Prompt: "${f.prompt}"`) : ["None."]),
    "",
  ];
  return lines.join("\n");
}

main();
