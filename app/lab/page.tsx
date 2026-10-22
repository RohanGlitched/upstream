import Link from "next/link";
import { listCases } from "@/src/lib/cases";

export default async function LabIndex() {
  const cases = await listCases();
  return (
    <div className="lab-wrap">
      <h1 className="lab-h">Lab</h1>
      <p className="lab-p">The watershed for every saved case, and the film. For testing the components on their own.</p>
      <p className="lab-row"><Link href="/lab/film">The film: follow one vial upstream</Link></p>
      <nav className="lab-nav" aria-label="Cases">
        {cases.map((c) => (
          <Link key={c.slug} href={`/lab/watershed/${c.slug}`}>{c.slug}</Link>
        ))}
      </nav>
    </div>
  );
}
