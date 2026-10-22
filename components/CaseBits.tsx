import type { Explanation } from "../src/agent/types";
import { Cites } from "./Evidence";
import { SYRINGE_LABEL, syringeClass, drugTitle, tallText } from "./lib/drug";
import "./casebits.css";

export const STATE_WORDS: Record<Explanation["state"], { short: string; long: string; tone: string }> = {
  confirmed: {
    short: "Confirmed signal",
    long: "Confirmed: FDA recorded an action at a plant on our own labels.",
    tone: "signal",
  },
  check: {
    short: "Check this",
    long: "Check this: the link is weak, a name match or a row that failed a data-quality rule.",
    tone: "caution",
  },
  no_signal: {
    short: "No public signal",
    long: "No public signal found at the plants on our labels.",
    tone: "plain",
  },
};

export function StateBadge({ state }: { state: Explanation["state"] | null | undefined }) {
  if (!state) return <span className="tag tag--plain">Not explained</span>;
  const w = STATE_WORDS[state];
  return <span className={`tag tag--${w.tone}`}>{w.short}</span>;
}

/** The small syringe-label class mark, only for drugs that have one. */
export function ClassMark({ molecule }: { molecule: string }) {
  const k = syringeClass(molecule);
  if (!k) return null;
  return (
    <span className="class-mark" style={{ background: `var(--sy-${k})` }} title={`${SYRINGE_LABEL[k]} (syringe label colour)`}>
      <span className="sr-only">{SYRINGE_LABEL[k]}</span>
    </span>
  );
}

export function DrugName({ molecule, as: As = "span", className }: { molecule: string; as?: "span" | "h1" | "h2" | "h3"; className?: string }) {
  return (
    <As className={`drug-name${className ? ` ${className}` : ""}`}>
      <ClassMark molecule={molecule} />
      {drugTitle(molecule)}
    </As>
  );
}

export function WhyList({ explanation, numbered = false }: { explanation: Explanation; numbered?: boolean }) {
  const L = numbered ? "ol" : "ul";
  return (
    <L className="why">
      {explanation.sentences.map((s, i) => (
        <li key={i}>
          <span>{tallText(s.text)}</span>
          <Cites ids={s.cites} label={`Sentence ${i + 1}`} />
        </li>
      ))}
    </L>
  );
}

export function Dropped({ explanation }: { explanation: Explanation }) {
  const r = explanation.verifier.rejected;
  const kept = explanation.sentences.length;
  return (
    <details className="dropped">
      <summary>
        <span>
          {r.length
            ? `The verifier dropped ${r.length} of ${r.length + kept} sentences`
            : `The verifier checked ${explanation.verifier.checked} sentences and dropped none`}
        </span>
      </summary>
      <div className="dropped-body">
        <p className="muted small">
          Each sentence the model writes is checked against the rows it cites: every date and number must appear in that
          evidence, and every citation must exist. Sentences that fail are removed before anyone reads them.
        </p>
        {r.length ? (
          <ul>
            {r.map((x, i) => (
              <li key={i}>
                <s className="dropped-text">{tallText(x.text)}</s>
                <span className="dropped-why">{x.reason.charAt(0).toUpperCase() + x.reason.slice(1)}.</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
