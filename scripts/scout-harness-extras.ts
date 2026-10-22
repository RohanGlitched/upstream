// Scores the expectations in the Meterless Scout v1 corpus that the
// Meterless harness loads but never compares: expected.clarification,
// expected.risk (non-block), and expected.intents (multi-intent plans).
// Same Scout construction as the harness (fixture registry, default +
// adversarial-tight packs). Writes src/engines/results/scout-harness-extras.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Scout } from "../src/engines/scout/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, "vendor/meterless/scout-intent/evals");
const corpus = ["intents", "injection", "multi-intent", "edge-cases"].flatMap((d) =>
  fs.readdirSync(path.join(base, "regression-set/v1", d)).filter((f) => f.endsWith(".jsonl")).flatMap((f) =>
    fs.readFileSync(path.join(base, "regression-set/v1", d, f), "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
  ),
);

async function main() {
  const scout = new Scout({ intentRegistry: path.join(base, "fixtures/intents.json"), policyPack: ["default", "adversarial-tight"] });
  const rows: { id: string; clarification: boolean | null; risk: boolean | null; multi: boolean | null; got: unknown; expected: unknown }[] = [];
  for (const ex of corpus) {
    const d = await scout.decide({ prompt: ex.prompt, user: { id: "eval", role: ex.user?.role ?? "ae" }, surface: ex.surface ?? "chat" });
    rows.push({
      id: ex.id,
      clarification: ex.expected.clarification === undefined ? null : !!d.clarification === ex.expected.clarification,
      risk: ex.expected.risk === undefined ? null : d.risk.level === ex.expected.risk,
      multi: ex.expected.intents ? ex.expected.intents.every((i: string) => (d.plan ?? []).some((p) => p.intent === i)) : null,
      got: { intent: d.intent.primary, risk: d.risk.level, clarification: d.clarification?.trigger ?? null, plan: d.plan?.map((p) => p.intent) ?? null },
      expected: ex.expected,
    });
  }
  const m = (k: "clarification" | "risk" | "multi") => {
    const app = rows.filter((r) => r[k] !== null);
    return { value: app.length ? Number((app.filter((r) => r[k]).length / app.length).toFixed(3)) : null, n: app.filter((r) => r[k]).length, d: app.length };
  };
  const out = { at: new Date().toISOString(), note: "Not scored by the Meterless harness; measured here with the same Scout construction.", clarification_accuracy: m("clarification"), risk_label_agreement: m("risk"), multi_intent_plan_recall: m("multi"), misses: rows.filter((r) => r.clarification === false || r.risk === false || r.multi === false) };
  fs.mkdirSync(path.join(root, "src/engines/results"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/engines/results/scout-harness-extras.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
}

main();
