import type { Metadata } from "next";
import Link from "next/link";
import { Cabinet, type CabinetRow } from "@/components/case/Cabinet";
import { readJson, realCases } from "@/components/server/data";
import { drugTitle, slugFor, tallText } from "@/components/lib/drug";
import { fmtDate, plural } from "@/components/lib/format";
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
  // Each flag from the overnight watch is filed under the recording named for it: the slug the watch carries,
  // else the whole molecule ("sterile-water"), else its first word (older file names). The drawers then hold
  // exactly what the watch flagged, the same numbers as the desk's printout.
  const onFile = new Set(cases.map((c) => c.slug));
  const flags = new Map<string, Flag>();
  const unfiled: Flag[] = [];
  for (const f of watch?.flagged ?? []) {
    const whole = slugFor(f.molecule);
    const slug = [f.slug, whole, whole.split("-")[0]].find((x) => x && onFile.has(x) && !flags.has(x));
    if (slug) flags.set(slug, f);
    else unfiled.push(f);
  }

  const rows: CabinetRow[] = cases.map((c) => {
    const f = flags.get(c.slug);
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
  const flagged = watch?.flagged ?? [];
  const act = flagged.filter((f) => f.state === "act").length;
  const watched = watch?.drugs ?? null;
  const current = rows.filter((r) => r.status === "Current").length;
  const ending = rows.filter((r) => r.status === "To Be Discontinued").length;
  const resolved = rows.filter((r) => r.status === "Resolved").length;

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
            {watched !== null && watched > rows.length ? (
              <p className="ci-note">
                The watch checked {watched} drugs; {plural(rows.length, "has", "have")} a recorded investigation on this copy.
                {unfiled.length
                  ? ` ${unfiled.map((f) => drugTitle(f.molecule)).join(", ")} ${unfiled.length === 1 ? "was flagged but has" : "were flagged but have"} no recording, so the drawers hold ${flagged.length - unfiled.length} of the watch's ${flagged.length} flags.`
                  : watched - rows.length === 1
                    ? " The one without a recording is a quiet drug."
                    : " The others without a recording are quiet drugs."}
              </p>
            ) : null}
          </div>
          <dl className="ci-facts">
            <div>
              <dt>To act on today</dt>
              <dd className="is-red">{act}</dd>
            </div>
            <div>
              <dt>On FDA&apos;s shortage list</dt>
              <dd>{current}</dd>
              <dd className="ci-sub">
                current; {ending} to be discontinued{resolved ? `, ${resolved} resolved` : ""}
              </dd>
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
            <Cabinet rows={rows} quietWatch={watch?.quiet} />
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
