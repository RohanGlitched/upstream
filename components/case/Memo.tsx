"use client";

// The memo and its approval as a real signature flow: Upstream types the memo on letterhead under its own
// Scout contract, and a verifier checks every date and number in it against the case. The approver signs in
// (demo sign-in: pick your name, enter the demo PIN printed beside it; in a hospital this is single sign-on),
// the server issues a short-lived signed session, and only then does the signature ink in on the line. The
// approver's name and role come from that session, never from the form. The audit trail is typed out underneath.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { postJson } from "../lib/useApi";
import { fmtDateLong, fmtTime } from "../lib/format";
import { drugTitle, tallText } from "../lib/drug";
import { Signature } from "../record/Signature";
import { Stamp } from "../record/bits";
import "./memo.css";

interface MemoReply {
  draft: string;
  contract: unknown;
  contractId: string | null;
  expiresAt?: string | null;
  risk: string;
  needs: string;
  refused?: string;
  verifier?: { checked: number; tokens: number; dropped: { text: string; reason: string }[] };
}

interface ApproveReply {
  status: "approved" | "refused";
  reason?: string;
  memoryId?: string;
  decisionContractId?: string;
  audit: { at: string; actor: string; action: string }[];
}

interface SessionReply {
  token: string;
  name: string;
  role: string;
  canApprove: boolean;
  expiresAt: string;
}

export interface StaffCard {
  id: string;
  name: string;
  role: string;
  title: string;
  demoPin: string;
}

type Phase =
  | { k: "idle" }
  | { k: "drafting" }
  | { k: "drafted"; memo: MemoReply }
  | { k: "refused"; reason: string }
  | { k: "error"; message: string; missing: boolean };

const SECTION = /^(Situation|Why \(FDA record\)|Why|Our position|Recommended actions|Not recommended)\s*:\s*/i;
const ROLE_WORD: Record<string, string> = { pharmacist: "Pharmacist", director: "Director", buyer: "Buyer" };

const CPS = 380; // characters a second: quick for a reader, slow enough to read as typing

/** The memo on letterhead. With `type`, it is typed out a character at a time in Courier Prime, then `onDone`
 *  fires; without it (reduced motion) it is shown whole at once. */
function MemoText({ text, type, onDone }: { text: string; type: boolean; onDone?: () => void }) {
  const lines = text.replace(/\*\*/g, "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const total = lines.reduce((a, l) => a + l.length, 0);
  const [n, setN] = useState(type ? 0 : total);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (!type) {
      done.current?.();
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(total, Math.floor(((t - t0) / 1000) * CPS));
      setN(k);
      if (k < total) raf = requestAnimationFrame(tick);
      else done.current?.();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [type, total]);

  let left = n;
  return (
    <div className={`memo-text${type ? " is-typing" : ""}`}>
      {/* the whole memo for assistive tech at once; the typed copy beside it is what the eye sees */}
      <p className="sr-only">{lines.join(" ")}</p>
      {lines.map((l, i) => {
        if (left <= 0) return null;
        const shown = Math.min(left, l.length);
        left -= l.length;
        const caret = n < total && (shown < l.length || left <= 0) ? <span className="memo-caret" aria-hidden="true" /> : null;
        const m = SECTION.exec(l);
        const style = { "--i": i } as CSSProperties;
        const body = (s: string): ReactNode => (s.startsWith("[Removed by the verifier") ? <span className="memo-removed">{s.replace(/^\[|\]$/g, "")}</span> : s);
        if (m) {
          const head = `${m[1]}.`;
          const rest = l.slice(m[0].length);
          const rs = Math.max(0, shown - m[0].length);
          return (
            <p key={i} style={style} aria-hidden="true">
              <strong className="memo-sec">{head.slice(0, Math.min(head.length, shown))}</strong>
              {rest && rs ? <> {rs >= rest.length ? body(rest) : rest.slice(0, rs)}</> : null}
              {caret}
            </p>
          );
        }
        return (
          <p key={i} style={style} aria-hidden="true" className={/^\d+[.)]\s/.test(l) ? "memo-item" : undefined}>
            {shown >= l.length ? body(l) : l.slice(0, shown)}
            {caret}
          </p>
        );
      })}
    </div>
  );
}

