"use client";

// The atlas ledger: every plant on one green-bar sheet, filterable, each row opening to its record.
import Link from "next/link";
import { useMemo, useState } from "react";
import { countryName, firmCase } from "../lib/format";
import { HEALTH_RULE, HEALTH_WORD, KIND_WORD, dn, fmtIso, kmText, lastText, toneOf } from "../chronograph/model";
import type { ChronoEvent, ChronoPlant, Health } from "../chronograph/types";
import "./ledger.css";

const ORDER: Health[] = ["signal", "watch", "clear", "unknown"];
const PAGE = 30;
const S0 = dn("2022-01-01");
const S1 = dn("2027-01-01");

type Sort = "risk" | "name" | "distance" | "products" | "recent";

function Mark({ k }: { k: ChronoEvent["k"] }) {
  return (
    <svg className={`lg-mark lg-mark--${toneOf(k)}`} width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">
      {k === "oai" ? <path d="M0 -5 L5 0 L0 5 L-5 0 Z" /> : null}
      {k === "wl" || k === "inj" || k === "sz" ? <path d="M0 -4.6 L4.8 4 L-4.8 4 Z" /> : null}
      {k === "ia" ? <rect x={-3.8} y={-3.8} width={7.6} height={7.6} /> : null}
      {k === "vai" ? <path d="M0 -4.4 L4.4 0 L0 4.4 L-4.4 0 Z" className="o" /> : null}
      {k === "nai" ? <circle r={3.4} className="o" /> : null}
    </svg>
  );
}

/** The plant's record since 2022 on a strip the width of the cell: one mark per FDA action. */
function Strip({ events }: { events: ChronoEvent[] }) {
  const evs = events.filter((e) => e.d >= "2022-01-01");
  const x = (iso: string) => `${(((dn(iso) - S0) / (S1 - S0)) * 100).toFixed(2)}%`;
  return (
    <span className="lg-strip" aria-hidden="true">
      {[2023, 2024, 2025, 2026].map((y) => (
        <i key={y} className="yr" style={{ left: x(`${y}-01-01`) }} />
      ))}
      {evs.map((e, i) => (
        <span key={i} className="m" style={{ left: x(e.d) }}>
          <Mark k={e.k} />
        </span>
      ))}
    </span>
  );
}

function showOnMap(fei: string | null) {
  if (!fei) return;
  window.dispatchEvent(new CustomEvent("upstream:plant", { detail: { fei } }));
}

