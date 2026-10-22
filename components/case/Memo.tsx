"use client";

import { useId, useState } from "react";
import { postJson } from "../lib/useApi";
import { fmtDateLong, fmtTime } from "../lib/format";
import { drugTitle } from "../lib/drug";
import "./memo.css";

interface MemoReply {
  draft: string;
  contract: unknown;
  contractId: string | null;
  risk: string;
  needs: string;
  refused?: string;
}

interface ApproveReply {
  status: "approved" | "refused";
  reason?: string;
  memoryId?: string;
  decisionContractId?: string;
  audit: { at: string; actor: string; action: string }[];
}

type Phase =
  | { k: "idle" }
  | { k: "drafting" }
  | { k: "drafted"; memo: MemoReply }
  | { k: "refused"; reason: string }
  | { k: "error"; message: string; missing: boolean };

const SECTION = /^(Situation|Why \(FDA record\)|Why|Our position|Recommended actions|Not recommended)\s*:\s*/i;

function MemoText({ text }: { text: string }) {
  const lines = text.replace(/\*\*/g, "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return (
    <div className="memo-text">
      {lines.map((l, i) => {
        const m = SECTION.exec(l);
        if (m) {
          const rest = l.slice(m[0].length);
          return (
            <p key={i}>
              <strong className="memo-sec">{m[1]}</strong>
              {rest ? <> {rest}</> : null}
            </p>
          );
        }
        return (
          <p key={i} className={/^\d+[.)]\s/.test(l) ? "memo-item" : undefined}>
            {l}
          </p>
        );
      })}
    </div>
  );
}

