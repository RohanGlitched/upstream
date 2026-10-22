"use client";

// Part B of the batch record: each sentence with its citation marks ringed in the margin. Opening a mark
// lays the carbon of that record under the sentence; the full row and its SQL are one more click away.
import { useState } from "react";
import type { Evidence, Explanation } from "../../src/agent/types";
import { tallMan } from "../../src/agent/util";
import { useEvidence } from "../Evidence";
import { Ring, TickMark, Typed } from "../record/bits";

export function Findings({ explanation, evidence }: { explanation: Explanation; evidence: Record<string, Evidence> }) {
  const [open, setOpen] = useState<{ i: number; id: string } | null>(null);
  const ev = useEvidence();
  return (
    <ol className="br-findings">
      {explanation.sentences.map((s, i) => {
        const cur = open?.i === i ? open.id : null;
        const e = cur ? evidence[cur] : null;
        return (
          <li key={i} className="br-fnd">
            <div className="br-fnd__cites">
              {s.cites.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="br-cite"
                  aria-expanded={cur === c}
                  aria-controls={`br-slip-${i}`}
                  onClick={() => setOpen(cur === c ? null : { i, id: c })}
                >
                  {c}
                  <Ring />
                </button>
              ))}
            </div>
            <div className="br-fnd__txt">
              <span className="br-fnd__no">B{i + 1}</span>
              {tallMan(s.text)}
            </div>
            <div className="br-fnd__ok">
              <TickMark size={22} />
              verified
            </div>
            <div className={`br-slip${e ? " is-open" : ""}`} id={`br-slip-${i}`} role="region" aria-label={cur ? `Carbon of ${cur}` : undefined}>
              {e && cur ? (
                <>
                  <h4>
                    Carbon of {cur}: {e.label}
                  </h4>
                  <dl>
                    {Object.entries(e.fields)
                      .filter(([, v]) => v !== null && v !== "")
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt>{k.replace(/_/g, " ")}</dt>
                          <dd>
                            <Typed text={String(v)} />
                          </dd>
                        </div>
                      ))}
                  </dl>
                  <p className="br-slip__foot">
                    {e.queryId === "derived" ? (
                      "Computed by Upstream from rows already in this case; no query ran for it."
                    ) : (
                      <>
                        Row {e.row + 1} of query {e.queryId}.{" "}
                        {ev ? (
                          <button type="button" className="br-link" onClick={() => ev.open(cur, s.cites)}>
                            Read the row and its SQL
                          </button>
                        ) : null}
                      </>
                    )}
                  </p>
                </>
              ) : null}
            </div>
          </li>
        );
      })}
      {explanation.verifier.rejected.map((r, i) => (
        <li key={`x${i}`} className="br-fnd is-dropped">
          <div className="br-fnd__cites" />
          <div className="br-fnd__txt">
            <span className="br-fnd__no">X{i + 1}</span>
            <s>{tallMan(r.text)}</s>
            <span className="br-fnd__why">Dropped by the verifier: {r.reason}</span>
          </div>
          <div className="br-fnd__ok br-fnd__ok--x">dropped</div>
        </li>
      ))}
    </ol>
  );
}
