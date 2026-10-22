"use client";

// Every investigation on file, as a filing cabinet: three drawers (act, watch, quiet) and a green-bar ledger
// you can search and sort. Sorted by days on hand at the shortest shelf, the way a buyer works the list.
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { BoxStamp, TallName } from "../record/bits";
import "./cabinet.css";

export interface CabinetRow {
  slug: string;
  name: string; // Tall Man display name
  question: string;
  headline: string | null;
  state: "confirmed" | "check" | "no_signal" | null;
  minDays: number | null;
  status: string | null;
  firstPosting: string | null;
  watch: "act" | "watch" | "quiet";
  hospital: string | null;
}

type Sort = "days" | "name" | "posted";
type Drawer = "all" | "act" | "watch" | "quiet";

const STATE = {
  confirmed: { word: "CONFIRMED", tone: "carbon" },
  check: { word: "CHECK", tone: "amber" },
  no_signal: { word: "NO SIGNAL", tone: "ink" },
} as const;

const DRAWERS: { k: Exclude<Drawer, "all">; label: string; note: string }[] = [
  { k: "act", label: "Act today", note: "short on a shelf and on FDA's record" },
  { k: "watch", label: "On watch", note: "something on FDA's record to keep an eye on" },
  { k: "quiet", label: "Quiet", note: "stocked, and nothing on FDA's record" },
];

const days = (d: number | null) => (d === null ? "n/a" : d < 10 ? d.toFixed(1) : String(Math.round(d)));

export function Cabinet({ rows }: { rows: CabinetRow[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("days");
  const [drawer, setDrawer] = useState<Drawer>("all");

  const counts = useMemo(() => {
    const c = { act: 0, watch: 0, quiet: 0 };
    for (const r of rows) c[r.watch]++;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    // A search reads every drawer: a buyer looking for carboplatin should find it wherever the watch filed it.
    const list = rows.filter(
      (r) =>
        (t || drawer === "all" || r.watch === drawer) &&
        (!t || r.name.toLowerCase().includes(t) || r.slug.includes(t) || (r.headline ?? "").toLowerCase().includes(t)),
    );
    const byName = (a: CabinetRow, b: CabinetRow) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    if (sort === "name") list.sort(byName);
    else if (sort === "posted") list.sort((a, b) => (a.firstPosting ?? "9999").localeCompare(b.firstPosting ?? "9999") || byName(a, b));
    else list.sort((a, b) => (a.minDays ?? 1e9) - (b.minDays ?? 1e9) || byName(a, b));
    return list;
  }, [rows, q, sort, drawer]);

  return (
    <div className="cab">
      <div className="cab-drawers" role="group" aria-label="Drawers">
        {DRAWERS.map((d, i) => (
          <button
            key={d.k}
            type="button"
            className={`cab-drawer cab-drawer--${d.k}${drawer === d.k ? " is-open" : ""}`}
            aria-pressed={drawer === d.k}
            onClick={() => setDrawer(drawer === d.k ? "all" : d.k)}
            style={{ "--i": i } as CSSProperties}
          >
            <span className="cab-holder">
              <span className="cab-card">
                <b>{d.label}</b>
                <span>{d.note}</span>
              </span>
            </span>
            <span className="cab-count">{counts[d.k]}</span>
            <span className="cab-pull" aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="cab-tools">
        <label className="cab-search">
          <span className="sr-only">Find a drug</span>
          <span className="cab-search__q" aria-hidden="true">
            Find
          </span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="carboplatin, lidocaine, OAI..." autoComplete="off" />
        </label>
        <div className="cab-sort" role="group" aria-label="Sort the ledger">
          {(
            [
              ["days", "Days on hand"],
              ["name", "Name"],
              ["posted", "FDA posting"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>
              {l}
            </button>
          ))}
        </div>
        <p className="cab-n" aria-live="polite">
          {shown.length} of {rows.length} on file
          {q.trim() ? (drawer !== "all" ? ", searching every drawer" : "") : drawer !== "all" ? `, ${DRAWERS.find((d) => d.k === drawer)?.label.toLowerCase()} drawer` : ""}
        </p>
      </div>

      <div className="cab-ledger">
        <div className="cab-head" aria-hidden="true">
          <span>Shortest shelf</span>
          <span>Drug and finding</span>
          <span>FDA&apos;s shortage list</span>
          <span>State</span>
        </div>
        {shown.length ? (
          <ol className="cab-rows">
            {shown.map((r) => {
              const st = r.state ? STATE[r.state] : null;
              const low = r.minDays !== null && r.minDays < 7;
              return (
                <li key={r.slug} className={`cab-row cab-row--${r.watch}`}>
                  <Link href={`/case/${r.slug}`} className="cab-link">
                    <span className={`cab-days${low ? " is-low" : ""}`}>
                      <b>{days(r.minDays)}</b>
                      <small>{r.minDays !== null ? `days${r.hospital ? `, ${r.hospital.replace(/^Corvale /, "")}` : ""}` : "no stock on file"}</small>
                    </span>
                    <span className="cab-drug">
                      <TallName name={r.name} className="cab-name" />
                      <span className="cab-h">{r.headline ?? r.question}</span>
                    </span>
                    <span className="cab-fda">
                      {r.status ? (
                        <>
                          <b>{r.status}</b>
                          {r.firstPosting ? <span>{r.status === "Current" ? "since" : "first posted"} {r.firstPosting}</span> : null}
                        </>
                      ) : r.firstPosting ? (
                        <>
                          <b>Resolved</b>
                          <span>first posted {r.firstPosting}</span>
                        </>
                      ) : (
                        <span>Not listed</span>
                      )}
                    </span>
                    <span className="cab-st">{st ? <BoxStamp tone={st.tone}>{st.word}</BoxStamp> : <BoxStamp tone="ink">NO RECORD</BoxStamp>}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="cab-empty">
            <p>
              Nothing on file matches &ldquo;{q}&rdquo;. <Link href={`/desk?q=${encodeURIComponent(`Why is ${q} short?`)}`}>Ask at the desk</Link>: Scout
              will check the name against the formulary. This copy replays recorded investigations; Upstream runs new ones
              live where it can reach Zetaris.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