export function Memo({
  slug,
  molecule,
  asOf,
  approvers,
  decisions,
}: {
  slug: string;
  molecule: string;
  asOf: string;
  approvers: string[];
  decisions: string[];
}) {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [approver, setApprover] = useState("");
  const [decision, setDecision] = useState(decisions[0] ?? "");
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState<ApproveReply | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const ids = useId();

  const draft = async () => {
    setPhase({ k: "drafting" });
    setResult(null);
    setApproveError(null);
    const r = await postJson<MemoReply>("/api/memo", { slug });
    if (!r.ok) return setPhase({ k: "error", message: r.message, missing: r.missing });
    if (r.data.refused || !r.data.draft) return setPhase({ k: "refused", reason: r.data.refused ?? "Scout issued no contract for a memo." });
    setPhase({ k: "drafted", memo: r.data });
  };

  const approve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase.k !== "drafted") return;
    setApproving(true);
    setApproveError(null);
    const r = await postJson<ApproveReply>("/api/approve", { slug, contract: phase.memo.contract, approver: approver.trim(), decision });
    setApproving(false);
    if (!r.ok) return setApproveError(r.message);
    setResult(r.data);
  };

  return (
    <div className="memo">
      {phase.k === "idle" ? (
        <div className="memo-start">
          <p>
            Upstream drafts a short memo to the P&amp;T committee from the verified sentences and the ranked options.
            Drafting runs under its own Scout contract. Nothing is recorded until a named pharmacist approves.
          </p>
          <button type="button" className="btn btn--primary" onClick={draft}>
            Draft the memo
          </button>
        </div>
      ) : null}

      {phase.k === "drafting" ? (
        <div className="memo-paper" aria-busy="true" aria-label="Drafting the memo">
          <div className="memo-head">
            <span className="skel" style={{ width: 220, height: 14 }} />
            <span className="skel" style={{ width: 160, height: 14, marginTop: 8 }} />
          </div>
          {[92, 86, 70, 0, 90, 82, 64, 0, 88, 54].map((w, i) =>
            w ? <span key={i} className="skel skel-line" style={{ width: `${w}%` }} /> : <span key={i} style={{ display: "block", height: 14 }} />,
          )}
          <p className="small muted memo-wait">Drafting from the case&apos;s verified sentences. This takes a few seconds.</p>
        </div>
      ) : null}

      {phase.k === "error" ? (
        <div className={`notice${phase.missing ? "" : " notice--error"}`}>
          <span className="notice__mark" aria-hidden="true">{phase.missing ? "i" : "!"}</span>
          <h3>{phase.missing ? "Memo drafting is not on this copy" : "The memo was not drafted"}</h3>
          <p>
            {phase.message}{" "}
            <button type="button" className="btn btn--quiet btn--small" onClick={draft}>
              Try again
            </button>
          </p>
        </div>
      ) : null}

      {phase.k === "refused" ? (
        <div className="notice notice--error">
          <span className="notice__mark" aria-hidden="true">!</span>
          <h3>Scout refused to draft a memo</h3>
          <p>{phase.reason}</p>
        </div>
      ) : null}

      {phase.k === "drafted" ? (
        <>
          <article className="memo-paper" aria-label="Memo draft">
            <dl className="memo-head">
              <div>
                <dt>To</dt>
                <dd>Pharmacy and Therapeutics committee, Corvale Health</dd>
              </div>
              <div>
                <dt>From</dt>
                <dd>Pharmacy purchasing</dd>
              </div>
              <div>
                <dt>Re</dt>
                <dd>{drugTitle(molecule)} shortage</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{fmtDateLong(asOf)}</dd>
              </div>
            </dl>
            <MemoText text={phase.memo.draft} />
            <p className="memo-draftmark">Draft. Not approved.</p>
          </article>
          <dl className="memo-contract">
            <div>
              <dt>Contract</dt>
              <dd className="num">{phase.memo.contractId ?? "none"}</dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>{phase.memo.risk}</dd>
            </div>
            <div>
              <dt>Needs</dt>
              <dd>{phase.memo.needs}</dd>
            </div>
          </dl>

          {!result || result.status === "refused" ? (
            <form className="memo-approve" onSubmit={approve}>
              <h3>Approve and record the decision</h3>
              <div className="memo-fields">
                <label htmlFor={`${ids}-d`}>
                  Decision
                  <select id={`${ids}-d`} value={decision} onChange={(e) => setDecision(e.target.value)}>
                    {decisions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor={`${ids}-a`}>
                  Approving pharmacist
                  <input
                    id={`${ids}-a`}
                    list={`${ids}-al`}
                    value={approver}
                    onChange={(e) => setApprover(e.target.value)}
                    placeholder="Full name and credential, for example Jordan Hale, PharmD"
                    autoComplete="off"
                    required
                    minLength={3}
                    maxLength={60}
                  />
                  <datalist id={`${ids}-al`}>
                    {approvers.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </label>
              </div>
              <div className="memo-actions">
                <button type="submit" className="btn btn--primary" disabled={approving || approver.trim().length < 3}>
                  {approving ? "Recording" : "Approve and record"}
                </button>
                <span className="small muted">Records the decision in H-MEM under this name, with the contract and evidence.</span>
              </div>
              {approveError ? <p className="memo-err">{approveError}</p> : null}
              {result?.status === "refused" ? <p className="memo-err">Refused: {result.reason}</p> : null}
            </form>
          ) : null}

          {result && result.audit.length ? (
            <div className={`memo-audit${result.status === "approved" ? " is-ok" : ""}`}>
              <h3>{result.status === "approved" ? `Recorded as ${result.memoryId}` : "What happened"}</h3>
              <ol>
                {result.audit.map((a, i) => {
                  const refused = /refused/i.test(a.action);
                  const allowed = /allowed|approved|stored|verified|issued/i.test(a.action) && !refused;
                  return (
                    <li key={i} className={refused ? "is-refused" : allowed ? "is-allowed" : undefined}>
                      <span className="memo-audit__t num">{fmtTime(a.at)}</span>
                      <span className="memo-audit__who">{a.actor}</span>
                      <span className="memo-audit__what">{a.action}</span>
                    </li>
                  );
                })}
              </ol>
              {result.decisionContractId ? (
                <p className="small muted">Approved contract {result.decisionContractId}.</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
