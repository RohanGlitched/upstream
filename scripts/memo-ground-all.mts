// Replay every recorded memo through the grounding check and report what it drops.
//   UPSTREAM_MODE=replay npx tsx scripts/memo-ground-all.mts [--show]
import { readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";
loadEnv();
process.chdir(ROOT);
const { getCase } = await import("../src/lib/cases.ts");
const { draftMemo } = await import("../src/agent/memo.ts");
let memos = 0, sentences = 0, tokens = 0, dropped = 0, failed = 0;
const reasons = new Map<string, number>();
for (const f of readdirSync(path.join(ROOT, "data", "cases")).filter((x) => x.endsWith(".json"))) {
  const slug = f.slice(0, -5);
  const c = (await getCase(slug))!;
  try {
    const m = await draftMemo(c, slug);
    if (!m.verifier) continue;
    memos++;
    sentences += m.verifier.checked;
    tokens += m.verifier.tokens;
    dropped += m.verifier.dropped.length;
    for (const d of m.verifier.dropped) {
      const k = d.reason.replace(/"[^"]*"/, '"…"');
      reasons.set(k, (reasons.get(k) ?? 0) + 1);
      if (process.argv.includes("--show")) console.log(`${slug}: ${d.reason}\n   ${d.text}`);
    }
  } catch (e) {
    failed++;
    console.log(slug, "FAIL", (e as Error).message.slice(0, 100));
  }
}
console.log(`${memos} memos replayed, ${failed} failed; ${sentences} sentences and ${tokens} dates/numbers checked; ${dropped} sentences dropped`);
for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
