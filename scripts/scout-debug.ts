// Debug helper: print Stage-1 components for prompts (tuning split only, or prompts given on argv).
import fs from "node:fs";
import { Scorer, scanTokens } from "../src/engines/scout/scoring.ts";
import { Lexicon } from "../src/engines/scout/lexicon.ts";
import { IntentRegistry } from "../src/engines/scout/registry.ts";
const reg = IntentRegistry.fromFile("src/engines/scout/registry/pharmacy-intents.json");
const lex = new Lexicon();
const sc = new Scorer(reg, lex);
const prompts = process.argv.slice(2).length ? process.argv.slice(2) : fs.readFileSync("src/engines/scout/evals/pharmacy.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => !e.heldout).map((e) => e.prompt);
for (const p of prompts) {
  const n = lex.normalise(p);
  const toks = scanTokens(n.text);
  const d = [...sc.lexicalDetail(toks)].sort((a, b) => b[1].lex - a[1].lex).slice(0, 2);
  console.log(p, "|", toks.join(" "));
  for (const [id, v] of d) console.log(`   ${id.padEnd(26)} lex=${v.lex.toFixed(3)} cov=${v.coverage.toFixed(3)} ex=${v.exemplar.toFixed(3)} trig=${v.trigger.toFixed(3)} sup=${v.support.toFixed(3)}`);
}
