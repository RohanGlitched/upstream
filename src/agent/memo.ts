// The P&T memo (drafted by Nemotron from a case's verified sentences and ranked options) and the approval
// that records a decision in H-MEM. Both go through Scout: drafting needs a memo.draft contract bound to the case
// and drug; recording needs a decision.record contract, bound the same way, carrying the approval of a signed-in
// pharmacist or director before hmem.write is allowed. The approver's name and role come from a verified session.
import { chat, MODELS } from "../lib/nemotron";
import { assertContract, verifyContract, type ExecutionContract } from "../engines/scout/index.ts";
import { createUpstreamScout } from "../engines/scout/upstream.ts";
import { quoteDecision, type HMEM } from "../engines/hmem.ts";
import type { Case } from "./types";
import { baseMolecule, tallMan } from "./util";
import { groundMemo, type Dropped } from "./ground";
import { canApprove } from "./staff";

const SECRET = process.env.SCOUT_SIGNING_SECRET ?? "upstream-local-dev-secret";

export interface MemoDraft {
  draft: string;
  contract: ExecutionContract | null;
  contractId: string | null;
  expiresAt: string | null;
  risk: string;
  needs: string;
  refused?: string;
  /** The grounding check run on the model's text: sentences checked, numbers and dates matched, sentences dropped. */
  verifier?: { checked: number; tokens: number; dropped: Dropped[] };
}

/** What a memo contract is bound to: the case it was drafted for and the drug. */
export const memoSubject = (slug: string, c: Case) => ({ case: slug, drug: c.molecule });

export async function draftMemo(c: Case, slug: string, user = { id: "buyer-1", role: "buyer" as const }): Promise<MemoDraft> {
  const scout = createUpstreamScout({ signingSecret: SECRET });
  const d = await scout.decide({ prompt: `Draft a P&T memo on the ${c.molecule} shortage`, user, surface: "chat", subject: memoSubject(slug, c) });
  const contract = d.executionContract ?? null;
  if (!contract || d.risk.level === "block") {
    return { draft: "", contract: null, contractId: null, expiresAt: null, risk: d.risk.level, needs: "", refused: d.risk.reason ?? "Scout issued no contract for a memo." };
  }
  assertContract(contract, "memo.draft", { secret: SECRET, engine: "memo", expectSubject: memoSubject(slug, c) });
  const facts = (c.explanation?.sentences ?? []).map((s) => `- ${s.text}`).join("\n");
  const opts = c.options.slice(0, 5).map((o, i) => `${i + 1}. ${o.title} — ${o.detail} (needs: ${o.needs})`).join("\n");
  const stock = c.stock.map((s) => `${s.hospital}: ${s.description}, ${s.onHand} on hand, ${s.days ?? "-"} days`).join("\n");
  // The prompt is unchanged from the recorded runs, so the hosted copy replays the recorded replies.
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
  // The model's text is checked after the call: every date and number must be in the case's evidence lines,
  // and causal claims FDA did not make are dropped.
  const g = groundMemo(r.text.trim(), c);
  // A draft names who must approve each action; it never says an action is already approved. (Interchanges the
  // P&T committee approved earlier are on file, so "already approved by the P&T committee" stays.)
  const draft = g.text.replace(/\b(?<!already )approved by (the )?(pharmacy director|director|pharmacist|buyer|treating prescriber|treating oncologist)/gi, "for approval by $1$2");
  return {
    draft, contract, contractId: contract.contractId, expiresAt: contract.expiresAt, risk: d.risk.level,
    needs: "A signed-in Corvale pharmacist or the director approves the decision before Upstream records it.",
    verifier: { checked: g.checked, tokens: g.tokens, dropped: g.dropped },
  };
}

export interface Approver {
  /** staff id, from the verified session */
  id: string;
  name: string;
  role: string;
}

export interface ApprovalResult {
  status: "approved" | "refused";
  reason?: string;
  memoryId?: string;
  decisionContractId?: string;
  /** The memo contract was already used for an approval: the route answers 409. */
  conflict?: boolean;
  audit: { at: string; actor: string; action: string }[];
}

export const NOTE_MAX = 160;

// Memo contracts already spent on an approval. A memo.draft contract lasts five minutes and is not single-use on its
// own, so one signed memo could otherwise approve the same decision twice. In memory only: on the hosted demo each
// serverless instance keeps its own set, so this holds per instance; a hospital deployment would keep it in H-MEM.
const spentMemoContracts = new Set<string>();
export const MEMO_SPENT = "This memo was already signed; type the memo again to record another decision.";

/** Whether a note gives dosing or order instructions, by Scout's own read of it (the same classifier that refuses
 *  them at the desk). Returns the reason to show, or null. Other flags (an odd phrase) stay quoted data. */
async function noteInstruction(note: string, approver: Approver): Promise<string | null> {
  if (!note) return null;
  const d = await createUpstreamScout({ signingSecret: SECRET }).decide({ prompt: note, user: { id: approver.id, role: approver.role }, surface: "chat" });
  if (d.risk.level !== "block" || !["clinical.dosing_advice", "order.place"].includes(d.intent.primary)) return null;
  return `The note reads as a ${d.intent.primary === "order.place" ? "purchase order" : "dosing"} instruction, and Upstream records neither. Remove it from the note; Scout: ${d.risk.reason ?? "refused"}`;
}

const norm = (s: string) => quoteDecision(s).toLowerCase();

/** The decision must be one of the case's ranked options (Upstream never records free text as a decision); the
 *  approver may attach a short note, which is kept as quoted data next to the option. */
