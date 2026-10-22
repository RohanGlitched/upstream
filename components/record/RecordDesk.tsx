"use client";

// The batch record as a desk: the shelf label, the carton with its real barcodes, the label's establishment
// block, and FDA's record hung from a red thread laid along a true-to-scale ruler. Data-driven for any case.
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEvidence } from "../Evidence";
import type { DeskModel, Hang, PlantCard } from "./model";
import { CARD_W, RULER_H, THREAD_Y, buildScale, pack, ticks, type Placed } from "./layout";
import { Clip, DmSvg, PaperClip, Ring, Stamp, TallName, TickMark, Typed, UpcSvg, fitSize } from "./bits";
import { fmtDate } from "../lib/format";
import "./record.css";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/* ---------- citations on the record ---------- */

export function Src({ ids, children }: { ids: string[]; children?: ReactNode }) {
  const ev = useEvidence();
  if (!ids.length) return children ? <p className="rd-src">{children}</p> : null;
  return (
    <p className="rd-src">
      {ids.map((id) =>
        ev && ev.has(id) ? (
          <button key={id} type="button" className="rd-src-id" onClick={() => ev.open(id, ids)} aria-label={`Open the record behind this card: ${id}`}>
            {id}
          </button>
        ) : (
          <b key={id} className="rd-src-id rd-src-id--static">{id}</b>
        ),
      )}{" "}
      {children}
    </p>
  );
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

function short(name: string): string {
  return name.replace(/,? (Inc\.?|LLC|L\.L\.C\.|Corp\.?|Corporation|Limited|Ltd\.?|Co\.?)$/i, "").replace(/,$/, "");
}

const fmtDays = (d: number | null) => (d === null ? "n/a" : d < 10 ? d.toFixed(1) : String(Math.round(d)));

/* ---------- the supply: shelf label, carton, establishment block, other plants ---------- */

function ShelfLabel({ m }: { m: DeskModel }) {
  const MAXD = 21;
  const band = m.band;
  return (
    <article
      className={`paper rd-shelf${band ? " has-band" : ""}`}
      style={{ "--r": ".8deg", "--d": "0ms", ...(band?.kind === "class" ? { "--band": band.color, "--band-ink": band.ink } : {}) } as CSSProperties}
      aria-label={`Shelf label: ${m.title}, days on hand at each hospital`}
    >
      {band ? (
        <div className={`rd-band rd-band--${band.kind}`} aria-hidden="true">
          <span>{band.label}</span>
        </div>
      ) : null}
      <div className="rd-shelf__in">
        <div className="rd-shelf__row">
          <div className="rd-shelf__id">
            <TallName name={m.shelfName} className="rd-tall" />
            <div className="rd-shelf__form">{m.shelfForm}</div>
          </div>
          <DmSvg m={m.dmShelf} className="rd-dm rd-dm--shelf" title={`Data Matrix of NDC ${m.carton?.ndc11 ?? m.ndcs[0] ?? ""}`} />
        </div>
        <ul className="rd-days">
          {m.shelf.map((s, i) => {
            const low = s.days !== null && s.days < 7;
            return (
              <li key={s.hospital} className={low ? "is-low" : undefined}>
                <span className="rd-days__h">{s.hospital}</span>
                <span className="rd-days__bar" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, ((s.days ?? 0) / MAXD) * 100)}%` }} />
                  <span className="rd-days__mark" style={{ left: `${(14 / MAXD) * 100}%` }} />
                  {i === 0 ? (
                    <span className="rd-days__ml" style={{ left: `${(14 / MAXD) * 100}%` }}>
                      14 d
                    </span>
                  ) : null}
                </span>
                <span className="rd-days__v">
                  {fmtDays(s.days)}
                  <span className="rd-days__u"> d</span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="rd-shelf__foot">
          <span className="rd-shelf__k">NDC</span>
          {m.ndcs.slice(0, 4).map((n) => (
            <span key={n} className="rd-type">{n}</span>
          ))}
          {m.ndcs.length > 4 ? <span className="rd-type">+{m.ndcs.length - 4}</span> : null}
        </div>
      </div>
    </article>
  );
}

function Carton({ m }: { m: DeskModel }) {
  const c = m.carton;
  if (!c) return null;
  const size = fitSize(c.name, 28, 250, 15);
  return (
    <div className="rd-carton" style={{ "--r": "-1.2deg", "--d": "110ms" } as CSSProperties} role="img" aria-label={`Carton: ${c.name} ${c.form}, NDC ${c.packageNdc}, ${c.labeler}`}>
      <div className="rd-box">
        <div className="rd-face rd-f-top">
          <div className="rd-flap" />
        </div>
        <div className="rd-face rd-f-side">
          <div className="rd-side-in">
            <b>Rx only</b>
            {m.band?.kind === "hazard" ? "Cytotoxic agent. Follow hazardous-drug handling." : "Read the package insert before use."}
            <br />
            <br />
            Store at 20 to 25 °C.
            <div style={{ marginTop: 8 }}>Lot</div>
            <div className="rd-blank" />
            <div>Exp</div>
            <div className="rd-blank" />
          </div>
        </div>
        <div className="rd-face rd-f-front">
          <div className="rd-cband" style={m.band?.kind === "class" ? ({ background: m.band.color, color: m.band.ink } as CSSProperties) : undefined}>
            <span>NDC {c.packageNdc}</span>
            <span>Rx only</span>
          </div>
          <div className="rd-cbody">
            {m.band?.kind === "hazard" ? <span className="rd-chaz">CYTOTOXIC</span> : null}
            <div className="rd-cname" style={{ fontSize: size }}>
              <TallName name={c.name} />
            </div>
            <div className="rd-cinj">{c.form}</div>
            <div className="rd-cstr">
              {c.strength ? <b>{c.strength}</b> : null}
              {c.strength ? <br /> : null}
              {c.container ? `${c.container}. ` : ""}
              <br />
              {c.labeler}
            </div>
          </div>
          <div className="rd-ccodes">
            {c.upc ? <UpcSvg upc={c.upc} className="rd-upc" title={`UPC-A ${c.upc.digits}, from NDC ${c.packageNdc}`} /> : <span />}
            <div className="rd-ccodes__dm">
              <DmSvg m={c.dm} className="rd-dm rd-dm--carton" title={c.gs1 ? `GS1 Data Matrix ${c.gs1}` : `Data Matrix of NDC ${c.ndc11}`} />
              {c.gs1 ? <div className="rd-gs1">{c.gs1}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function qualityNote(p: PlantCard): string {
  if (p.quality === "registered plant") return p.last ? "A registered plant, placed in FDA's file by its FEI." : "A registered plant, placed in FDA's file by its FEI. FDA holds no classified inspection for it.";
  if (p.quality === "named on label, not placed") return "Named on the label, but not found in FDA's registration file, so its record can't be joined.";
  return "The label names no plant. This is the application holder, so FDA's plant record can't be joined.";
}

function Insert({ m }: { m: DeskModel }) {
  const c = m.carton;
  const rows = m.labelPlants.slice(0, 3);
  const more = m.labelPlants.length - rows.length;
  const p = m.primary;
  return (
    <article className="paper rd-insert" style={{ "--r": "-.6deg", "--d": "220ms" } as CSSProperties} aria-label="The label's establishment block">
      <div className="rd-show" aria-hidden="true">
        {`${m.title} ${c?.form ?? ""}. Indications and usage. Dosage and administration. Dosage forms and strengths. Contraindications. Warnings and precautions. Adverse reactions. Drug interactions. Use in specific populations. Overdosage. Description. Clinical pharmacology. Nonclinical toxicology. How supplied, storage and handling. Patient counseling information. `.repeat(2)}
      </div>
      <h3>Package label, establishment section</h3>
      <p className="rd-insert__sub">
        {c?.setId ? `SPL set ${c.setId.slice(0, 8)}, ` : ""}labeler {c?.labeler ?? "not found"}
      </p>
      {rows.length ? (
        <table className="rd-est">
          <thead>
            <tr>
              <th>Name</th>
              <th>Address</th>
              <th>FEI</th>
              <th>Operations</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i === 0 ? "is-hit" : undefined}>
                <td>{r.name}</td>
                <td>{r.place}</td>
                <td>
                  {r.fei ? (
                    <span className="rd-fei">
                      <span className="rd-type">{r.fei}</span>
                      {i === 0 ? <Ring className="rd-fei__ring" /> : null}
                    </span>
                  ) : (
                    <span className="rd-none">none</span>
                  )}
                </td>
                <td>{r.operations || "not stated"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="rd-insert__empty">This label&apos;s establishment section names no plant.</p>
      )}
      {more > 0 ? <p className="rd-insert__more">and {more} more on this label</p> : null}
      {p ? (
        <p className="rd-insert__note">
          {qualityNote(p)}
          {p.last ? (
            <>
              {" "}
              Last inspection:{" "}
              <span className={`rd-type rd-cls rd-cls--${p.lastClass?.toLowerCase()}`}>{p.last}</span>.
            </>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}

function OtherPlants({ m }: { m: DeskModel }) {
  if (!m.others.length) return null;
  const n = m.others.length + m.othersMore;
  return (
    <div className="rd-others">
      <p className="rd-cap">
        <b>Our other {n === 1 ? "label" : `${n} labels`}.</b> {n === 1 ? "Its plant" : "Their plants"}
      </p>
      {m.others.map((o, i) => (
        <div key={i} className="paper rd-card" style={{ "--r": i % 2 ? "-.7deg" : ".4deg" } as CSSProperties}>
          <h4>{possessive(short(o.labeler))} plant</h4>
          {o.name ? (
            <p>
              {o.name}
              {o.place && o.place !== "Place not on file" ? `, ${o.place.split(", ").pop()}` : ""}
              {o.fei ? (
                <>
                  , FEI <span className="rd-type">{o.fei}</span>
                </>
              ) : null}
              .{" "}
              {o.quality === "registered plant" ? (
                o.last ? (
                  <>
                    Last inspection <span className={`rd-type rd-cls rd-cls--${o.lastClass?.toLowerCase()}`}>{o.last}</span>.
                  </>
                ) : (
                  "No classified inspection on file."
                )
              ) : o.quality === "sponsor only" ? (
                "Sponsor only, no FEI on the label, so FDA's record can't be joined."
              ) : (
                "Named on the label but not in FDA's file, so its record can't be joined."
              )}
            </p>
          ) : (
            <p>The label names no plant.</p>
          )}
        </div>
      ))}
      {m.othersMore ? (
        <p className="rd-others__more">
          and {m.othersMore} more {m.othersMore === 1 ? "plant" : "plants"} in the full record
        </p>
      ) : null}
    </div>
  );
}

/* ---------- the record's documents ---------- */

function Kv({ lines }: { lines: { k: string; v: string }[] }) {
  if (!lines.length) return null;
  return (
    <dl className="rd-kv">
      {lines.map((l) => (
        <div key={l.k}>
          <dt>{l.k}</dt>
          <dd>
            <Typed text={l.v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HangCard({ h }: { h: Hang }) {
  switch (h.kind) {
    case "oai":
    case "vai": {
      const oai = h.kind === "oai";
      return (
        <div className={`paper rd-doc rd-insp${oai ? " is-oai" : " is-vai"}`}>
          <div className="rd-dh">
            <h3>{h.title}</h3>
            <span className="rd-type">{h.ref}</span>
          </div>
          <p className="rd-firm">{h.firm}</p>
          <Kv lines={h.lines} />
          {oai && h.observations.length ? (
            <div className="rd-obs">
              <b>
                Form 483{h.observationCount ? `, ${h.observationCount} observation${h.observationCount === 1 ? "" : "s"}` : ""}
                {h.observationCount && h.observationCount > h.observations.length ? ", including" : ""}
              </b>
              <ol>
                {h.observations.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ol>
            </div>
          ) : null}
          {oai && h.history.length > 1 ? (
            <table className="rd-hist">
              <caption>Every inspection FDA holds for this FEI</caption>
              <tbody>
                {h.history.slice(-6).map((x) => (
                  <tr key={x.date} className={x.now ? "is-now" : x.cls === "OAI" ? "is-oai" : undefined}>
                    <td>{x.date}</td>
                    <td>{x.cls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <Src ids={h.evidence}>{h.source}</Src>
          <Stamp
            className={`rd-stamp${oai ? "" : " rd-stamp--small"}`}
            tone={oai ? "red" : "amber"}
            top={h.date}
            big={oai ? "OAI" : "VAI"}
            bottom={oai ? "OFFICIAL ACTION INDICATED" : "VOLUNTARY ACTION INDICATED"}
          />
        </div>
      );
    }
    case "vai_group":
      return (
        <div className="paper rd-doc rd-index">
          <div className="rd-dh">
            <h3>{h.title}</h3>
          </div>
          <table className="rd-hist">
            <tbody>
              {h.items.map((x) => (
                <tr key={x.date + x.ref}>
                  <td>{x.date}</td>
                  <td className="rd-index__f">{short(x.firm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {h.note ? <p className="rd-note">{h.note}</p> : null}
          <Src ids={h.evidence}>{h.source}</Src>
        </div>
      );
    case "letter":
      return (
        <div className="paper rd-doc rd-letter">
          <div className="rd-lh">
            {h.title}
            <br />
            to {h.firm}
          </div>
          <p>{h.note}</p>
          <span className="rd-rec">
            <b>{h.date}</b>letter dated
          </span>
          <Src ids={h.evidence}>{h.source}</Src>
        </div>
      );
    case "posting":
      return (
        <div className="paper rd-doc rd-posting">
          <div className="rd-bars" />
          <div className="rd-holes rd-holes--l" />
          <div className="rd-holes rd-holes--r" />
          <div className="rd-pin">
            <pre>
              <b>FDA DRUG SHORTAGES</b>
              {"\n"}
              {h.title}
              {"\n"}
              {h.lines.map((l) => (
                <span key={l.k}>
                  {(l.k + " ").padEnd(13, ".").slice(0, 13)}{" "}
                  {l.k === "First posted" || l.k === "Status" ? <b className="rd-hl">{l.v}</b> : l.v}
                  {"\n"}
                </span>
              ))}
              {h.items.length ? (
                <>
                  {"Also listed. "}
                  {h.items.map((x, i) => (i ? "\n             " : "") + x.ref)}
                  {"\n"}
                </>
              ) : null}
              {h.note ? `Reason: ${h.note.toLowerCase()}` : ""}
            </pre>
            <Src ids={h.evidence}>{h.source}</Src>
          </div>
        </div>
      );
    case "import_alert":
      return (
        <div className="paper rd-doc rd-fax">
          <div className="rd-fax__hdr">
            <span>{h.date}</span>
            <span>IA {h.ref}</span>
          </div>
          <h3>{h.title}</h3>
          {h.note ? <p className="rd-fax__ttl">{h.note}</p> : null}
          <p>
            {h.firm}
            {h.place ? (
              <>
                <br />
                {h.place}
              </>
            ) : null}
          </p>
          {h.lines.map((l) => (
            <p key={l.k}>{l.v}</p>
          ))}
          <Src ids={h.evidence}>{h.source}</Src>
        </div>
      );
    case "warning_letter":
    case "action":
      return (
        <div className="paper rd-doc rd-wl">
          <PaperClip />
          <div className="rd-dh">
            <h3>{h.title}</h3>
            {h.ref ? <span className="rd-type">case {h.ref}</span> : null}
          </div>
          {h.note ? <p>{h.note}</p> : <p>{h.firm}</p>}
          <Kv lines={h.lines} />
          <Src ids={h.evidence}>{h.source}</Src>
        </div>
      );
    case "recall":
      return (
        <div className="paper rd-doc rd-recall">
          <div className="rd-dh">
            <h3>{h.title}</h3>
            <span className="rd-type">{h.ref}</span>
          </div>
          <p className="rd-firm">{h.firm}</p>
          <Kv lines={h.lines} />
          {h.note ? <p className="rd-note">{h.note}</p> : null}
          <Src ids={h.evidence}>{h.source}</Src>
        </div>
      );
    case "today":
      return (
        <div className={`paper rd-doc rd-today${h.tone === "carbon" ? "" : " is-quiet"}`}>
          <div className="rd-ds">
            <b>{h.title}</b>
            {h.ref ? <span>{h.ref}</span> : null}
            {h.date}
          </div>
          <p>{h.note}</p>
          {h.evidence.length ? <Src ids={h.evidence} /> : null}
        </div>
      );
  }
}

/* ---------- the best move, as a carbon set ---------- */

function Slip({ m, signHref }: { m: DeskModel; signHref?: string }) {
  const b = m.best;
  if (!b) return null;
  const t = b.transfer;
  return (
    <aside className="rd-slipset" aria-label="The best move">
      <div className="rd-carbon" aria-hidden="true" />
      <div className="rd-slip">
        <div className="rd-slip__top">
          <h2>{t ? "Transfer request" : b.kind === "alternate_manufacturer" ? "Purchase request" : "Change request"}</h2>
          <span>ranked first</span>
        </div>
        {t ? (
          <div className="rd-ft">
            <div>
              <span className="rd-fl">From</span>
              <span className="rd-fv">{t.from.replace(/^Corvale /, "")}</span>
              {t.fromDays ? <small className="rd-fv rd-fv--s">{t.fromDays} days now</small> : null}
            </div>
            <div>
              <span className="rd-fl">To</span>
              <span className="rd-fv">{t.to.replace(/^Corvale /, "")}</span>
              {t.toDays ? <small className="rd-fv rd-fv--s">{t.toDays} days now</small> : null}
            </div>
            <div>
              <span className="rd-fl">Quantity</span>
              <span className="rd-fv rd-fv--big">{t.qty}</span> <small className="rd-fv rd-fv--s">{m.shelf[0]?.unit === "vial" ? "vials" : "units"}</small>
            </div>
            <div>
              <span className="rd-fl">After</span>
              <span className="rd-fv">
                {t.to.replace(/^Corvale /, "")} {t.after ?? "14"} d
              </span>
              <span className="rd-fv">{t.from.replace(/^Corvale /, "")} 14 d</span>
            </div>
          </div>
        ) : (
          <div className="rd-ft rd-ft--one">
            <div className="rd-wide">
              <span className="rd-fl">Request</span>
              <span className="rd-fv rd-fv--wrap">{b.title}</span>
            </div>
            <div className="rd-wide">
              <span className="rd-fl">Detail</span>
              <span className="rd-fv rd-fv--wrap rd-fv--s">{b.detail}</span>
            </div>
          </div>
        )}
        <p className="rd-slip__why">{b.why}</p>
        <div className="rd-signrow">
          <div className="rd-signline">
            <span>{b.needs.replace(/\s*\(.*\)$/, "").replace(/^./, (c) => c.toUpperCase())}</span>
          </div>
          {signHref ? (
            <Link className="rd-btn" href={signHref}>
              Send to sign
            </Link>
          ) : null}
        </div>
        <div className="rd-perf" aria-hidden="true" />
      </div>
    </aside>
  );
}

/* ---------- the record: ruler, thread, documents ---------- */

function Ruler({ m, width, height, placed, wide }: { m: DeskModel; width: number; height: number; placed: Placed[]; wide: boolean }) {
  const scale = useMemo(() => buildScale(m.segments, width), [m.segments, width]);
  const tk = useMemo(() => ticks(scale, wide), [scale, wide]);
  const y = THREAD_Y;
  const dimRows = [18, 38, 62];
  const tickPath = tk.map((t) => `M${t.x.toFixed(1)} ${y}v${-t.h}`).join("");
  return (
    <svg className="rd-ruler" width={width} height={wide ? height : RULER_H} viewBox={`0 0 ${width} ${wide ? height : RULER_H}`} aria-hidden="true">
      {scale.segs.map((s, i) => (
        <rect key={i} className="rd-ruler__band" x={s.x0 - 4} y={y - 32} width={s.w + 8} height={32} />
      ))}
      <path d={tickPath} className="rd-ruler__ticks" />
      {tk
        .filter((t) => t.label)
        .map((t, i) => (
          <text key={i} x={t.x + 3} y={y - 15} className={t.year ? "rd-ruler__yr" : "rd-ruler__mo"}>
            {t.label}
          </text>
        ))}
      {scale.segs.slice(1).map((s, i) => {
        const bx = s.x0 - 17;
        return <path key={i} className="rd-ruler__break" d={`M${bx - 6} ${y + 7}L${bx} ${y - 38}M${bx + 6} ${y + 7}L${bx + 12} ${y - 38}`} />;
      })}
      {m.dims.map((d, i) => {
        const x1 = scale.x(d.from);
        const x2 = d.to ? scale.x(d.to) : scale.x(m.today);
        const yy = d.big ? dimRows[2] : dimRows[Math.min(1, i)];
        const big = d.big;
        return (
          <g key={i} className={`rd-dim rd-dim--${d.tone}`} style={{ "--d": `${1900 + i * 200}ms` } as CSSProperties}>
            <path className="rd-dim__ext" d={`M${x1} ${yy - 6}V${y - 33}M${x2} ${yy - 6}V${y - 33}`} />
            <path className="rd-dim__line" d={`M${x1} ${yy}H${x2}`} strokeWidth={big ? 2.6 : 1.1} />
            <path className="rd-dim__arrow" d={`M${x1 + 6} ${yy - 3.5}L${x1} ${yy}L${x1 + 6} ${yy + 3.5}M${x2 - 6} ${yy - 3.5}L${x2} ${yy}L${x2 - 6} ${yy + 3.5}`} />
            {big ? (
              <>
                <text className="rd-dim__big" x={x2 + 10} y={yy + 6}>
                  {d.label}
                </text>
                {wide ? (
                  <text className="rd-dim__small" x={x2 + 10 + d.label.length * 11.5 + 8} y={yy + 5}>
                    {d.short}
                  </text>
                ) : null}
              </>
            ) : (
              <text className="rd-dim__small" x={(x1 + x2) / 2} y={yy - 5} textAnchor="middle">
                {wide && Math.abs(x2 - x1) > d.label.length * 6.4 ? d.label : d.short}
              </text>
            )}
          </g>
        );
      })}
      {/* the thread along the ruler */}
      <path className="rd-thread rd-thread--shadow" d={`M0 ${y + 2.5}H${width + 30}`} />
      <path className="rd-thread" d={`M-2 ${y}H${width + 30}`} />
      <path className="rd-thread__twist" d={`M-2 ${y}H${width + 30}`} />
      {wide
        ? placed
            .filter((p) => p.hang)
            .map((p, i) => (
              <g key={p.key} className="rd-string" style={{ "--d": `${1500 + i * 80}ms` } as CSSProperties}>
                <path d={`M${p.x} ${y}L${p.left + p.ox} ${p.top + 4}`} />
                <circle cx={p.x} cy={y} r="2.8" />
              </g>
            ))
        : null}
    </svg>
  );
}

export function RecordDesk({
  m,
  as = "h1",
  signHref,
  children,
  lede,
  play = true,
}: {
  m: DeskModel;
  as?: "h1" | "h2";
  signHref?: string;
  children?: ReactNode;
  lede?: ReactNode;
  play?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const rec = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1240);
  const [wide, setWide] = useState(true);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [playing, setPlaying] = useState(play);
  const [thread, setThread] = useState<{ d: string; pins: { x: number; y: number }[]; w: number; h: number } | null>(null);
  const H = as;

  const scale = useMemo(() => buildScale(m.segments, width), [m.segments, width]);
  const layout = useMemo(() => pack(m, scale, width, heights), [m, scale, width, heights]);

  // Measure the record's width, then the documents' real heights, then re-pack.
  useIso(() => {
    const el = rec.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setWidth((o) => (Math.abs(o - w) > 1 ? w : o));
      setWide(window.matchMedia("(min-width: 1100px)").matches);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useIso(() => {
    const el = rec.current;
    if (!el || !wide) return;
    const next: Record<string, number> = {};
    el.querySelectorAll<HTMLElement>("[data-hang]").forEach((n) => {
      next[n.dataset.hang!] = n.offsetHeight;
    });
    const changed = Object.keys(next).some((k) => Math.abs((heights[k] ?? 0) - next[k]) > 2);
    if (changed) setHeights(next);
  }, [wide, width, m, heights]);

  // The thread from the pins on the shelf label, the carton and the insert down to the ruler.
  const drawThread = useCallback(() => {
    const r = root.current;
    const rc = rec.current;
    if (!r || !rc || !window.matchMedia("(min-width: 1100px)").matches) return setThread(null);
    const base = r.getBoundingClientRect();
    const pin = (sel: string) => {
      const e = r.querySelector<HTMLElement>(sel);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.left - base.left, y: b.top - base.top };
    };
    const pins = ["[data-pin=shelf]", "[data-pin=carton]", "[data-pin=insert]"].map(pin).filter((p): p is { x: number; y: number } => Boolean(p));
    const R = rc.getBoundingClientRect();
    const rx = R.left - base.left;
    const ry = R.top - base.top;
    const pts = [...pins, { x: rx - 30, y: ry - 4 }, { x: rx - 2, y: ry + THREAD_Y }];
    let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const last = i === pts.length - 1;
      const sag = last ? 0 : Math.min(40, dist * 0.06);
      const mx = (a.x + b.x) / 2 + (last ? -26 : 0);
      const my = (a.y + b.y) / 2 + sag;
      d += ` Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    setThread({ d, pins, w: r.offsetWidth, h: r.offsetHeight });
  }, []);

  useEffect(() => {
    drawThread();
    const r = root.current;
    if (!r) return;
    const ro = new ResizeObserver(() => drawThread());
    ro.observe(r);
    document.fonts?.ready.then(drawThread).catch(() => undefined);
    return () => ro.disconnect();
  }, [drawThread, layout.height]);

  // Thread and dimension lines draw themselves: each needs its own length for the dash.
  useEffect(() => {
    const r = root.current;
    if (!r) return;
    r.querySelectorAll<SVGPathElement>(".rd-thread, .rd-dim__line").forEach((p) => {
      try {
        p.style.setProperty("--len", String(Math.ceil(p.getTotalLength() + 2)));
      } catch {
        /* a path with no geometry yet */
      }
    });
  });

  const replay = () => {
    setPlaying(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setPlaying(true)));
  };
  const v = m.verdict;
  const stateWord = m.state === "confirmed" ? "checked against the record" : m.state === "check" ? "checked; the link needs a pharmacist's look" : "checked";

  return (
    <section ref={root} className={`rd${playing ? " rd--play" : ""}`} aria-labelledby={`rd-h-${m.slug}`}>
      <div className="rd-wrap">
        <div className="rd-top">
          <div className="rd-intro">
            {lede ? <div className="rd-lede">{lede}</div> : null}
            <div className="rd-req">
              <div className="rd-q">
                <b>Q.</b>
                <Typed text={m.question} />
              </div>
              <div className="rd-clock" aria-label={`Asked ${fmtDate(m.askedAt)}`}>
                <b>{fmtDate(m.askedAt).toUpperCase()}</b>
                {m.askedAt.slice(11, 16)} case {m.caseShort}
              </div>
            </div>
            <H className="rd-h1" id={`rd-h-${m.slug}`}>
              {m.headline}
            </H>
            <p className="rd-dek">{m.dek}</p>
            <div className="rd-verdict">
              <TickMark className="rd-verdict__tick" size={24} />
              <span>
                <b>
                  {v.checked} of {v.checked + v.rejected} claims {stateWord}
                </b>
                {v.rejected ? `, ${v.rejected} rejected and dropped` : ", none rejected"}. {v.queries} queries across our {v.hospitals === 1 ? "stock system" : `${v.hospitals === 3 ? "three" : "two"} stock systems`} and
                FDA in {v.seconds} seconds.
              </span>
            </div>
            <div className="rd-actions">
              {children}
              <button type="button" className="rd-replay" onClick={replay}>
                Lay out the file again
              </button>
            </div>
          </div>

          <div className="rd-supply">
            <div className="rd-row rd-row--1">
              {m.carton ? (
                <div className="rd-item rd-item--carton">
                  <p className="rd-cap">
                    <b>What we buy.</b> {m.carton.listed ? "The NDC on FDA's list" : "Our main NDC"}
                  </p>
                  <Carton m={m} />
                  <span className="rd-pinref" data-pin="carton" />
                </div>
              ) : null}
              <div className="rd-item rd-item--shelf">
                <p className="rd-cap">
                  <b>On our {m.shelf.length === 1 ? "shelf" : "shelves"}.</b> Days left at {m.shelf.length === 1 ? "our one hospital" : "each hospital"}
                </p>
                <ShelfLabel m={m} />
                <span className="rd-pinref" data-pin="shelf" />
              </div>
            </div>
            <div className="rd-row rd-row--2">
              <div className="rd-item rd-item--insert">
                <p className="rd-cap">
                  <b>Where it is made.</b> The label&apos;s establishment block
                </p>
                <Insert m={m} />
                <span className="rd-pinref" data-pin="insert" />
              </div>
              <OtherPlants m={m} />
            </div>
          </div>
        </div>

        <div ref={rec} className={`rd-record${wide ? " is-wide" : " is-stack"}${m.nothing ? " is-empty" : ""}`} style={wide ? { height: layout.height } : undefined}>
          <Ruler m={m} width={width} height={layout.height} placed={layout.placed} wide={wide} />
          {m.nothing ? (
            <div className="rd-nothing paper">
              <p className="rd-nothing__k">Nothing to hang</p>
              <p>{m.nothing}</p>
            </div>
          ) : null}
          {layout.placed.map((p, i) => {
            const style = (wide
              ? { left: p.left, top: p.top, width: p.w, "--ox": `${p.ox}px`, "--r": `${(((i * 7919) % 7) - 3) * 0.45}deg`, "--d": `${260 + i * 110}ms` }
              : { "--r": "0deg", "--d": `${200 + i * 80}ms` }) as unknown as CSSProperties;
            if (!p.hang) {
              return (
                <div key="slip" className="rd-place rd-place--slip" data-hang="slip" style={style}>
                  <Slip m={m} signHref={signHref} />
                </div>
              );
            }
            const h = p.hang;
            return (
              <article key={p.key} className={`rd-place rd-hang rd-hang--${h.kind}`} data-hang={h.id} style={style} aria-label={`${h.title}, ${h.date}`}>
                <Clip />
                <span className="rd-hang__date">{h.date}</span>
                <HangCard h={h} />
              </article>
            );
          })}
          {wide && m.hangs.length ? <span className="sr-only">{`${m.hangs.length} FDA records laid out by date from ${m.hangs[0].date} to ${m.today}.`}</span> : null}
        </div>
      </div>
      {thread ? (
        <svg className="rd-overlay" width={thread.w} height={thread.h} viewBox={`0 0 ${thread.w} ${thread.h}`} aria-hidden="true">
          <path className="rd-thread rd-thread--shadow" d={thread.d} transform="translate(1.5 3)" />
          <path className="rd-thread" d={thread.d} />
          <path className="rd-thread__twist" d={thread.d} />
          {thread.pins.map((p, i) => (
            <g key={i} className="rd-pin" style={{ "--d": `${500 + i * 120}ms` } as CSSProperties}>
              <ellipse cx={p.x + 2.5} cy={p.y + 4.5} rx="6.5" ry="3.2" className="rd-pin__shadow" />
              <circle cx={p.x} cy={p.y} r="6.2" fill="url(#rd-pinhead)" stroke="#3E4644" strokeWidth=".6" />
            </g>
          ))}
        </svg>
      ) : null}
    </section>
  );
}

export { CARD_W };
