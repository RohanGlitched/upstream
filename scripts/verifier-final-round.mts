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
// A firm's action pinned on another firm (heparin): the 2017-02-14 warning letter went to Hospira (FEI 1925262), but the
// sentence gives it to Baxter's FEI 2618677 by citing the gap line plus a Baxter warning letter from 2013.
{
  const h = load("heparin");
  const find = (re: RegExp) => (Object.values(h.evidence) as any[]).find((e) => re.test(`${e.label} ${JSON.stringify(e.fields)}`));
  const gap = find(/^Warning Letter issued 2017-02-14/);
  const baxter = find(/^Warning Letter 2013-05-31.*"fei":"2618677"/);
  const why = judge(h, `Baxter's plant (FEI 2618677) received a Warning Letter on 2017-02-14, ${gap?.fields.days} days before the posting.`, [gap?.id, baxter?.id]);
  console.log(`${why ? "dropped" : "MISSED "} | firm action from another plant (heparin) | ${why ?? ""}`);
  // The same gap with the right firm passes.
  const ok = judge(h, `Hospira's plant (FEI 1925262) received a Warning Letter on 2017-02-14, ${gap?.fields.days} days before the posting.`, [gap?.id, find(/^Warning Letter 2017-02-14/)?.id].filter(Boolean));
  console.log(`${ok ? `WRONGLY DROPPED (${ok})` : "passed "} | true firm action (heparin)`);
  // A letter's date paired with the end date's gap (bacteriostatic, cisplatin, potassium chloride): one dated event per line.
  const k = load("potassium-chloride");
  const kf = (re: RegExp) => (Object.values(k.evidence) as any[]).find((e) => re.test(`${e.label} ${JSON.stringify(e.fields)}`));
  const end = kf(/^FDA inspection 1106244.*days (before|after)/);
  const lie = judge(k, `FDA inspection 1106244 ended 2019-09-06 and was classified OAI, with a classification letter dated 2020-05-25, ${end?.fields.days} days before the posting.`, [end?.id, kf(/classification letter.*1106244/)?.id].filter(Boolean));
  console.log(`${lie ? "dropped" : "MISSED "} | letter date with the end date's gap (potassium chloride) | ${lie ?? ""}`);
}
for (const slug of ["carboplatin", "cisplatin", "heparin", "vancomycin"]) {
  const cc = load(slug);
  let ok = 0, n = 0;
  for (const s of cc.explanation?.sentences ?? []) { n++; const w = judge(cc, s.text, s.cites); if (!w) ok++; else console.log("  DROP", slug, s.text, w); }
  console.log(slug, `${ok}/${n} saved sentences pass`);
}