export function chooseOption(c: Case, optionTitle: string, note = ""): { option: Case["options"][number]; text: string } | null {
  const want = norm(optionTitle);
  const option = want ? c.options.find((o) => norm(o.title) === want) : undefined;
  if (!option) return null;
  const n = quoteDecision(note).slice(0, NOTE_MAX).trim();
  return { option, text: n ? `${option.title}; approver's note: ${n}` : option.title };
}

/** Record the committee's decision: the decision must be one of the case's ranked options; the memo contract must
 *  verify for this case and drug and be unexpired; Scout issues a decision.record contract for the signed-in
 *  approver's own role (a buyer is refused there); the approver approves it; the executor checks hmem.write against
 *  the approved contract; H-MEM stores the decision as a quote. */
export async function approveDecision(
  c: Case,
  slug: string,
  memoContract: unknown,
  approver: Approver,
  optionTitle: string,
  memory: HMEM,
  note = "",
): Promise<ApprovalResult> {
  const audit: ApprovalResult["audit"] = [];
  const now = () => new Date().toISOString();
  const subject = memoSubject(slug, c);
  const chosen = chooseOption(c, optionTitle, note);
  if (!chosen) return { status: "refused", reason: "The decision must be one of this case's ranked options. A free-text note can be attached to the chosen option.", audit };
  const decision = quoteDecision(chosen.text);
  const bad = await noteInstruction(quoteDecision(note).slice(0, NOTE_MAX).trim(), approver);
  if (bad) {
    audit.push({ at: now(), actor: "scout", action: "note refused: dosing or order instruction" });
    return { status: "refused", reason: bad, audit };
  }
  const m = verifyContract(memoContract, "memo.draft", { secret: SECRET, expectSubject: subject });
  if (!m.ok) {
    const why =
      m.reason === "expired" ? "The memo's contract has expired (contracts last five minutes). Type the memo again for a fresh contract."
      : m.reason === "subject-mismatch" ? `The memo's contract was issued for a different case (${m.detail}).`
      : `The memo's contract did not verify (${m.reason}).`;
    audit.push({ at: now(), actor: "scout", action: `memo contract refused: ${m.reason}` });
    return { status: "refused", reason: why, audit };
  }
  const memoId = m.contract.contractId;
  if (spentMemoContracts.has(memoId)) {
    audit.push({ at: now(), actor: "scout", action: `memo contract ${memoId.slice(-8)} refused: already used` });
    return { status: "refused", reason: MEMO_SPENT, conflict: true, audit };
  }
  audit.push({ at: now(), actor: "scout", action: `memo contract ${memoId.slice(-8)} verified for ${slug}` });
  audit.push({ at: now(), actor: "session", action: `${approver.name} signed in as ${approver.role}` });

  // Claimed here, before any await, so two concurrent approvals cannot both pass; given back if the approval is refused.
  spentMemoContracts.add(memoId);
  const scout = createUpstreamScout({ signingSecret: SECRET });
  // The decision text is data, not part of the prompt Scout classifies: a decision that mentions a
  // transfer must not be read as a request to draft one.
  const d = await scout.decide({ prompt: `Record our approved ${baseMolecule(c.molecule)} shortage decision`, user: { id: approver.id, role: approver.role }, surface: "chat", subject });
  if (!d.executionContract || d.risk.level === "block") {
    spentMemoContracts.delete(memoId);
    audit.push({ at: now(), actor: "scout", action: `decision.record refused for role ${approver.role}` });
    const why = canApprove(approver.role) ? d.risk.reason ?? "Scout issued no contract to record a decision." : `${approver.name} is signed in as a ${approver.role}; only a pharmacist or the director can approve. Scout: ${d.risk.reason ?? "no contract issued"}`;
    return { status: "refused", reason: why, audit };
  }
  audit.push({ at: now(), actor: "scout", action: `decision.record contract ${d.executionContract.contractId.slice(-8)} issued (${d.risk.level} risk)` });
  try {
    assertContract(d.executionContract, "hmem.write", { secret: SECRET, engine: "hmem", expectSubject: subject });
    audit.push({ at: now(), actor: "executor", action: "hmem.write allowed without approval (unexpected)" });
  } catch (e) {
    audit.push({ at: now(), actor: "executor", action: `hmem.write refused before approval: ${(e as Error).message.slice(0, 90)}` });
  }
  const approved = scout.approve(d.executionContract, { kind: "named-approver", by: approver.name, role: approver.role });
  audit.push({ at: now(), actor: approver.name, action: `approved contract ${approved.contractId.slice(-8)}` });
  assertContract(approved, "hmem.write", { secret: SECRET, engine: "hmem", expectSubject: subject });
  audit.push({ at: now(), actor: "executor", action: "hmem.write allowed on the approved contract" });
  const rec = await memory.rememberDecision({
    drug: baseMolecule(c.molecule), decision, approvedBy: approver.name,
    rationale: c.explanation?.headline ?? `${c.molecule} shortage`,
    evidenceRefs: [`case:${c.id}`, `contract:${approved.contractId}`, `option:${chosen.option.rank}`, ...chosen.option.evidence.slice(0, 3)],
  }).catch((e) => {
    spentMemoContracts.delete(memoId); // nothing was recorded, so the memo can be used again
    throw e;
  });
  audit.push({ at: now(), actor: "h-mem", action: `decision stored as ${rec.id}, quoted as ${approver.name.split(",")[0]}'s words` });
  return { status: "approved", memoryId: rec.id, decisionContractId: approved.contractId, audit };
}
