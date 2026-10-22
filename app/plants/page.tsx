import type { Metadata } from "next";
import Link from "next/link";
import { PlantAtlas } from "@/components/plants/PlantAtlas";
import { buildAtlas } from "@/components/server/atlas";
import { realCases } from "@/components/server/data";
import { countryName, firmCase, fmtDate, fmtMs } from "@/components/lib/format";
import { drugTitle } from "@/components/lib/drug";
import "./plants.css";

export const metadata: Metadata = {
  title: "Plant atlas",
  description: "Every FDA-registered plant behind Corvale Health's formulary, coloured by FDA's latest record.",
};

export default async function Plants() {
  const atlas = await buildAtlas();
  const cases = await realCases();
  const slugs = Object.fromEntries(cases.map((c) => [c.slug, drugTitle(c.molecule)]));
  const p = atlas.plants;
  const byCountry = new Map<string, number>();
  for (const x of p) byCountry.set(x.country_iso3 ?? "", (byCountry.get(x.country_iso3 ?? "") ?? 0) + 1);
  const top = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const signal = p.filter((x) => x.health === "signal");
  const mostProducts = [...p].sort((a, b) => new Set(b.products.map((x) => x.molecule)).size - new Set(a.products.map((x) => x.molecule)).size)[0];

  return (
    <>
      <section className="plants-hero" aria-labelledby="plants-title">
        <div className="wrap plants-hero__grid">
          <div>
            <h1 id="plants-title">The plants behind our formulary</h1>
            <p className="lede">
              Every plant named on the FDA labels of the drugs Corvale Health stocks, placed in FDA&apos;s registration
              file and coloured by what FDA has recorded there.
            </p>
          </div>
          <dl className="plants-facts">
            <div>
              <dt>Plants</dt>
              <dd className="num">{p.length}</dd>
            </div>
            <div>
              <dt>Countries</dt>
              <dd className="num">{byCountry.size}</dd>
            </div>
            <div>
              <dt>With an FDA action in 3 years</dt>
              <dd className="num">{signal.length}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="plants-main" aria-label="Map and list">
        <div className="wrap">
          {atlas.derived ? (
            <div className="notice plants-derived">
              <span className="notice__mark" aria-hidden="true">i</span>
              <h3>Showing the plants from recorded cases only</h3>
              <p>The full formulary atlas has not been built on this copy, so this map shows the plants the recorded investigations reached.</p>
            </div>
          ) : null}
          {p.length ? (
            <PlantAtlas
              plants={p}
              landPath={atlas.landPath}
              borderPath={atlas.borderPath}
              viewBox={atlas.viewBox}
              slugs={slugs}
            />
          ) : (
            <div className="notice">
              <span className="notice__mark" aria-hidden="true">i</span>
              <h3>No plants to show yet</h3>
              <p>The atlas is built from the formulary and FDA&apos;s registration file. It appears once that run has finished.</p>
            </div>
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="reading-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="reading-title">Reading the atlas</h2>
            <p className="lede">What the colours mean, where the plants are, and what the map can&apos;t show.</p>
          </div>
          <div className="grid-3 plants-read">
            <div>
              <h3>Concentration</h3>
              <p>
                {top.map(([k, n], i) => `${i === top.length - 1 && i > 0 ? "and " : ""}${countryName(k || null)} ${n}`).join(", ")}.{" "}
                {top[0] ? `${Math.round((top[0][1] / Math.max(1, p.length)) * 100)}% of the plants are in one country.` : ""}
                {mostProducts ? ` ${firmCase(mostProducts.name)} makes the most of our products: ${new Set(mostProducts.products.map((x) => x.molecule)).size}.` : ""}
              </p>
            </div>
            <div>
              <h3>What the colours mean</h3>
              <p>
                Red: an OAI inspection, warning letter or import alert in the last three years. Amber: a VAI inspection in
                the last two. Green: nothing in three years. Hollow: no FEI on file, so FDA&apos;s records can&apos;t be
                matched.
              </p>
            </div>
            <div>
              <h3>What it can&apos;t show</h3>
              <p>
                Only plants named on finished-dose labels. Ingredient plants rarely appear in public files, and about a
                third of labels name no plant at all; those products are missing here rather than guessed.
              </p>
            </div>
          </div>
          <p className="small muted plants-src">
            {atlas.file
              ? `Built ${fmtDate(atlas.file.builtAt ?? atlas.file.asOf ?? "")}${atlas.file.queryId ? ` by Zetaris query ${atlas.file.queryId}` : ""}${atlas.file.ms ? ` in ${fmtMs(atlas.file.ms)}` : ""}, data as of ${fmtDate(atlas.file.asOf ?? "")}.`
              : "Gathered from the recorded investigations."}{" "}
            <Link href="/how">How the sources are joined</Link>
          </p>
        </div>
      </section>
    </>
  );
}
