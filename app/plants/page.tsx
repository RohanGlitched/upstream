import type { Metadata } from "next";
import Link from "next/link";
import { Chronograph } from "@/components/chronograph/Chronograph";
import { loadChronoData } from "@/components/chronograph/data";
import { fmtIso, kmText } from "@/components/chronograph/model";
import type { ChronoPlant, Health } from "@/components/chronograph/types";
import { PlantLedger } from "@/components/plants/PlantLedger";
import { Unrolled } from "@/components/plants/Unrolled";
import { countryName, firmCase, plural } from "@/components/lib/format";
import { readJson } from "@/components/server/data";
import "./plants.css";

export const metadata: Metadata = {
  title: "Plant atlas",
  description:
    "Every plant behind Corvale Health's formulary on a world centred on our hospitals, with FDA's inspections, warning letters and import alerts replayed from 2022.",
};

const ORDER: Health[] = ["signal", "watch", "clear", "unknown"];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

export default async function Plants() {
  const data = await loadChronoData();
  // Measured share of labels that name no plant (scripts/dq-fda.mts).
  const dq = await readJson<{ labels: { labels: number; nameNoPlant: number; pctNameNoPlant: number } }>("data/dq/fda.json");
  const p = data.plants;
  const total = p.length;

  if (!total) {
    return (
      <section className="pl-empty">
        <div className="wrap">
          <h1>The plants behind our formulary</h1>
          <p>
            The atlas is built from the formulary and FDA&apos;s registration file, and this copy does not have it yet. Run
            the atlas query to build <code>data/plants.json</code>, then reload.
          </p>
        </div>
      </section>
    );
  }

  const byIso = new Map<string, ChronoPlant[]>();
  for (const x of p) {
    const k = x.iso ?? "";
    byIso.set(k, [...(byIso.get(k) ?? []), x]);
  }
  const rows = [...byIso.entries()].sort((a, b) => b[1].length - a[1].length);
  const maxN = rows[0]?.[1].length ?? 1;
  const since22 = p.flatMap((x) => x.events.filter((e) => e.d >= "2022-01-01"));
  const actions = since22.filter((e) => e.k !== "nai" && e.k !== "vai");
  const acted = p.filter((x) => x.events.some((e) => e.d >= "2022-01-01" && e.k !== "nai" && e.k !== "vai"));
  const most = [...p].sort((a, b) => new Set(b.products.map((y) => y.molecule)).size - new Set(a.products.map((y) => y.molecule)).size)[0];
  const mostN = most ? new Set(most.products.map((y) => y.molecule)).size : 0;
  const far = [...p].sort((a, b) => b.km - a.km)[0];
  const linked = p.filter((x) => x.cases.length).length;
  const foreign = p.filter((x) => x.iso !== "USA").length;

  return (
    <>
      <section className="pl-night" aria-labelledby="plants-title">
        <div className="pl-night__in">
          <Chronograph
            data={data}
            intro={
              <>
                <h1 id="plants-title">The plants behind our formulary</h1>
                <p>
                  Every plant named on the FDA labels of what Corvale stocks. FDA&apos;s file gives a plant&apos;s country, not
                  its site, so each is placed at its country&apos;s centre; distance and bearing are to that point. The bezel
                  is a calendar: it replays what FDA found at each plant, day by day, from 2022 to today.
                </p>
              </>
            }
          />
        </div>
      </section>

      <section className="pl-sec pl-sec--board" aria-labelledby="where-title">
        <div className="wrap">
          <header className="pl-head">
            <h2 id="where-title">Where they are</h2>
            <p>
              {Math.round((foreign / total) * 100)}% of the plants are outside the United States, and{" "}
              {rows[0] ? `${countryName(rows[0][0] || null)} and ${countryName(rows[1]?.[0] || null)} hold ${rows[0][1].length + (rows[1]?.[1].length ?? 0)} of the ${total}` : ""}.
              One square per plant, coloured by FDA&apos;s record today.
            </p>
          </header>
          <div className="pl-sheet pl-register">
            <div className="pl-register__cap">
              <span>Country register</span>
              <span className="pl-type">Q {data.queryId ?? "atlas"}, as of {fmtIso(data.asOf)}</span>
            </div>
            <table className="pl-reg">
              <caption className="sr-only">Plants by country, with FDA&apos;s record today</caption>
              <thead>
                <tr>
                  <th scope="col">Country</th>
                  <th scope="col" className="r">
                    Plants
                  </th>
                  <th scope="col">One square per plant</th>
                  <th scope="col" className="r">
                    FDA acted
                  </th>
                  <th scope="col" className="r">
                    To its centre
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([iso, l]) => {
                  const sorted = [...l].sort((a, b) => ORDER.indexOf(a.health) - ORDER.indexOf(b.health));
                  const sig = l.filter((x) => x.health === "signal").length;
                  return (
                    <tr key={iso}>
                      <th scope="row">{countryName(iso || null)}</th>
                      <td className="r pl-fig">{l.length}</td>
                      <td>
                        <span className="pl-tally" style={{ maxWidth: `${Math.max(8, (l.length / maxN) * 100)}%` }} aria-hidden="true">
                          {sorted.map((x) => (
                            <i key={x.i} className={`pl-sq pl-sq--${x.health}`} />
                          ))}
                        </span>
                        <span className="sr-only">
                          {ORDER.map((h) => `${l.filter((x) => x.health === h).length} ${h}`).join(", ")}
                        </span>
                      </td>
                      <td className={`r pl-fig${sig ? " is-sig" : ""}`}>{sig || ""}</td>
                      <td className="r pl-km">{kmText(median(l.map((x) => x.km)))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <dl className="pl-facts">
            <div>
              <dt>Plants FDA acted against at any time since January 2022</dt>
              <dd>
                <span className="pl-big">{acted.length}</span> with {plural(actions.length, "OAI inspection, warning letter or import alert", "OAI inspections, warning letters or import alerts")}{" "}
                between them. The map&apos;s red count is narrower: an action in the three years before the date on the bezel.
              </dd>
            </div>
            {most ? (
              <div>
                <dt>Makes the most of our drugs</dt>
                <dd>
                  <span className="pl-big">{mostN}</span> {mostN === 1 ? "drug" : "drugs"} at {firmCase(most.name)}, {countryName(most.iso)}
                </dd>
              </div>
            ) : null}
            {far ? (
              <div>
                <dt>Farthest country from our shelf</dt>
                <dd>
                  <span className="pl-big">{kmText(far.km).replace(" km", "")}</span> km to the centre of {countryName(far.iso)}, where{" "}
                  {firmCase(far.name)} is
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Reached by an investigation</dt>
              <dd>
                <span className="pl-big">{linked}</span> of {total} plants, across the {plural(data.casesRead, "recorded case")}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="pl-sec" aria-labelledby="unr-title">
        <div className="wrap">
          <header className="pl-head">
            <h2 id="unr-title">The bezel, unrolled</h2>
            <p>
              The same {since22.length} records as the calendar ring above, one column per month since January 2022. Red where
              FDA found a problem, magenta at the border, amber for VAI, green for a clean inspection.
            </p>
          </header>
          <div className="pl-sheet pl-sheet--graph">
            <Unrolled plants={p} asOf={data.asOf} />
          </div>
        </div>
      </section>

      <section className="pl-sec pl-sec--board" aria-labelledby="ledger-title" id="ledger">
        <div className="wrap">
          <header className="pl-head">
            <h2 id="ledger-title">The atlas ledger</h2>
            <p>
              All {total} plants. Open a row for FDA&apos;s record, what the plant makes for us and the investigations that
              reach it, or put it on the night map.
            </p>
          </header>
          <PlantLedger plants={p} asOf={data.asOf} />
        </div>
      </section>

      <section className="pl-sec" aria-labelledby="notes-title">
        <div className="wrap">
          <header className="pl-head">
            <h2 id="notes-title">Reading the atlas</h2>
          </header>
          <ol className="pl-notes">
            <li>
              <h3>Where a dot sits</h3>
              <p>
                FDA&apos;s registration file gives each plant&apos;s country, not its coordinates, so plants sit in a cluster
                around their country&apos;s centre, and every distance and bearing is to that centre: every US plant reads the
                same. The order of magnitude is right; the town is in the record card.
              </p>
            </li>
            <li>
              <h3>What the colours mean</h3>
              <p>
                FDA&apos;s rule, the same one every investigation uses. Red: an OAI inspection, warning letter or import alert
                in three years. Amber: a VAI in two years, or a last inspection that was OAI, because a plant that has not
                shown FDA a fix is never clear. Green: inspected in four years with nothing worse. Hollow: no inspection on
                file in four years.
              </p>
            </li>
            <li>
              <h3>Replaying the record</h3>
              <p>
                At every day on the bezel the rule is applied again to the record as it stood that day, so a plant turns red
                when FDA acts and fades back as the action ages. Inspections are dated by the day they ended; the card shows
                when the classification letter went out.
              </p>
            </li>
            <li>
              <h3>What it can&apos;t show</h3>
              <p>
                Only plants named on finished-dose labels. Ingredient plants rarely appear in public files, and{" "}
                {dq ? `${Math.round(dq.labels.pctNameNoPlant)}% of labels (${dq.labels.nameNoPlant} of ${dq.labels.labels})` : "many labels"} name no plant at all;
                those products are missing here rather than guessed.
              </p>
            </li>
          </ol>
          <p className="pl-src">
            Plants from Zetaris query <span className="pl-type">{data.queryId ?? "n/a"}</span>, built {fmtIso((data.builtAt ?? data.asOf).slice(0, 10))}.
            FDA&apos;s actions from its inspection, compliance-action and import-alert files, matched by FEI, plus the import
            alerts the recorded cases matched by firm name. Case links by FEI across {data.casesRead} recorded investigations.{" "}
            <Link href="/how">How the sources are joined</Link>
          </p>
        </div>
      </section>
    </>
  );
}
