// Draft (and so record) the P&T memo for every saved case, so the hosted copy can replay them.
//   npx tsx scripts/record-memos.mts [--parallel 6]
// Recorded memos come back from the cache at once, so a re-run only pays for cases that changed.
import { readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";
loadEnv();
process.chdir(ROOT);
const { getCase } = await import("../src/lib/cases.ts");
const { draftMemo } = await import("../src/agent/memo.ts");

const lanes = process.argv.includes("--parallel") ? Number(process.argv[process.argv.indexOf("--parallel") + 1]) : 6;
const queue = readdirSync(path.join(ROOT, "data", "cases")).filter((x) => x.endsWith(".json"));
const t0 = Date.now();
let done = 0;

async function one(f: string) {
  const c = (await getCase(f.slice(0, -5)))!;
  // The hosted model's free tier rate-limits bursts (HTTP 429): back off and try the same case again.
  for (let attempt = 0; ; attempt++) {
    try {
      const m = await draftMemo(c);
      console.log(`${String(++done).padStart(3)} ${f}`, m.refused ? `refused: ${m.refused}` : `${m.draft.split(/\s+/).length} words`);
      return;
    } catch (e) {
      if (attempt >= 9) {
        console.log(f, `FAIL ${(e as Error).message.slice(0, 120)}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1) + Math.random() * 10_000));
    }
  }
}

await Promise.all(Array.from({ length: lanes }, async () => {
  for (let f = queue.shift(); f; f = queue.shift()) await one(f);
}));
console.log(`done: ${done} memos in ${Math.round((Date.now() - t0) / 1000)} s`);