function Verifier({ v }: { v: NonNullable<MemoReply["verifier"]> }) {
  return (
    <div className={`memo-ver${v.dropped.length ? " has-drops" : ""}`}>
      <p className="memo-ver__h">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          Verifier: {v.checked} sentences checked, {v.tokens} dates and numbers found in this case&apos;s evidence
          {v.dropped.length ? `, ${v.dropped.length} ${v.dropped.length === 1 ? "sentence" : "sentences"} dropped` : ", none dropped"}.
        </span>
      </p>
      {v.dropped.length ? (
        <ol className="memo-ver__list">
          {v.dropped.map((d, i) => (
            <li key={i}>
              <s>{tallText(d.text)}</s>
              <span>Dropped: {d.reason}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function Memo({ slug, molecule, asOf, staff, decisions }: { slug: string; molecule: string; asOf: string; staff: StaffCard[]; decisions: string[] }) {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [decision, setDecision] = useState(decisions[0] ?? "");
  const [note, setNote] = useState("");
  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [session, setSession] = useState<SessionReply | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState<ApproveReply | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [typedOut, setTypedOut] = useState(false);
  const [typeIt, setTypeIt] = useState(false);
  const paper = useRef<HTMLElement>(null);
  const ids = useId();
  const title = drugTitle(molecule);
  const picked = staff.find((s) => s.id === staffId) ?? null;

  const draft = async () => {
    setPhase({ k: "drafting" });
    setResult(null);
    setApproveError(null);
    const r = await postJson<MemoReply>("/api/memo", { slug });
    if (!r.ok) return setPhase({ k: "error", message: r.message, missing: r.missing });
    if (r.data.refused || !r.data.draft) return setPhase({ k: "refused", reason: r.data.refused ?? "Scout issued no contract for a memo." });
    setTypedOut(false);
    setPhase({ k: "drafted", memo: r.data });
  };

  // The memo types itself the first time its sheet scrolls into view: nobody should meet a blank page.
  const started = useRef(false);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  useEffect(() => {
    const el = paper.current;
    if (!el || started.current) return;
    const io = new IntersectionObserver(
      (ents) => {
        if (!ents.some((e) => e.isIntersecting) || started.current) return;
        started.current = true;
        io.disconnect();
        setTypeIt(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
        void draftRef.current();
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setSigningIn(true);
    setSignInError(null);
    const r = await postJson<SessionReply>("/api/session", { staffId: picked.id, pin });
    setSigningIn(false);
    if (!r.ok) return setSignInError(r.message);
    setSession(r.data);
    setPin("");
    setResult(null);
  };

  const signOut = () => {
    setSession(null);
    setResult(null);
    setApproveError(null);
  };

  const approve = async () => {
    if (phase.k !== "drafted" || !session) return;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      setSession(null);
      return setSignInError("Your session expired. Sign in again.");
    }
    setApproving(true);
    setApproveError(null);
    const r = await postJson<ApproveReply>("/api/approve", { slug, contract: phase.memo.contract, decision, note }, { authorization: `Bearer ${session.token}` });
    setApproving(false);
    if (!r.ok) return setApproveError(r.message);
    setResult(r.data);
  };

  const signed = result?.status === "approved";
  const expired = result?.status === "refused" && /expired/i.test(result.reason ?? "");
  // A memo signed once cannot be signed again (409): the way on is a fresh memo.
  const spent = !!approveError && /already signed/i.test(approveError);
  // The name on the line: the signed-in person's (from the server), or the one picked, as a ghost.
  const lineName = session?.name ?? picked?.name ?? "";

  return (
    <div className="memo">
      <article
        ref={paper}
        className={`memo-paper${phase.k === "drafted" ? " is-typed" : ""}`}
        aria-label="Memo to the P&T committee"
        aria-busy={phase.k === "drafting" || (phase.k === "drafted" && !typedOut)}
      >
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
                Upstream types this memo from the verified sentences and the ranked options, under a Scout contract bound to this
                case. A verifier then checks every date and number in it. Nothing is recorded until a signed-in pharmacist signs.
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
            <MemoText text={phase.memo.draft} type={typeIt && !typedOut} onDone={() => setTypedOut(true)} />
            {typedOut && phase.memo.verifier ? <Verifier v={phase.memo.verifier} /> : null}
            <dl className="memo-contract">
              <div>
                <dt>Contract</dt>
                <dd>{phase.memo.contractId ?? "none"}</dd>
              </div>
              <div>
                <dt>Bound to</dt>
                <dd>{slug}</dd>
              </div>
              {phase.memo.expiresAt ? (
                <div>
                  <dt>Expires</dt>
                  <dd>{fmtTime(phase.memo.expiresAt)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Risk</dt>
                <dd>{phase.memo.risk}</dd>
              </div>
            </dl>

            <div className="memo-sign">
              <div className="memo-fields">
                <label htmlFor={`${ids}-d`}>
                  <span>Decision to record: one of the ranked options</span>
                  <select id={`${ids}-d`} value={decision} onChange={(e) => setDecision(e.target.value)} disabled={signed}>
                    {decisions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor={`${ids}-n`}>
                  <span>Note, optional (kept as your quoted words)</span>
                  <input id={`${ids}-n`} value={note} onChange={(e) => setNote(e.target.value.slice(0, 160))} maxLength={160} placeholder="for example: review again Friday" autoComplete="off" disabled={signed} />
                </label>
              </div>

              {!signed ? (
                <section className={`memo-id${session ? " is-in" : ""}`} aria-labelledby={`${ids}-idh`}>
                  <header className="memo-id__h">
                    <p id={`${ids}-idh`}>{session ? "Signed in" : "Who is signing?"}</p>
                    <span className="memo-id__tag">Demo sign-in. In a hospital this comes from single sign-on.</span>
                  </header>

                  {session ? (
                    <div className="memo-id__who">
                      <span className="memo-id__dot" aria-hidden="true" />
                      <span>
                        <b>{session.name}</b>
                        <span>
                          {ROLE_WORD[session.role] ?? session.role}. Session signed by the server, until {fmtTime(session.expiresAt)}.
                          {session.canApprove ? "" : " Buyers can read and draft, but cannot approve: Scout will refuse."}
                        </span>
                      </span>
                      <button type="button" className="btn btn--quiet btn--small" onClick={signOut}>
                        Switch person
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={signIn}>
                      <fieldset className="memo-id__roster">
                        <legend className="sr-only">Corvale pharmacy staff</legend>
                        {staff.map((s) => (
                          <label key={s.id} className={`memo-id__p${staffId === s.id ? " is-picked" : ""}${s.role === "buyer" ? " is-buyer" : ""}`}>
                            <input type="radio" name={`${ids}-who`} value={s.id} checked={staffId === s.id} onChange={() => { setStaffId(s.id); setSignInError(null); }} />
                            <span className="memo-id__name">{s.name}</span>
                            <span className="memo-id__title">{s.title}</span>
                            <span className="memo-id__pin" aria-label={`Demo PIN ${s.demoPin.split("").join(" ")}`}>
                              PIN {s.demoPin}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                      <div className="memo-id__go">
                        <label htmlFor={`${ids}-pin`}>
                          <span>{picked ? `Demo PIN for ${picked.name.split(",")[0]}` : "Pick your name, then enter its demo PIN"}</span>
                          <input
                            id={`${ids}-pin`}
                            value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                            inputMode="numeric"
                            autoComplete="off"
                            pattern="\d{4}"
                            placeholder="4 digits"
                            disabled={!picked}
                            required
                          />
                        </label>
                        <button type="submit" className="btn btn--primary" disabled={!picked || pin.length !== 4 || signingIn}>
                          {signingIn ? "Signing in" : "Sign in"}
                        </button>
                      </div>
                      {signInError ? <p className="memo-err">{signInError}</p> : null}
                    </form>
                  )}
                </section>
              ) : null}

              <div className={`memo-line${signed ? " is-signed" : ""}`}>
                <div className="memo-line__pen">
                  {lineName ? <Signature key={signed ? "signed" : lineName} name={lineName} draw={signed} className={signed ? "" : "is-ghost"} /> : null}
                </div>
                <span className="memo-line__x" aria-hidden="true">
                  X
                </span>
                <span className="memo-line__cap">
                  {signed ? `Signed by ${session?.name}` : session ? `To be signed by ${session.name}` : picked ? `Sign in to sign as ${picked.name}` : "Signature of the approving pharmacist"}
                </span>
                {signed ? <Stamp className="memo-stamp" tone="carbon" top={result?.memoryId ?? ""} big="RECORDED" bottom="IN H-MEM, UNDER CONTRACT" w={200} h={96} /> : null}
              </div>

              {!signed ? (
                <div className="memo-actions">
                  <button type="button" className="btn btn--primary" onClick={approve} disabled={!session || approving}>
                    {approving ? "Recording the signature" : "Sign and record"}
                  </button>
                  <span className="memo-hint">
                    {session ? `Records the decision in H-MEM as ${session.name}'s, with the contract and the evidence.` : "Sign in first. The server takes the name and role from the session, not from this form."}
                  </span>
                </div>
              ) : null}
              {approveError ? (
                <p className="memo-err">
                  {approveError}{" "}
                  {spent ? (
                    <button type="button" className="btn btn--quiet btn--small" onClick={draft}>
                      Type the memo again
                    </button>
                  ) : null}
                </p>
              ) : null}
              {result?.status === "refused" ? (
                <p className="memo-err">
                  Refused: {result.reason}{" "}
                  {expired ? (
                    <button type="button" className="btn btn--quiet btn--small" onClick={draft}>
                      Type the memo again
                    </button>
                  ) : null}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
        <p className="memo-mark">{signed ? "Approved." : "Draft. Not approved."}</p>
      </article>

      {!(result && result.audit.length) ? (
        <aside className="memo-route" aria-label="Routing slip">
          <p className="memo-route__h">Routing slip</p>
          <ol>
            {[
              ["Typed by Upstream", "under a memo.draft contract bound to this case, then checked by the verifier", phase.k === "drafted"],
              ["Signed in", "a Corvale pharmacist or the director (demo PIN here, single sign-on in a hospital)", !!session?.canApprove],
              ["Read and signed", "on the line, under the signed-in name", signed],
              ["Recorded in H-MEM", "under a decision.record contract, as the approver's quoted words", signed],
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
              const allowed = /allowed|approved|stored|verified|issued|signed in/i.test(a.action) && !refused;
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
