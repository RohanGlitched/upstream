// Final judge round: 14 more false sentences written to get past the verifier (run against the carboplatin case).
//   npx tsx scripts/verifier-final-round.mts
import { readFileSync } from "node:fs";
import { ROOT } from "./env.mts";
const { verifySentence, repairCites } = await import("../src/agent/explain.ts");
const { caseClaimProblem } = await import("../src/agent/verify.ts");
const load = (s: string) => JSON.parse(readFileSync(`${ROOT}/data/cases/${s}.json`, "utf8"));
const c = load("carboplatin");
const pack = Object.values(c.evidence) as any[];
const judge = (cc: any, text: string, cites: string[]) => {
  const why = verifySentence({ text, cites }, cc);
  if (!why) return null;
  return repairCites({ text, cites }, cc, Object.values(cc.evidence)) ? null : why;
};
const lies: [string, string, string[]][] = [
  ["reversed transfer", "The rule-ranked best option transfers 3 vials of 10 mg/mL, 60 mL from Corvale Lakeside to Corvale East.", ["D13"]],
  ["wrong hospital", "Corvale General holds 2 vials of carboplatin 10 mg/mL, 60 mL, 1.5 days on hand.", ["D3"]],
  ["class spelled out", "Teyro Labs inspection 1291008 ended 2025-11-12 and was classified Official Action Indicated.", ["E10"]],
  ["unlisted causal phrase", "The OAI inspection 1191818 at Intas is the reason carboplatin went short.", ["E17"]],
  ["status synonym", "As of 2026-10-21 carboplatin is no longer on FDA's shortage list.", ["D12"]],
  ["slash date", "FDA inspection 1191818 at Intas ended 12/9/2022 and was classified OAI.", ["E17"]],
  ["absence via zero", "Intas has had zero warning letters from FDA.", ["E21"]],
  ["false denial of true class", "FDA inspection 1092798 at Intas was not classified VAI.", ["E14"]],
  // extras
  ["wrong order", "The Intas warning letter came before the import alert listing.", ["D8", "D9"]],
  ["ratio word", "Corvale Lakeside uses twice as much 60 mL carboplatin a day as Corvale East.", ["D1", "D3"]],
  ["wrong presentation", "Corvale Lakeside's 5 mL carboplatin vial is at 1.5 days on hand.", ["D3"]],
  ["pulled", "Teva pulled its carboplatin 60 mL vial from the market.", ["E29"]],
  ["never inspected", "Teyro Labs has never been inspected by FDA.", ["E11"]],
  ["a month", "Corvale East's 60 mL stock lasts more than a month.", ["D1"]],
];
for (const [k, t, ci] of lies) {
  const why = judge(c, t, ci);
  const memo = caseClaimProblem(t, c);
  console.log(`${why ? "dropped" : "MISSED "} | memo:${memo ? "flag" : "PASS"} | ${k} | ${why ?? ""}`);
}
for (const slug of ["carboplatin", "cisplatin", "heparin", "vancomycin"]) {
  const cc = load(slug);
  let ok = 0, n = 0;
  for (const s of cc.explanation?.sentences ?? []) { n++; const w = judge(cc, s.text, s.cites); if (!w) ok++; else console.log("  DROP", slug, s.text, w); }
  console.log(slug, `${ok}/${n} saved sentences pass`);
}
