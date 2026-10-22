"use client";

// The memo and its approval as a real signature flow: Upstream types the memo on letterhead under its own
// Scout contract; a named pharmacist signs on the line (the pen follows the name as it is typed); only then
// is the decision recorded, and the audit trail is typed out underneath.
import { useId, useState, type CSSProperties } from "react";
import { postJson } from "../lib/useApi";
import { fmtDateLong, fmtTime } from "../lib/format";
import { drugTitle } from "../lib/drug";
import { Signature } from "../record/Signature";
import { Stamp } from "../record/bits";
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
        const style = { "--i": i } as CSSProperties;
        if (m) {
          const rest = l.slice(m[0].length);
          return (
            <p key={i} style={style}>
              <strong className="memo-sec">{m[1]}.</strong>
              {rest ? <> {rest}</> : null}
            </p>
          );
        }
        return (
          <p key={i} style={style} className={/^\d+[.)]\s/.test(l) ? "memo-item" : undefined}>
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
  const title = drugTitle(molecule);

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

  const signed = result?.status === "approved";
  const name = approver.trim();

  return (
    <div className="memo">
      <article className={`memo-paper${phase.k === "drafted" ? " is-typed" : ""}`} aria-label="Memo to the P&T committee" aria-busy={phase.k === "drafting"}>
        <header className="memo-lh">
          <div>
            <p className="memo-org">Corvale Health</p>
            <p className="memo-dept">Department of Pharmacy, purchasing</p>
          </div>
          <p className="memo-kind">Memorandum</p>
        </header>
        <dl className="memo-head">
          <div>
            <dt>To</dt>
            <dd>Pharmacy and Therapeutics committee</dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>Pharmacy purchasing, drafted by Upstream</dd>
          </div>
          <div>
            <dt>Re</dt>
            <dd>{title} shortage</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{fmtDateLong(asOf)}</dd>
          </div>
        </dl>

        {phase.k === "idle" ? (
          <div className="memo-blank">
            {[94, 88, 72, 0, 90, 84, 60].map((w, i) => (w ? <span key={i} className="memo-rule" style={{ width: `${w}%` }} /> : <span key={i} className="memo-gap" />))}
            <div className="memo-start">
              <p>
                Upstream types this memo from the verified sentences and the ranked options, under a Scout contract of its own.
                Nothing is recorded until a named pharmacist signs.
              </p>
              <button type="button" className="btn btn--primary" onClick={draft}>
                Type the memo
              </button>
            </div>
          </div>
        ) : null}

        {phase.k === "drafting" ? (
          <div className="memo-blank is-typing">
            {[92, 86, 70, 0, 90, 82, 64, 0, 88, 54].map((w, i) =>
              w ? <span key={i} className="memo-rule" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} /> : <span key={i} className="memo-gap" />,
            )}
            <p className="memo-wait">Typing from the case&apos;s verified sentences. This takes a few seconds.</p>
          </div>
        ) : null}

        {phase.k === "error" ? (
          <div className={`notice${phase.missing ? "" : " notice--error"}`}>
            <span className="notice__mark" aria-hidden="true">{phase.missing ? "i" : "!"}</span>
            <h3>{phase.missing ? "Memo drafting is not on this copy" : "The memo was not typed"}</h3>
            <p>
              {phase.message}{" "}
              <button type="button" className="btn btn--quiet btn--small" onClick={draft}>
                Type it again
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
            <MemoText text={phase.memo.draft} />
            <dl className="memo-contract">
              <div>
                <dt>Contract</dt>
                <dd>{phase.memo.contractId ?? "none"}</dd>
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

            <form className="memo-sign" onSubmit={approve}>
              <div className="memo-fields">
                <label htmlFor={`${ids}-d`}>
                  <span>Decision to record</span>
                  <select id={`${ids}-d`} value={decision} onChange={(e) => setDecision(e.target.value)} disabled={signed}>
                    {decisions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor={`${ids}-a`}>
                  <span>Approving pharmacist, full name and credential</span>
                  <input
                    id={`${ids}-a`}
                    list={`${ids}-al`}
                    value={approver}
                    onChange={(e) => setApprover(e.target.value)}
                    placeholder="for example Jordan Hale, PharmD"
                    autoComplete="off"
                    required
                    minLength={3}
                    maxLength={60}
                    disabled={signed}
                  />
                  <datalist id={`${ids}-al`}>
                    {approvers.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </label>
              </div>

              <div className={`memo-line${signed ? " is-signed" : ""}`}>
                <div className="memo-line__pen">
                  {name.length >= 3 ? <Signature key={signed ? "signed" : name} name={name} draw={signed} className={signed ? "" : "is-ghost"} /> : null}
                </div>
                <span className="memo-line__x" aria-hidden="true">
                  X
                </span>
                <span className="memo-line__cap">{signed ? `Signed by ${name}` : name.length >= 3 ? `To be signed by ${name}` : "Signature of the approving pharmacist"}</span>
                {signed ? <Stamp className="memo-stamp" tone="carbon" top={result?.memoryId ?? ""} big="RECORDED" bottom="IN H-MEM, UNDER CONTRACT" w={200} h={96} /> : null}
              </div>

              {!signed ? (
                <div className="memo-actions">
                  <button type="submit" className="btn btn--primary" disabled={approving || name.length < 3}>
                    {approving ? "Recording the signature" : "Sign and record"}
                  </button>
                  <span className="memo-hint">Records the decision in H-MEM under this name, with the contract and the evidence.</span>
                </div>
              ) : null}
              {approveError ? <p className="memo-err">{approveError}</p> : null}
              {result?.status === "refused" ? <p className="memo-err">Refused: {result.reason}</p> : null}
            </form>
          </>
        ) : null}
        <p className="memo-mark">{signed ? "Approved." : "Draft. Not approved."}</p>
      </article>

      {!(result && result.audit.length) ? (
        <aside className="memo-route" aria-label="Routing slip">
          <p className="memo-route__h">Routing slip</p>
          <ol>
            {[
              ["Typed by Upstream", "under a memo.draft contract from Scout", phase.k === "drafted"],
              ["Read and signed", "by a named pharmacist, on the line", signed],
              ["Recorded in H-MEM", "under a decision.record contract", signed],
              ["Recalled next time", "when anyone asks about this drug again", false],
            ].map(([a, b, done], i) => (
              <li key={i} className={done ? "is-done" : undefined}>
                <span className="memo-route__box" aria-hidden="true">
                  {done ? "✓" : ""}
                </span>
                <span>
                  <b>{a as string}</b>
                  <span>{b as string}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="memo-route__n">The memo informs. It orders nothing, moves no stock and changes no dose.</p>
        </aside>
      ) : null}

      {result && result.audit.length ? (
        <div className={`memo-audit${signed ? " is-ok" : ""}`}>
          <h3>{signed ? `Audit trail, recorded as ${result.memoryId}` : "What happened"}</h3>
          <ol>
            {result.audit.map((a, i) => {
              const refused = /refused/i.test(a.action);
              const allowed = /allowed|approved|stored|verified|issued/i.test(a.action) && !refused;
              return (
                <li key={i} className={refused ? "is-refused" : allowed ? "is-allowed" : undefined} style={{ "--i": i } as CSSProperties}>
                  <span className="memo-audit__t">{fmtTime(a.at)}</span>
                  <span className="memo-audit__who">{a.actor}</span>
                  <span className="memo-audit__what">{a.action}</span>
                </li>
              );
            })}
          </ol>
          {result.decisionContractId ? <p className="memo-audit__c">Approved contract {result.decisionContractId}.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
