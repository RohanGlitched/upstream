// Seed H-MEM with Corvale Health's past shortage decisions (fictional demo history, labelled as such).
//   npx tsx scripts/seed-memory.mts [--reset]
import { rmSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";

loadEnv();
const { openMemory } = await import("../src/engines/hmem.ts");

const dir = path.join(ROOT, ".state", "hmem");
if (process.argv.includes("--reset")) rmSync(dir, { recursive: true, force: true });
const memory = openMemory({ persistDir: dir });

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(`${iso}T15:00:00Z`);
const history = [
  {
    drug: "carboplatin", at: at("2023-05-16"), approvedBy: "Jordan Hale, PharmD",
    decision: "restrict carboplatin to curative-intent regimens while on allocation; oncology reviews each palliative order",
    rationale: "Two suppliers on allocation and under 10 days on hand at Corvale General (demo history)",
  },
  {
    drug: "carboplatin", at: at("2024-02-02"), approvedBy: "Riley Brooks, PharmD",
    decision: "move the primary carboplatin contract from Accord to Teva and keep Accord as secondary",
    rationale: "Accord's supplier plant had an FDA warning letter; Teva supply steadier (demo history)",
  },
  {
    drug: "cisplatin", at: at("2023-06-08"), approvedBy: "Jordan Hale, PharmD",
    decision: "transfer cisplatin between Corvale hospitals weekly instead of buying grey-market stock",
    rationale: "Grey-market offers were 6 to 10 times contract price with unverifiable pedigree (demo history)",
  },
  {
    drug: "lidocaine", at: at("2025-11-20"), approvedBy: "Alex Morgan, PharmD",
    decision: "switch lidocaine 1% 30 mL vials to 5 mL vials in the ED to reduce waste during the shortage",
    rationale: "Single-dose waste was a third of use (demo history)",
  },
];
for (const h of history) {
  await memory.rememberDecision({ ...h, ndcs: [], evidenceRefs: [] });
}
await memory.save?.();
console.log(`seeded ${history.length} decisions into ${path.relative(ROOT, dir)}`);
void DAY;
