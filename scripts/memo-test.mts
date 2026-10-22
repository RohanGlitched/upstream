// Draft the carboplatin memo and run the approval flow once, printing the audit trail.
import path from "node:path";
import { ROOT, loadEnv } from "./env.mts";
loadEnv();
const { getCase } = await import("../src/lib/cases.ts");
const { draftMemo, approveDecision } = await import("../src/agent/memo.ts");
const { HMEM } = await import("../src/engines/hmem.ts");
process.chdir(ROOT);
const c = (await getCase(process.argv[2] ?? "carboplatin"))!;
const m = await draftMemo(c);
console.log(m.refused ?? m.draft, "\n--", m.risk, m.contractId);
const tampered = m.contract ? { ...m.contract, scope: { ...m.contract.scope, capabilities: [...m.contract.scope.capabilities, "order.place"] } } : null;
console.log("tampered:", (await approveDecision(c, tampered, "Jordan Hale, PharmD", c.options[0].title, new HMEM())).reason);
const r = await approveDecision(c, m.contract, "Jordan Hale, PharmD", c.options[0].title, new HMEM());
console.log(r.status, r.memoryId);
for (const a of r.audit) console.log("  ", a.actor.padEnd(20), a.action);
void path;
