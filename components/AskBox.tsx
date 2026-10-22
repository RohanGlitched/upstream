import Link from "next/link";
import { EXAMPLES } from "./examples";
import "./ask.css";


/** The ask box as a plain form: it works before any script loads, and the desk picks the question up. */
export function AskBox({ examples = EXAMPLES, id = "ask", headingLevel = 2 }: { examples?: string[]; id?: string; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="ask">
      <H className="ask-title" id={`${id}-title`}>
        Ask about a drug on our formulary
      </H>
      <form className="ask-form" action="/desk" method="get" aria-labelledby={`${id}-title`}>
        <label htmlFor={`${id}-q`} className="sr-only">
          Your question
        </label>
        <input
          id={`${id}-q`}
          name="q"
          className="ask-input"
          type="text"
          autoComplete="off"
          placeholder="Why is carboplatin short, and what do we do?"
          maxLength={400}
          required
        />
        <button type="submit" className="btn btn--primary ask-go">
          Investigate
        </button>
      </form>
      <div className="ask-examples">
        <span className="muted small">Or try one a buyer asked this week:</span>
        <ul>
          {examples.map((q) => (
            <li key={q}>
              <Link href={`/desk?q=${encodeURIComponent(q)}`}>{q}</Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
