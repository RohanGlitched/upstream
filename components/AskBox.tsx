import Link from "next/link";
import { EXAMPLES } from "./examples";
import "./ask.css";

/** The ask box as a typed request slip. A plain GET form: it works before any script loads, and the desk
 *  picks the question up and files it. */
export function AskBox({ examples = EXAMPLES, id = "ask", headingLevel = 2 }: { examples?: string[]; id?: string; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="ask">
      <form className="ask-slip" action="/desk" method="get" aria-labelledby={`${id}-title`}>
        <div className="ask-slip__head">
          <H className="ask-title" id={`${id}-title`}>
            Request for investigation
          </H>
          <span>Form UP-2</span>
        </div>
        <label htmlFor={`${id}-q`} className="ask-q">
          <span className="ask-q__q" aria-hidden="true">
            Q.
          </span>
          <span className="sr-only">Your question about a drug on our formulary</span>
          <input id={`${id}-q`} name="q" type="text" autoComplete="off" placeholder="Why is carboplatin short, and what do we do?" maxLength={400} required />
        </label>
        <div className="ask-slip__foot">
          <button type="submit" className="btn btn--primary">
            File the request
          </button>
          <span>Upstream answers why and what to do, with every row cited. It refuses orders, stock changes and dosing advice.</span>
        </div>
      </form>
      <div className="ask-recent">
        <p className="ask-recent__h">Filed by buyers this week</p>
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
