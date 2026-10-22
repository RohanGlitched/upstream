// Draft (and so record) the P&T memo for every saved case, so the hosted copy can replay them.
import { readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";
loadEnv();
process.chdir(ROOT);
const { getCase } = await import("../src/lib/cases.ts");
const { draftMemo } = await import("../src/agent/memo.ts");
for (const f of readdirSync(path.join(ROOT, "data", "cases")).filter((x) => x.endsWith(".json"))) {
  const c = (await getCase(f.slice(0, -5)))!;
  const m = await draftMemo(c);
  console.log(f, m.refused ? `refused: ${m.refused}` : `${m.draft.split(/\s+/).length} words`);
}
