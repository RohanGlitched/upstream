// The gate log as a stamped register, and the run's cost as a till receipt.
import type { Case } from "../../src/agent/types";
import { BoxStamp } from "../record/bits";
import { fmtInt, fmtMs } from "../lib/format";
import "./registers.css";

const TONE = { allowed: "carbon", "needs approval": "amber", refused: "red" } as const;

export function GateRegister({ c }: { c: Case }) {
  const counts = c.gate.reduce<Record<string, number>>((a, g) => ((a[g.decision] = (a[g.decision] ?? 0) + 1), a), {});
  return (
    <div className="reg">
      <div className="reg-head">
        <div>
          <span className="reg-fl">Register</span>
          <span className="reg-fv">
            Meterless Scout gate, contract <span className="reg-chip">{c.intent.contractId?.slice(-8) ?? "none"}</span>
          </span>
        </div>
        <div>
          <span className="reg-fl">Intent</span>
          <span className="reg-fv">
            {c.intent.name}, <span className="reg-nw">{c.intent.risk} risk</span>
          </span>
        </div>
        <div>
          <span className="reg-fl">Entries</span>
          <span className="reg-fv">
            {c.gate.length}: {counts.allowed ?? 0} allowed, {counts["needs approval"] ?? 0} held, {counts.refused ?? 0} refused
          </span>
        </div>
      </div>
      {c.gate.length ? (
        <ol className="reg-rows">
          {c.gate.map((g, i) => (
            <li key={i}>
              <span className="reg-no">{String(i + 1).padStart(2, "0")}</span>
              <span className="reg-t">{g.at.slice(11, 19)}</span>
              <span className="reg-act">
                <b>{g.action}</b>
                <span>{g.capability}</span>
              </span>
              <span className="reg-why">{g.reason}</span>
              <span className="reg-stamp">
                <span className="reg-stamp__by">Meterless Scout</span>
                <BoxStamp tone={TONE[g.decision]} tilt={((i * 37) % 5) - 2.5}>
                  {g.decision.toUpperCase()}
                </BoxStamp>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="reg-empty">No tool call reached the gate.</p>
      )}
    </div>
  );
}

export function Receipt({ c }: { c: Case }) {
  const rows = c.steps.reduce((a, s) => a + s.rows, 0);
  const lines: [string, string][] = [
    ["Steps run", String(c.steps.length)],
    ["Zetaris queries", String(c.usage.zetarisQueries)],
    ["Query time", fmtMs(c.usage.zetarisMs)],
    ["Rows read", fmtInt(rows)],
    ["Model calls", String(c.usage.modelCalls)],
    ["Tokens in", fmtInt(c.usage.tokensIn)],
    ["Tokens out", fmtInt(c.usage.tokensOut)],
    ["Gate checks", String(c.gate.length)],
    ["Evidence rows", String(Object.keys(c.evidence).length)],
  ];
  return (
    <div className="rcpt" role="group" aria-label="What this investigation took">
      <div className="rcpt-in">
        <p className="rcpt-h">
          UPSTREAM
          <br />
          Corvale Health pharmacy
        </p>
        <p className="rcpt-m">
          {c.askedAt.slice(0, 10)} {c.askedAt.slice(11, 19)}
          <br />
          case {c.id.slice(-6)}, {c.usage.mode}
        </p>
        <hr />
        <dl>
          {lines.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <hr />
        <dl className="rcpt-total">
          <div>
            <dt>Tokens, total</dt>
            <dd>{fmtInt(c.usage.tokensIn + c.usage.tokensOut)}</dd>
          </div>
        </dl>
        <p className="rcpt-foot">
          One model call wrote the answer.
          <br />
          Everything else was a query.
        </p>
        <svg className="rcpt-bar" viewBox="0 0 120 22" preserveAspectRatio="none" aria-hidden="true">
          {Array.from({ length: 46 }, (_, i) => {
            const w = ((c.id.charCodeAt(i % c.id.length) + i) % 3) + 1;
            return <rect key={i} x={i * 2.6} y="0" width={w * 0.7} height="22" />;
          })}
        </svg>
      </div>
    </div>
  );
}
