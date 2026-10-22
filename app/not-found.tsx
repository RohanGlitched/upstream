import Link from "next/link";
import { realCases } from "@/components/server/data";
import { DrugName } from "@/components/CaseBits";
import "./states.css";

export default async function NotFound() {
  const cases = await realCases();
  return (
    <section className="state-page">
      <div className="wrap">
        <p className="state-code num">404</p>
        <h1>There is no page or recorded case here</h1>
        <p className="lede">
          Upstream keeps a recording for each drug it has investigated on this copy. Pick one of them, or ask about a
          drug on the desk.
        </p>
        {cases.length ? (
          <ul className="state-cases">
            {cases.map((c) => (
              <li key={c.slug}>
                <Link href={`/case/${c.slug}`}>
                  <DrugName molecule={c.molecule} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="state-go">
          <Link href="/desk" className="btn btn--primary">
            Go to the desk
          </Link>
          <Link href="/" className="btn">
            Home
          </Link>
        </div>
      </div>
    </section>
  );
}
