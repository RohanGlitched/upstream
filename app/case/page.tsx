import type { Metadata } from "next";
import Link from "next/link";
import { Cabinet, type CabinetRow } from "@/components/case/Cabinet";
import { readJson, realCases } from "@/components/server/data";
import { drugTitle, tallText } from "@/components/lib/drug";
import { fmtDate } from "@/components/lib/format";
import "./case-page.css";

export const metadata: Metadata = {
  title: "Every investigation",
  description: "Every drug on Corvale Health's formulary that Upstream has investigated, sorted by days on hand at the shortest shelf.",
};

interface Flag {
  molecule: string;
  slug?: string;
  state: string;
  hospital: string;
  minDays: number | null;
}

export default async function CaseIndex() {
  const [cases, watch] = await Promise.all([realCases(), readJson<{ asOf?: string; drugs: number; flagged: Flag[]; quiet: number }>("data/watch/latest.json")]);
  const flags = new Map<string, Flag>();
  for (const f of watch?.flagged ?? []) flags.set(f.slug ?? f.molecule, f);

  const rows: CabinetRow[] = cases.map((c) => {
    const f = flags.get(c.slug) ?? flags.get(c.molecule);
    return {
      slug: c.slug,
      name: drugTitle(c.molecule),
      question: c.question,
      headline: c.headline ? tallText(c.headline) : null,
      state: (c.state as CabinetRow["state"]) ?? null,
      minDays: c.minDays,
      status: c.status,
      firstPosting: c.firstPosting,
      watch: f ? (f.state === "act" ? "act" : "watch") : "quiet",
      hospital: f?.hospital ?? null,
    };
  });
  const act = rows.filter((r) => r.watch === "act").length;
  const listed = rows.filter((r) => r.status).length;

  return (
    <>
      <section className="ci-hero" aria-labelledby="ci-h">
        <div className="cp-in ci-grid">
          <div>
            <h1 id="ci-h">Every investigation, on file</h1>
            <p className="ci-dek">
              {rows.length} drugs from Corvale Health&apos;s formulary, each traced from our shelves to the plants on its
              labels and checked against FDA&apos;s record. The overnight watch files them into three drawers.
            </p>
          </div>
          <dl className="ci-facts">
            <div>
              <dt>To act on today</dt>
              <dd className="is-red">{act}</dd>
            </div>
            <div>
              <dt>On FDA&apos;s shortage list</dt>
              <dd>{listed}</dd>
            </div>
            <div>
              <dt>Watch run</dt>
              <dd className="ci-small">{watch?.asOf ? fmtDate(watch.asOf) : "not run"}</dd>
            </div>
          </dl>
        </div>
      </section>
      <section className="ci-body" aria-label="The cabinet">
        <div className="cp-in">
          {rows.length ? (
            <Cabinet rows={rows} />
          ) : (
            <div className="notice">
              <span className="notice__mark" aria-hidden="true">i</span>
              <h3>Nothing is on file yet</h3>
              <p>
                Ask about a drug at the <Link href="/desk">desk</Link>. Each finished investigation is filed here with its evidence.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
