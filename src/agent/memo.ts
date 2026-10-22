// The P&T memo (drafted by Nemotron from a case's verified sentences and ranked options) and the approval
// that records a decision in H-MEM. Both go through Scout: drafting needs a memo.draft contract; recording
// needs a decision.record contract carrying a named pharmacist's approval before hmem.write is allowed.
import { chat, MODELS } from "../lib/nemotron";
import { assertContract, verifyContract, type ExecutionContract } from "../engines/scout/index.ts";
import { createUpstreamScout } from "../engines/scout/upstream.ts";
import type { HMEM } from "../engines/hmem.ts";
import type { Case } from "./types";
import { tallMan } from "./util";

const SECRET = process.env.SCOUT_SIGNING_SECRET ?? "upstream-local-dev-secret";

export interface MemoDraft {
  draft: string;
  contract: ExecutionContract | null;
  contractId: string | null;
  risk: string;
  needs: string;
  refused?: string;
}

export async function draftMemo(c: Case, user = { id: "buyer-1", role: "buyer" as const }): Promise<MemoDraft> {
  const scout = createUpstreamScout({ signingSecret: SECRET });
  const d = await scout.decide({ prompt: `Draft a P&T memo on the ${c.molecule} shortage`, user, surface: "chat" });
  const contract = d.executionContract ?? null;
  if (!contract || d.risk.level === "block") {
    return { draft: "", contract: null, contractId: null, risk: d.risk.level, needs: "", refused: d.risk.reason ?? "Scout issued no contract for a memo." };
  }
  assertContract(contract, "memo.draft", { secret: SECRET, engine: "memo" });
  const facts = (c.explanation?.sentences ?? []).map((s) => `- ${s.text}`).join("\n");
  const opts = c.options.slice(0, 5).map((o, i) => `${i + 1}. ${o.title} — ${o.detail} (needs: ${o.needs})`).join("\n");
  const stock = c.stock.map((s) => `${s.hospital}: ${s.description}, ${s.onHand} on hand, ${s.days ?? "-"} days`).join("\n");
  const r = await chat(
    [
      {
        role: "system",
        content:
          "You draft a short memo from a hospital pharmacy buyer to the Pharmacy and Therapeutics (P&T) committee about a drug shortage. Use only the facts given. Sections: Situation, Why (FDA record), Our position, Recommended actions (numbered, each naming who must approve), Not recommended. Under 230 words. Plain sentences, no markdown headers beyond the section names followed by a colon. Say what FDA's records show and when; never say an FDA action caused, explains or underlies the shortage unless FDA itself states that reason. Never give dosing or clinical advice; clinical changes are for the treating clinicians and the committee.",
      },
      {
        role: "user",
        content: `Drug: ${tallMan(c.molecule)}\nAs of: ${c.asOf}\nFDA status: ${c.shortage.status ?? "not listed"} since ${c.shortage.firstPosting ?? "-"}\n\nVerified facts:\n${facts}\n\nStock:\n${stock}\n\nRanked options:\n${opts}`,
      },
    ],
    { model: MODELS.reason, maxTokens: 900, temperature: 0.2 },
  );
  return {
    draft: r.text.trim(), contract, contractId: contract.contractId, risk: d.risk.level,
    needs: "A named pharmacist approves the decision before Upstream records it.",
  };
}

export interface ApprovalResult {
  status: "approved" | "refused";
  reason?: string;
  memoryId?: string;
  decisionContractId?: string;
  audit: { at: string; actor: string; action: string }[];
}

/** Record the committee's decision: Scout issues a decision.record contract, the named pharmacist approves it,
 *  the executor checks hmem.write against the approved contract, then H-MEM stores it with provenance. */
export async function approveDecision(
  c: Case,
  memoContract: unknown,
  approver: string,
  decision: string,
  memory: HMEM,
): Promise<ApprovalResult> {
  const audit: ApprovalResult["audit"] = [];
  const now = () => new Date().toISOString();
  const name = approver.trim();
  if (!/^[A-Za-z][A-Za-z .,'-]{2,60}$/.test(name)) return { status: "refused", reason: "Give the approver's full name, for example \"Jordan Hale, PharmD\".", audit };
  const m = verifyContract(memoContract, "memo.draft", { secret: SECRET });
  if (!m.ok) return { status: "refused", reason: `The memo's contract did not verify (${m.reason}).`, audit };
  audit.push({ at: now(), actor: "scout", action: `memo contract ${m.contract.contractId.slice(-8)} verified` });

  const scout = createUpstreamScout({ signingSecret: SECRET });
  // The decision text is data, not part of the prompt Scout classifies: a decision that mentions a
  // transfer must not be read as a request to draft one.
  const d = await scout.decide({ prompt: `Record our approved ${c.molecule.split(" ")[0]} shortage decision`, user: { id: "rx-approver", role: "pharmacist" }, surface: "chat" });
  if (!d.executionContract || d.risk.level === "block") return { status: "refused", reason: d.risk.reason ?? "Scout issued no contract to record a decision.", audit };
  audit.push({ at: now(), actor: "scout", action: `decision.record contract ${d.executionContract.contractId.slice(-8)} issued (${d.risk.level} risk)` });
  try {
    assertContract(d.executionContract, "hmem.write", { secret: SECRET, engine: "hmem" });
    audit.push({ at: now(), actor: "executor", action: "hmem.write allowed without approval (unexpected)" });
  } catch (e) {
    audit.push({ at: now(), actor: "executor", action: `hmem.write refused before approval: ${(e as Error).message.slice(0, 90)}` });
  }
  const approved = scout.approve(d.executionContract, { kind: "named-approver", by: name, role: "pharmacist" });
  audit.push({ at: now(), actor: name, action: `approved contract ${approved.contractId.slice(-8)}` });
  assertContract(approved, "hmem.write", { secret: SECRET, engine: "hmem" });
  audit.push({ at: now(), actor: "executor", action: "hmem.write allowed on the approved contract" });
  const rec = await memory.rememberDecision({
    drug: c.molecule.split(" ")[0], decision, approvedBy: name,
    rationale: c.explanation?.headline ?? `${c.molecule} shortage`,
    evidenceRefs: [`case:${c.id}`, `contract:${approved.contractId}`, ...(c.options[0]?.evidence.slice(0, 3) ?? [])],
  });
  audit.push({ at: now(), actor: "h-mem", action: `decision stored as ${rec.id} with provenance` });
  return { status: "approved", memoryId: rec.id, decisionContractId: approved.contractId, audit };
}
