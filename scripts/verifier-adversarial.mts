// Adversarial check of the explanation verifier: false sentences written to sound right, run against the real
// carboplatin case, must all be dropped; true ones must pass. Then every sentence kept in the saved cases is
// re-checked, so tightening the verifier is measured both ways. Writes data/eval/verifier.json.
//   npx tsx scripts/verifier-adversarial.mts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mts";
const { verifySentence, repairCites, decideState } = await import("../src/agent/explain.ts");
import type { Case } from "../src/agent/types.ts";

const load = (slug: string) => JSON.parse(readFileSync(path.join(ROOT, "data", "cases", `${slug}.json`), "utf8")) as Case;
const carbo = load("carboplatin");
const ev = (pred: (text: string) => boolean) => Object.values(carbo.evidence).find((e) => pred(`${e.label} ${JSON.stringify(e.fields)}`))?.id ?? "E0";
const oaiInspection = ev((l) => /^FDA inspection 1191818/.test(l));
const lakesideStock = ev((l) => /^Corvale Lakeside holds/.test(l));
const letterGap = ev((l) => /OAI classification letter/.test(l));
const importAlert = ev((l) => /^Import alert 66-40, 2023-06-01/.test(l));
const warning = ev((l) => /warning letter/i.test(l));

// [kind of lie, sentence, cites]
const lies: [string, string, string[]][] = [
  ["wrong classification", "FDA inspection 1191818 at Intas ended 2022-12-02 and was classified NAI, so the plant is clear.", [oaiInspection]],
  ["wrong plant", "FDA inspection 1191818 at Teyro Labs ended 2022-12-02 and was classified OAI.", [oaiInspection]],
  ["wrong single-digit count", "Corvale Lakeside has 9 days on hand.", [lakesideStock]],
  ["causal claim", "FDA has stated that the Intas warning letter caused the shortage.", [warning]],
  ["number taken from an address", "Lakeside has 14 days on hand today.", [importAlert]],
  ["invented duration", "The import alert on 2023-06-01 was lifted after 5 months.", [importAlert]],
  ["number in words", "The OAI letter came twenty-three days before the posting.", [letterGap]],
  ["reversed direction", "The OAI letter came 23 days after FDA posted the shortage.", [letterGap]],
  ["wrong date", "FDA inspection 1191818 at Intas ended 2022-12-03.", [oaiInspection]],
  ["unknown citation", "The plant was inspected in 2022.", ["E999"]],
  ["no citation", "The plant was classified OAI.", []],
  ["wrong number", "The OAI letter came 32 days before FDA posted the shortage.", [letterGap]],
];
const truths: [string, string, string[]][] = [
  ["inspection", "FDA inspection 1191818 at Intas ended 2022-12-02 and was classified OAI.", [oaiInspection]],
  ["gap", "The OAI letter came 23 days before FDA posted the shortage.", [letterGap]],
];

let caught = 0;
// The same check the pipeline runs: verify, and if that fails, try to repair the citations.
const pack = Object.values(carbo.evidence);
const judge = (text: string, cites: string[]) => {
  const why = verifySentence({ text, cites }, carbo);
  return why && repairCites({ text, cites }, carbo, pack) ? null : why;
};
const rows = lies.map(([kind, text, cites]) => {
  const why = judge(text, cites);
  if (why) caught++;
  return { kind, text, cites, dropped: !!why, reason: why };
});
const truthRows = truths.map(([kind, text, cites]) => ({ kind, text, cites, passed: judge(text, cites) === null }));
for (const r of rows) console.log(`${r.dropped ? "dropped" : "MISSED "}  ${r.kind.padEnd(30)} ${r.reason ?? ""}`);
for (const r of truthRows) console.log(`${r.passed ? "passed " : "WRONGLY DROPPED"}  ${r.kind}`);

// Regression: sentences the saved cases kept under the earlier verifier.
let kept = 0, nowDropped = 0, repaired = 0;
const drops: { slug: string; text: string; reason: string }[] = [];
const states: Record<string, number> = {};
for (const f of readdirSync(path.join(ROOT, "data", "cases")).filter((x) => x.endsWith(".json"))) {
  const c = load(f.slice(0, -5));
  const st = decideState(c);
  states[st] = (states[st] ?? 0) + 1;
  for (const s of c.explanation?.sentences ?? []) {
    kept++;
    const why = verifySentence(s, c);
    if (why && repairCites(s, c, Object.values(c.evidence))) repaired++;
    else if (why) {
      nowDropped++;
      drops.push({ slug: f.slice(0, -5), text: s.text, reason: why });
    }
  }
}
console.log(`\nadversarial: ${caught} of ${lies.length} false sentences dropped; ${truthRows.filter((r) => r.passed).length} of ${truthRows.length} true ones passed`);
console.log(`saved cases: ${nowDropped} of ${kept} previously kept sentences would now be dropped (${repaired} more kept by adding the right citation)`);
console.log(`states under the current rule:`, states);
const byReason: Record<string, number> = {};
for (const d of drops) {
  const k = d.reason.replace(/\d[\d.-]*/g, "N").replace(/".*?"/g, "…").replace(/^.* is not in the cited evidence$/, "a firm or plant is not in the cited evidence");
  byReason[k] = (byReason[k] ?? 0) + 1;
}
console.log(byReason);
writeFileSync(
  path.join(ROOT, "data", "eval", "verifier.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), case: "carboplatin", adversarial: { caught, of: lies.length, rows }, truths: truthRows, savedCases: { kept, nowDropped, repaired, byReason, sample: drops.slice(0, 40) }, states }, null, 1),
);
