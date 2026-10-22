// Rewrite the explanation of saved cases without re-running Zetaris: the rows are already in each case, so only the
// rule-decided state, the derived lines and Nemotron's sentences change.
//   npx tsx scripts/re-explain.mts [slug ...] [--posted 2012-01-01]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";
loadEnv();
const { explain } = await import("../src/agent/explain.ts");
import type { Case } from "../src/agent/types.ts";

const args = process.argv.slice(2);
const posted = args.includes("--posted") ? args[args.indexOf("--posted") + 1] : null;
const named = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--posted");
const dir = path.join(ROOT, "data", "cases");
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const slug = f.slice(0, -5);
  if (named.length && !named.includes(slug)) continue;
  const c = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Case & { slug: string };
  if (posted && c.shortage.firstPosting !== posted) continue;
  // Derived lines are rebuilt from scratch, so stale ones from the earlier run cannot be cited.
  for (const id of Object.keys(c.evidence)) if (id.startsWith("D")) delete c.evidence[id];
  let e = await explain(c);
  for (let i = 0; i < 4 && e.verifier.rejected[0]?.reason.startsWith("model unavailable"); i++) {
    await new Promise((r) => setTimeout(r, 30_000 * (i + 1)));
    for (const id of Object.keys(c.evidence)) if (id.startsWith("D")) delete c.evidence[id];
    e = await explain(c);
  }
  c.explanation = e;
  writeFileSync(path.join(dir, f), JSON.stringify(c, null, 1));
  console.log(`${slug.padEnd(28)} ${e.state.padEnd(9)} ${e.verifier.rejected.length} rejected  ${e.headline}`);
}
