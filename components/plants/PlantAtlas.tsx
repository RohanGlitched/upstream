"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PlacedPlant } from "../server/atlas";
import { countryName, firmCase, fmtDate } from "../lib/format";
import { drugTitle } from "../lib/drug";
import { HEALTH_WORD, toneOfHealth } from "../lib/trace";
import "./atlas.css";

type Health = PlacedPlant["health"];
const ORDER: Health[] = ["signal", "watch", "clear", "unknown"];
const PAGE = 24;

function lastText(s: string | null): string {
  if (!s) return "No inspection on file";
  const m = /^([A-Z]{3})\s+(\d{4}-\d{2}-\d{2})$/.exec(s);
  return m ? `Last inspection ${m[1]}, ${fmtDate(m[2])}` : s;
}

export function PlantAtlas({
  plants,
  landPath,
  borderPath,
  viewBox,
  slugs,
}: {
  plants: PlacedPlant[];
  landPath: string;
  borderPath: string;
  viewBox: string;
  slugs: Record<string, string>;
}) {
  const [health, setHealth] = useState<Health | "all">("all");
  const [country, setCountry] = useState("all");
  const [text, setText] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plants) {
      const k = p.country_iso3 ?? "";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [plants]);

  const counts = useMemo(() => {
    const c: Record<Health, number> = { signal: 0, watch: 0, clear: 0, unknown: 0 };
    for (const p of plants) c[p.health] = (c[p.health] ?? 0) + 1;
    return c;
  }, [plants]);

  const list = useMemo(() => {
    const t = text.trim().toLowerCase();
    return plants
      .filter((p) => health === "all" || p.health === health)
      .filter((p) => country === "all" || (p.country_iso3 ?? "") === country)
      .filter(
        (p) =>
          !t ||
          p.name.toLowerCase().includes(t) ||
          (p.fei ?? "").includes(t) ||
          p.products.some((x) => x.molecule.toLowerCase().includes(t) || x.labeler.toLowerCase().includes(t)),
      )
      .sort((a, b) => ORDER.indexOf(a.health) - ORDER.indexOf(b.health) || b.signals - a.signals || a.name.localeCompare(b.name));
  }, [plants, health, country, text]);

  const inList = useMemo(() => new Set(list.map((p) => p.id)), [list]);
  const selected = plants.find((p) => p.id === sel) ?? null;
  const unplaced = plants.filter((p) => p.x === null).length;

  return (
    <div className="atlas">
      <div className="atlas-map panel">
        <svg viewBox={viewBox} className="atlas-svg" role="img" aria-label={`Map of ${plants.length} plants behind the formulary, coloured by FDA status`}>
          <path d={landPath} className="m-land" />
          <path d={borderPath} className="m-border" />
          {[...plants]
            .filter((p) => p.x !== null)
            .sort((a, b) => ORDER.indexOf(b.health) - ORDER.indexOf(a.health))
            .map((p) => (
              <circle
                key={p.id}
                cx={p.x!}
                cy={p.y!}
                r={p.id === sel ? 6.5 : 4.2}
                className={`m-dot m-dot--${toneOfHealth(p.health)}${inList.has(p.id) ? "" : " is-dim"}${p.id === sel ? " is-sel" : ""}`}
                onClick={() => setSel(p.id)}
              >
                <title>{`${firmCase(p.name)}, ${countryName(p.country_iso3)}: ${HEALTH_WORD[p.health]}`}</title>
              </circle>
            ))}
        </svg>
        <div className="atlas-legend small">
          {ORDER.map((h) => (
            <span key={h}>
              <span className={`dot dot--${toneOfHealth(h)}`} aria-hidden="true" /> {HEALTH_WORD[h]} <span className="muted num">{counts[h]}</span>
            </span>
          ))}
          {unplaced ? <span className="muted">{unplaced} with no country on file are listed, not mapped</span> : null}
        </div>
        <p className="atlas-note small muted">
          Plants are placed at their country&apos;s centre and spread out so each stays visible; the map shows where, not the
          street address.
        </p>
      </div>

      {selected ? (
        <div className="atlas-sel panel panel-pad" aria-live="polite">
          <div className="atlas-sel__head">
            <h3>
              <span className={`dot dot--${toneOfHealth(selected.health)}`} aria-hidden="true" /> {firmCase(selected.name)}
            </h3>
            <button type="button" className="btn btn--quiet btn--small" onClick={() => setSel(null)}>
              Close
            </button>
          </div>
          <PlantFacts p={selected} slugs={slugs} />
        </div>
      ) : null}

      <div className="atlas-filters" role="search">
        <div className="seg" role="group" aria-label="Filter by FDA status">
          <button type="button" aria-pressed={health === "all"} onClick={() => { setHealth("all"); setShown(PAGE); }}>
            All <span className="num">{plants.length}</span>
          </button>
          {ORDER.map((h) => (
            <button key={h} type="button" aria-pressed={health === h} onClick={() => { setHealth(h); setShown(PAGE); }}>
              <span className={`dot dot--${toneOfHealth(h)}`} aria-hidden="true" /> {h === "signal" ? "Action" : h === "watch" ? "Watch" : h === "clear" ? "Quiet" : "Can't check"}{" "}
              <span className="num">{counts[h]}</span>
            </button>
          ))}
        </div>
        <label className="atlas-field">
          <span className="sr-only">Country</span>
          <select value={country} onChange={(e) => { setCountry(e.target.value); setShown(PAGE); }}>
            <option value="all">All countries</option>
            {countries.map(([k, n]) => (
              <option key={k} value={k}>
                {countryName(k || null)} ({n})
              </option>
            ))}
          </select>
        </label>
        <label className="atlas-field atlas-field--grow">
          <span className="sr-only">Search plants, drugs or labelers</span>
          <input
            type="search"
            value={text}
            onChange={(e) => { setText(e.target.value); setShown(PAGE); }}
            placeholder="Search a plant, FEI, drug or labeler"
          />
        </label>
      </div>

      <p className="atlas-count small muted" aria-live="polite">
        {list.length === plants.length ? `${plants.length} plants` : `${list.length} of ${plants.length} plants`}
      </p>

      {list.length ? (
        <ul className="atlas-list">
          {list.slice(0, shown).map((p) => (
            <li key={p.id} className={`plant${p.id === sel ? " is-sel" : ""}`}>
              <button type="button" className="plant-btn" onClick={() => setSel(p.id)} aria-pressed={p.id === sel}>
                <span className="plant-name">
                  <span className={`dot dot--${toneOfHealth(p.health)}`} aria-hidden="true" /> {firmCase(p.name)}
                </span>
                <span className="small muted num">
                  {countryName(p.country_iso3)}
                  {p.fei ? `, FEI ${p.fei}` : ""}
                </span>
                <span className="small">{lastText(p.last)}</span>
                <span className="plant-mol small muted">
                  {[...new Set(p.products.map((x) => drugTitle(x.molecule)))].slice(0, 4).join(", ")}
                  {new Set(p.products.map((x) => x.molecule)).size > 4 ? ` and ${new Set(p.products.map((x) => x.molecule)).size - 4} more` : ""}
                </span>
              </button>
              {p.cases.length ? (
                <span className="plant-cases">
                  {p.cases.map((s) => (
                    <Link key={s} href={`/case/${s}`} className="plant-case">
                      {slugs[s] ?? s} case
                    </Link>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="notice">
          <span className="notice__mark" aria-hidden="true">i</span>
          <h3>No plant matches these filters</h3>
          <p>Clear the search or pick another status or country.</p>
        </div>
      )}
      {list.length > shown ? (
        <button type="button" className="btn atlas-more" onClick={() => setShown((s) => s + PAGE * 2)}>
          Show {Math.min(PAGE * 2, list.length - shown)} more plants
        </button>
      ) : null}
    </div>
  );
}

function PlantFacts({ p, slugs }: { p: PlacedPlant; slugs: Record<string, string> }) {
  const mols = [...new Map(p.products.map((x) => [`${x.labeler}|${x.molecule}`, x])).values()];
  return (
    <div className="plant-facts">
      <dl className="facts">
        <dt>FDA status</dt>
        <dd>{HEALTH_WORD[p.health]}</dd>
        <dt>Last inspection</dt>
        <dd className="num">{lastText(p.last).replace(/^Last inspection /, "")}</dd>
        <dt>FDA actions on file</dt>
        <dd className="num">{p.signals}</dd>
        <dt>FEI</dt>
        <dd className="num">{p.fei ?? "Not on file"}</dd>
        <dt>Where</dt>
        <dd>{p.address ?? countryName(p.country_iso3)}</dd>
      </dl>
      <h4>On our formulary from this plant</h4>
      <ul className="plant-prods">
        {mols.map((x, i) => (
          <li key={i}>
            <span className="strong">{drugTitle(x.molecule)}</span> <span className="muted">from {x.labeler}</span>
          </li>
        ))}
      </ul>
      {p.cases.length ? (
        <p className="plant-cases">
          {p.cases.map((s) => (
            <Link key={s} href={`/case/${s}`} className="btn btn--small">
              Open the {slugs[s] ?? s} case
            </Link>
          ))}
        </p>
      ) : (
        <p className="small muted">No recorded investigation uses this plant yet.</p>
      )}
    </div>
  );
}
