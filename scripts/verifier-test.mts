// Unit checks for the explanation verifier and citation repair (no model, no Zetaris).
import assert from "node:assert/strict";
import { verifySentence, repairCites } from "../src/agent/explain.ts";
import type { Case, Evidence } from "../src/agent/types.ts";
const ev: Record<string, Evidence> = {
  E1: { id: "E1", queryId: "Q-1", row: 0, label: "FDA inspection 1191818 (OAI)", fields: { end_date: "2022-12-02", classification: "OAI" } },
  D1: { id: "D1", queryId: "derived", row: -1, label: "OAI letter 23 days before the posting on 2023-04-28", fields: { days: 23 } },
};
const c = { evidence: ev } as unknown as Case;
assert.equal(verifySentence({ text: "The inspection ended 2022-12-02.", cites: ["E1"] }, c), null);
assert.match(verifySentence({ text: "The inspection ended 2022-12-03.", cites: ["E1"] }, c)!, /date 2022-12-03/);
assert.match(verifySentence({ text: "It came 23 days before.", cites: ["E1"] }, c)!, /number 23/);
assert.match(verifySentence({ text: "Anything.", cites: ["E9"] }, c)!, /unknown evidence/);
assert.match(verifySentence({ text: "Nothing cited.", cites: [] }, c)!, /cites nothing/);
const fixed = repairCites({ text: "The letter came 23 days before.", cites: ["E1"] }, c, Object.values(ev));
assert.deepEqual(fixed?.cites, ["E1", "D1"]);
assert.equal(repairCites({ text: "It came 24 days before.", cites: ["E1"] }, c, Object.values(ev)), null);
assert.equal(verifySentence({ text: "Written as 2 December 2022.", cites: ["E1"] }, c), null);
assert.equal(verifySentence({ text: "Written as December 2, 2022.", cites: ["E1"] }, c), null);
console.log("verifier: 9 checks passed");