export function PlantLedger({ plants, asOf }: { plants: ChronoPlant[]; asOf: string }) {
  const [health, setHealth] = useState<Health | "all">("all");
  const [country, setCountry] = useState("all");
  const [text, setText] = useState("");
  const [sort, setSort] = useState<Sort>("risk");
  const [open, setOpen] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);

  const counts = useMemo(() => {
    const c: Record<Health, number> = { signal: 0, watch: 0, clear: 0, unknown: 0 };
    for (const p of plants) c[p.health]++;
    return c;
  }, [plants]);
  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plants) m.set(p.iso ?? "", (m.get(p.iso ?? "") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [plants]);

  const list = useMemo(() => {
    const q = text.trim().toLowerCase();
    const recent = (p: ChronoPlant) => (p.events.length ? p.events[p.events.length - 1].d : "");
    const out = plants
      .filter((p) => health === "all" || p.health === health)
      .filter((p) => country === "all" || (p.iso ?? "") === country)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.fei ?? "").includes(q) ||
          (p.address ?? "").toLowerCase().includes(q) ||
          p.products.some((x) => x.molecule.toLowerCase().includes(q) || x.labeler.toLowerCase().includes(q)),
      );
    const mols = (p: ChronoPlant) => new Set(p.products.map((x) => x.molecule)).size;
    out.sort((a, b) => {
      if (sort === "name") return firmCase(a.name).localeCompare(firmCase(b.name));
      if (sort === "distance") return b.km - a.km;
      if (sort === "products") return mols(b) - mols(a);
      if (sort === "recent") return recent(b).localeCompare(recent(a));
      return ORDER.indexOf(a.health) - ORDER.indexOf(b.health) || recent(b).localeCompare(recent(a));
    });
    return out;
  }, [plants, health, country, text, sort]);

  const reset = () => {
    setHealth("all");
    setCountry("all");
    setText("");
    setShown(PAGE);
  };

  return (
    <div className="lg">
      <div className="lg-filters" role="search" aria-label="Filter the plants">
        <div className="lg-health" role="group" aria-label="FDA's record">
          <button type="button" className={`lg-h lg-h--all${health === "all" ? " is-on" : ""}`} aria-pressed={health === "all"} onClick={() => setHealth("all")}>
            <span className="lg-h__n">{plants.length}</span>
            <span className="lg-h__k">All plants</span>
          </button>
          {ORDER.map((h) => (
            <button
              type="button"
              key={h}
              className={`lg-h lg-h--${h}${health === h ? " is-on" : ""}`}
              aria-pressed={health === h}
              onClick={() => {
                setHealth(health === h ? "all" : h);
                setShown(PAGE);
              }}
              title={HEALTH_RULE[h]}
            >
              <span className="lg-h__n">{counts[h]}</span>
              <span className="lg-h__k">{HEALTH_WORD[h]}</span>
            </button>
          ))}
        </div>
        <div className="lg-row">
          <label className="lg-field lg-field--q">
            <span>Find a plant, a drug or an FEI</span>
            <input type="search" value={text} onChange={(e) => { setText(e.target.value); setShown(PAGE); }} placeholder="Intas, heparin, 3004011473" autoComplete="off" />
          </label>
          <label className="lg-field">
            <span>Country</span>
            <select value={country} onChange={(e) => { setCountry(e.target.value); setShown(PAGE); }}>
              <option value="all">All {countries.length} countries</option>
              {countries.map(([k, n]) => (
                <option key={k} value={k}>
                  {countryName(k || null)} ({n})
                </option>
              ))}
            </select>
          </label>
          <label className="lg-field">
            <span>Order</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="risk">FDA&apos;s record, worst first</option>
              <option value="recent">Latest FDA action</option>
              <option value="products">Most of our drugs</option>
              <option value="distance">Farthest country (by its centre)</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      </div>

      <p className="lg-count" aria-live="polite">
        {list.length === plants.length ? `All ${plants.length} plants` : `${list.length} of ${plants.length} plants`}, records as of {fmtIso(asOf)}.
        {list.length !== plants.length ? (
          <button type="button" className="lg-reset" onClick={reset}>
            Show all
          </button>
        ) : null}
      </p>

      {list.length ? (
        <div className="lg-sheet">
          <div className="lg-head" aria-hidden="true">
            <span>Plant</span>
            <span>FEI</span>
            <span>FDA&apos;s actions, 2022 to 2026</span>
            <span>Last inspection</span>
            <span className="r">Our drugs</span>
          </div>
          <ul className="lg-rows">
            {list.slice(0, shown).map((p) => {
              const mols = [...new Set(p.products.map((x) => x.molecule))];
              const isOpen = open === p.i;
              return (
                <li key={p.i} className={`lg-item lg-item--${p.health}${isOpen ? " is-open" : ""}`}>
                  <button type="button" className="lg-line" aria-expanded={isOpen} aria-controls={`lg-d-${p.i}`} onClick={() => setOpen(isOpen ? null : p.i)}>
                    <span className="lg-name">
                      <span className={`lg-dot lg-dot--${p.health}`} aria-hidden="true" />
                      <span>
                        <strong>{firmCase(p.name)}</strong>
                        <span className="lg-sub">
                          {countryName(p.iso)}
                          {p.placed === "site" ? `, ${kmText(p.km)}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="lg-fei">{p.fei ?? "none"}</span>
                    <span className="lg-stripcell">
                      <Strip events={p.events} />
                      <span className="sr-only">
                        {p.events.filter((e) => e.d >= "2022-01-01").length} FDA records since 2022
                      </span>
                    </span>
                    <span className="lg-last">{lastText(p.last)}</span>
                    <span className="lg-n r">{mols.length}</span>
                  </button>
                  {isOpen ? (
                    <div className="lg-detail" id={`lg-d-${p.i}`}>
                      <div className="lg-detail__a">
                        <p className={`lg-stamp lg-stamp--${p.health}`}>{HEALTH_WORD[p.health]}</p>
                        <p className="lg-rule">{HEALTH_RULE[p.health]}.</p>
                        {p.address ? <p className="lg-addr">{p.address}</p> : null}
                        <button type="button" className="lg-map" onClick={() => showOnMap(p.fei)}>
                          Show on the night map
                        </button>
                      </div>
                      <div className="lg-detail__b">
                        <h4>FDA&apos;s record</h4>
                        {p.events.length ? (
                          <ol className="lg-evs">
                            {[...p.events].reverse().slice(0, 10).map((e, i) => (
                              <li key={i}>
                                <Mark k={e.k} />
                                <span className="lg-evd">{fmtIso(e.d)}</span>
                                <span>
                                  {KIND_WORD[e.k]}
                                  {e.id ? <span className="lg-type"> {e.k === "wl" ? `case ${e.id}` : e.id}</span> : null}
                                  {e.k === "oai" && e.known ? `, letter ${fmtIso(e.known)}` : ""}
                                </span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="lg-none">Nothing on FDA&apos;s file since 2017.</p>
                        )}
                      </div>
                      <div className="lg-detail__c">
                        <h4>What it makes for us</h4>
                        <p className="lg-mols">{mols.join(", ")}</p>
                        <h4>Investigations that reach it</h4>
                        {p.cases.length ? (
                          <ul className="lg-cases">
                            {p.cases.map((c) => (
                              <li key={c.slug}>
                                <Link href={`/case/${c.slug}`}>{c.title}</Link>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="lg-none">No recorded investigation names this plant yet.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {list.length > shown ? (
            <button type="button" className="lg-more" onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, list.length - shown)} more of {list.length - shown}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="lg-empty">
          <p>
            No plant matches {text ? <>&ldquo;{text}&rdquo;</> : "these filters"}. Try a firm name, a drug or an FEI, or{" "}
            <button type="button" className="lg-reset" onClick={reset}>
              show all {plants.length}
            </button>
            .
          </p>
        </div>
      )}
    </div>
  );
}
