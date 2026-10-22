"use client";
/**
 * <Watershed caseData={c} />: the supply of one drug drawn as an engraved river map.
 *
 * Props
 *   caseData   Case (src/agent/types). Any saved or streamed investigation; nothing else is needed.
 *   compact?   boolean, default false. Puts the cartouche and the record beside/below the sheet instead of
 *              floating over its left third, for narrower sections (the case page's "supply map").
 *   autoplay?  boolean, default true. Replays FDA's record once when the sheet first scrolls into view.
 *              Reduced motion always shows the finished state and never autoplays.
 *   className? string, added to the outer <figure>.
 *   idPrefix?  string, prefix for SVG ids. Only needed if the same drug's sheet appears twice on one page.
 *
 * What it draws
 *   Springs are plants, placed by country (foreign above FDA's import frontier, domestic below it, and plants
 *   the label names but FDA's register does not place in the stippled "unsurveyed" ground). Streams run to
 *   gauges, one per labeler, and on to one reservoir per hospital that stocks the drug. Stream width is real
 *   daily use (case.stock); reservoir fill is days on hand on a 0 to 21 day staff with a 14-day ring.
 *   The replay runs from the start of the year of the first event on the case timeline to case.asOf:
 *   an OAI inspection clouds its spring, the classification letter silts it red; the shortage posting turns
 *   listed labelers into dry beds (with the red thread where FDA found a problem upstream) or low water;
 *   import alerts are magenta marks at the frontier, warning letters red diamonds at the plant, VAI amber.
 *   The best ranked transfer can be previewed as water in a proposed canal. Every feature opens its record
 *   with citation marks (E12, D8) that unfold the evidence row as a carbon slip.
 *
 * Layout: a wide sheet (springs at top, flowing down) at 760px and up; a tall narrow sheet below that.
 * Both are server-rendered and chosen by a container query, so first paint is the finished map.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Case, Hospital } from "../../src/agent/types";
import type { Frame } from "./frame";
import { frameAt, planAt, planReplay } from "./frame";
import type { Geo, Line, Pt } from "./geometry";
import { CAP, clamp, cubic, layout, line, poolScale, r1, ribbonD, smooth, smoothPath } from "./geometry";
import type { Day, WsModel } from "./model";
import { buildModel, dshort, dstr, unitWord } from "./model";
import type { Pick } from "./Sheet";
import { Glyph, recoveryOf, Sheet } from "./Sheet";
import "./watershed.css";

export interface WatershedProps {
  caseData: Case;
  compact?: boolean;
  autoplay?: boolean;
  className?: string;
  /** prefix for the SVG gradient ids; set it only when two sheets of the same drug share a page */
  idPrefix?: string;
}

const WIDE_W = 1376;
const COMPACT_W = 1180;
const TALL_W = 390;

const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const num = (n: number, cap = false) => { const s = n <= 12 ? NUM[n] : String(n); return cap ? s[0].toUpperCase() + s.slice(1) : s; };
const plural = (n: number, w: string, ws = w + "s") => (n === 1 ? w : ws);
const fmt = (n: number, d = 1) => Number(n).toFixed(d);

export function Watershed({ caseData, compact = false, autoplay = true, className, idPrefix }: WatershedProps) {
  const m = useMemo(() => buildModel(caseData), [caseData]);
  // a stable prefix for SVG ids (useId differs when the trees above differ between server and client)
  const uid = "ws" + (idPrefix ?? m.molecule).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) + (compact ? "c" : "");
  const rootRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState<{ tall: boolean; W: number } | null>(null);
  const [cur, setCur] = useState(m.events.length - 1);
  const [playing, setPlaying] = useState(false);
  const [transferOn, setTransferOn] = useState(false);
  const [pick, setPick] = useState<Pick>(null);
  const ctl = useRef<{ seek: (t: Day) => void; play: () => void; pause: () => void; transfer: (on: boolean) => void } | null>(null);

  const wideW = size && !size.tall ? size.W : compact ? COMPACT_W : WIDE_W;
  const tallW = size && size.tall ? size.W : TALL_W;
  const wide = useMemo(() => (size?.tall ? null : layout(m, { W: wideW, mobile: false, panel: !compact })), [m, size?.tall, wideW, compact]);
  const tall = useMemo(() => (size && !size.tall ? null : layout(m, { W: tallW, mobile: true, panel: false })), [m, size, tallW]);
  const fWide = useMemo(() => (wide ? frameAt(m, wide, m.today) : null), [m, wide]);
  const fTall = useMemo(() => (tall ? frameAt(m, tall, m.today) : null), [m, tall]);
  const active = size ? (size.tall ? tall : wide) : null;

  // measure the container; the sheet is drawn at its real width
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      if (!w) return;
      const tallNow = w < 760;
      const inner = tallNow ? w - 2 : w - 22; // sheet border and margin
      setSize((s) => (s && s.tall === tallNow && Math.abs(s.W - inner) < 3 ? s : { tall: tallNow, W: Math.max(320, inner) }));
    };
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); });
    ro.observe(el);
    measure();
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  const onPick = useCallback((p: Pick) => setPick((q) => (q && p && q.kind === p.kind && q.key === p.key ? null : p)), []);

  // the engine: replay, particles, pools; attaches to whichever sheet is live
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !active || !size) return;
    const sheet = root.querySelector<HTMLElement>(`[data-sheet="${size.tall ? "tall" : "wide"}"]`);
    if (!sheet) return;
    const eng = engine(sheet, root, m, active, uid, { onCur: setCur, onPlaying: setPlaying });
    ctl.current = eng;
    let started = false;
    const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        eng.visible(e.isIntersecting);
        if (e.isIntersecting && e.intersectionRatio > 0.3 && !started) {
          started = true;
          if (autoplay && !RM.matches && m.replayable && !eng.hasPlayed()) { eng.seek(m.t0); setTimeout(() => eng.play(), 450); }
        }
      }
    }, { threshold: [0, 0.32] });
    io.observe(sheet);
    return () => { io.disconnect(); eng.destroy(); ctl.current = null; };
  }, [active, m, size, uid, autoplay]);

  useEffect(() => { ctl.current?.transfer(transferOn); }, [transferOn, active]);

  const panelProps: PanelProps = {
    m, cur, playing, transferOn, pick, tall: !!size?.tall,
    onPlay: () => (playing ? ctl.current?.pause() : ctl.current?.play()),
    onSeek: (t: Day) => { ctl.current?.pause(); ctl.current?.seek(t); },
    onTransfer: () => setTransferOn((v) => !v),
    onClosePick: () => setPick(null),
    scaleUnits: (active ?? wide ?? tall)!.scaleUnits,
    k: (active ?? wide ?? tall)!.k,
  };

  const renderSheet = (g: Geo, f: Frame, which: "wide" | "tall") => {
    const overlay = which === "wide" && !compact;
    return (
      <div className={`ws-variant ws-${which}`} data-variant={which}>
        {which === "tall" && <Cartouche {...panelProps} tall />}
        <div className="ws-sheet">
          <div className="ws-sheet-in">
            <div className="ws-map" data-sheet={which} style={{ aspectRatio: `${g.W} / ${g.H}` }}>
              <div className="ws-layers" role="img" aria-label={mapLabel(m)}>
                <Sheet m={m} g={g} f={f} uid={`${uid}${which[0]}`} onPick={onPick} />
              </div>
              {m.replayable && (
                <div className="ws-scrub" style={{ left: `${(g.tl.x0 / g.W) * 100}%`, width: `${((g.tl.x1 - g.tl.x0) / g.W) * 100}%`, height: `${(70 / g.H) * 100}%` }}>
                  <label className="ws-sr" htmlFor={`${uid}${which}-scrub`}>Date in FDA&rsquo;s record</label>
                  <input
                    id={`${uid}${which}-scrub`} type="range" min={0} max={Math.round(m.today - m.t0)} step={1} defaultValue={Math.round(m.today - m.t0)}
                    data-r="scrub" aria-valuetext={dstr(m.today)}
                    onInput={(e) => { ctl.current?.pause(); ctl.current?.seek(m.t0 + Number((e.target as HTMLInputElement).value)); }}
                  />
                </div>
              )}
              {overlay && (
                <div className="ws-panel">
                  <Cartouche {...panelProps} />
                  <Readout {...panelProps} />
                </div>
              )}
            </div>
          </div>
        </div>
        {!overlay && (
          <div className={`ws-below${which === "wide" ? " ws-below-wide" : ""}`}>
            {which === "wide" && <Cartouche {...panelProps} />}
            <Readout {...panelProps} />
          </div>
        )}
      </div>
    );
  };

  return (
    <figure ref={rootRef} className={`ws${compact ? " ws-compact" : ""}${size ? " ws-live" : ""}${className ? " " + className : ""}`} aria-label={`Supply map: the ${m.molecule} watershed of Corvale Health`}>
      {wide && fWide && (!size || !size.tall) && renderSheet(wide, fWide, "wide")}
      {tall && fTall && (!size || size.tall) && renderSheet(tall, fTall, "tall")}
    </figure>
  );
}
export default Watershed;

function mapLabel(m: WsModel): string {
  const named = m.plants.filter((p) => !p.unnamed).length;
  return `A river map of Corvale Health's ${m.molecule} supply. ${num(named, true)} ${plural(named, "plant")} feed ${num(m.labelers.length)} ${plural(m.labelers.length, "labeler")}, which feed ${num(m.hospitals.length)} ${plural(m.hospitals.length, "hospital")}. Stream width is daily use; reservoir fill is days on hand.`;
}

/* ---------------- panel ---------------- */
interface PanelProps {
  m: WsModel; cur: number; playing: boolean; transferOn: boolean; pick: Pick; tall: boolean;
  onPlay: () => void; onSeek: (t: Day) => void; onTransfer: () => void; onClosePick: () => void;
  scaleUnits: number; k: number;
}

function sentence(m: WsModel): string {
  const named = m.plants.filter((p) => !p.unnamed);
  const L = m.labelers.length, H = m.hospitals.length;
  const u = unitWord(m.unit);
  const hs = H === 1 ? `our one hospital that stocks it` : `our ${num(H)} hospitals`;
  let s: string;
  if (!named.length) s = `No label names a plant we can read, so ${num(L)} ${plural(L, "labeler")} ${L === 1 ? "rises" : "rise"} from unsurveyed ground and ${L === 1 ? "feeds" : "feed"} ${hs}.`;
  else s = `${num(named.length, true)} ${plural(named.length, "plant")} ${named.length === 1 ? "feeds" : "feed"} ${num(L)} ${plural(L, "labeler")}, which ${L === 1 ? "feeds" : "feed"} ${hs}.`;
  if (m.counts.unplaced) s += ` ${num(m.counts.unplaced, true)} ${m.counts.unplaced === 1 ? "is" : "are"} named on a label but not placed by FDA.`;
  return `${s} Each stream is as wide as the ${u} a hospital draws from it a day. Each reservoir holds its days on hand.`;
}

function Cartouche(p: PanelProps & { tall?: boolean }) {
  const { m } = p;
  const anyListed = m.labelers.some((l) => l.listed) && m.listedNow;
  const sw = Math.max(2, p.scaleUnits * p.k);
  return (
    <div className="ws-cartouche">
      <h3 className="ws-title">The {m.title} watershed of Corvale Health</h3>
      <p className="ws-lede">{sentence(m)}</p>
      <div className="ws-legend">
        <svg width="44" height="18" aria-hidden="true"><path d="M2 9 C 14 4, 28 14, 42 9" className="ws-lg-water" strokeWidth={Math.min(16, sw)} /></svg>
        <span>Width: {p.scaleUnits} {unitWord(m.unit, p.scaleUnits)} a day, as each hospital records use</span>
        <svg width="44" height="18" aria-hidden="true"><rect x="12" y="1" width="6" height="16" className="ws-staff" /><rect x="12" y="13" width="6" height="4" className="ws-staff-bar" /><rect x="12" y="5" width="6" height="4" className="ws-staff-bar" /><path d="M10 9 l-7 -4 l0 8z" className="ws-staff-mark" /></svg>
        <span>Days on hand, 0 to 21; the dotted ring is two weeks</span>
        {anyListed && (
          <>
            <svg width="44" height="18" aria-hidden="true"><path d="M2 5 C 14 1, 28 11, 42 6 M2 13 C 14 9, 28 19, 42 14" className="ws-lg-bank" /><path d="M2 9 C 14 5, 28 15, 42 10" className="ws-lg-thread" /></svg>
            <span>Dry bed: listed short; red thread: FDA found a problem</span>
          </>
        )}
        <svg width="44" height="18" aria-hidden="true"><path d="M8 3 L13 12 L3 12 Z" className="ws-lg-ia" /><rect x="25" y="4" width="8" height="8" transform="rotate(45 29 8)" className="ws-lg-wl" /></svg>
        <span>Import alert at the frontier; warning letter at the plant</span>
        {(m.counts.unplaced > 0 || m.counts.unnamed > 0) && (
          <>
            <svg width="44" height="18" aria-hidden="true"><circle cx="22" cy="9" r="7" className="ws-lg-approx" /><circle cx="22" cy="9" r="2.6" className="ws-lg-dot" /></svg>
            <span>Dashed spring: named on a label, place approximate</span>
          </>
        )}
      </div>
    </div>
  );
}

function Readout(p: PanelProps) {
  const { m } = p;
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const ol = listRef.current;
    if (!ol) return;
    const li = ol.children[p.cur] as HTMLElement | undefined;
    if (!li) return;
    const top = li.offsetTop - ol.offsetTop, bot = top + li.offsetHeight;
    if (top < ol.scrollTop) ol.scrollTop = top - 4;
    else if (bot > ol.scrollTop + ol.clientHeight) ol.scrollTop = bot - ol.clientHeight + 4;
  }, [p.cur]);
  const tr = m.transfer;
  const posting = m.posting;
  const ld = posting !== null ? Math.round(m.today - posting) : 0;
  const initListed = posting !== null && m.listedNow ? { lead: "On FDA's list", value: ld < 61 ? `${ld} days` : `${Math.round(ld / 30.44)} months` } : null;
  return (
    <div className="ws-readout">
      <div className="ws-when">
        <div className="ws-date" data-r="date">{dstr(m.today)}</div>
        <div className="ws-listed">
          <span data-r="listedLead">{initListed ? initListed.lead : posting !== null ? "FDA posted a shortage; resolved since" : "Not on FDA's shortage list"}</span>
          <b data-r="listedVal">{initListed?.value ?? ""}</b>
        </div>
      </div>
      {m.replayable ? (
        <>
          <ol className="ws-events" ref={listRef}>
            {m.events.map((e, i) => (
              <li key={i} className={i < p.cur ? "past" : i === p.cur ? "now" : ""} aria-current={i === p.cur ? "step" : undefined}>
                <button type="button" onClick={() => p.onSeek(e.t)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="ws-ev-g"><Glyph kind={e.kind} x={7} y={7} r={4.6} on /></svg>
                  <span className="d">{dshort(e.t)}</span>
                  <span className="x">{e.short}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="ws-play">
            <button type="button" onClick={p.onPlay} aria-pressed={p.playing}>
              <svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true"><path d={p.playing ? "M1 1h3v9H1zM6 1h3v9H6z" : "M1 1 L9 5.5 L1 10 Z"} /></svg>
              {p.playing ? "Pause" : "Replay FDA’s record"}
            </button>
            <span>or drag the bottom edge of the sheet</span>
          </div>
        </>
      ) : (
        <p className="ws-quiet">
          {m.plants.every((x) => x.unnamed || !x.placed)
            ? "No plant on these labels is placed in FDA's register, so there is no inspection record to replay."
            : "FDA's file holds no inspection, letter or alert for these plants to replay."}
        </p>
      )}
      {tr && (
        <div className="ws-move">
          <p className="ws-move-t">{tr.title.replace(/^Transfer (\d+)/, (_, n) => `Transfer ${n} ${unitWord(m.unit, +n)}`)}.</p>
          <p className="ws-move-d">
            {tr.to.replace("Corvale ", "")} goes from {fmt(m.hospitals.find((h) => h.key === tr.to)!.days ?? 0)} to {fmt(tr.after[tr.to] ?? 0)} days;{" "}
            {tr.from.replace("Corvale ", "")} keeps {fmt(tr.after[tr.from] ?? 0)}.<span className="ws-why"> {tr.why}</span>
          </p>
          <button type="button" className="ws-btn" aria-pressed={p.transferOn} onClick={p.onTransfer}>
            {p.transferOn ? "Hide the transfer" : "Preview the transfer on the map"}
          </button>
        </div>
      )}
      {p.pick && <Note {...p} />}
    </div>
  );
}

function Cite({ id, m }: { id: string; m: WsModel }) {
  const [open, setOpen] = useState(false);
  const ev = m.evidence[id];
  if (!ev) return <span className="ws-cite ws-cite-off">{id}</span>;
  const fields = Object.entries(ev.fields).filter(([, v]) => v !== null && v !== "").slice(0, 7);
  return (
    <span className="ws-cite-wrap">
      <button type="button" className="ws-cite" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{id}</button>
      {open && (
        <span className="ws-slip" role="note">
          <span className="ws-slip-h"><b>{id}</b> {ev.queryId === "derived" ? "derived by rule from recorded rows" : `Zetaris query ${ev.queryId}, row ${ev.row}`}</span>
          <span className="ws-slip-l">{ev.label}</span>
          {fields.length > 0 && (
            <span className="ws-slip-f">
              {fields.map(([k, v]) => (<span key={k}><i>{k.replace(/_/g, " ")}</i> {String(v)}</span>))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function Note(p: PanelProps) {
  const { m, pick } = p;
  if (!pick) return null;
  let title = "", body: React.ReactNode = null, cites: string[] = [];
  if (pick.kind === "plant") {
    const x = m.plants.find((q) => q.key === pick.key);
    if (!x) return null;
    title = x.unnamed ? x.fullName : x.name;
    const recent = [...x.signals].reverse().slice(0, 5);
    body = (
      <>
        <p>
          {x.unnamed ? "The label for this NDC names no manufacturing plant, so FDA's register can't be read for it." : (
            <>
              {x.placed ? "Registered plant on the label" : x.quality === "sponsor only" ? "Application sponsor only; no plant on the label" : "Named on the label, not placed by FDA's register"}
              {x.countryName ? `, ${x.countryName}` : ""}. {x.fei ? <>FEI <code>{x.fei}</code>.</> : "No FEI on file."}
              {x.lastClass ? ` Last classified ${x.lastClass.classification}, ${dstr(Math.round(Date.parse(x.lastClass.endDate) / 864e5))}.` : ""}
            </>
          )}
        </p>
        {recent.length > 0 && (
          <ul className="ws-note-list">
            {recent.map((s, i) => (<li key={i}><span className="d">{dshort(s.t)}</span> {s.text.replace(/^FDA /, "")} <Cite id={s.evidence} m={m} /></li>))}
          </ul>
        )}
      </>
    );
    cites = x.evidence;
  } else if (pick.kind === "labeler") {
    const l = m.labelers.find((q) => q.key === pick.key);
    if (!l) return null;
    title = l.name;
    const rec = recoveryOf(l.listing?.info);
    body = (
      <>
        <p>
          {l.ndcs.length ? <>NDC {l.ndcs.map((n, i) => <code key={n}>{i ? ", " : ""}{n}</code>)}. </> : null}
          {l.use > 0 ? `${fmt(l.use, 2)} ${unitWord(m.unit)} a day across our hospitals.` : "None used now."}
          {l.listed && m.listedNow ? ` On FDA's shortage list${l.listing ? ` (${l.listing.status.toLowerCase()}, updated ${l.listing.updated})` : ""}${rec ? `, ${rec}` : ""}.` : ""}
        </p>
        <ul className="ws-note-list">
          {m.hospitals.filter((h) => (l.hospUse[h.key] ?? 0) > 0).map((h) => (<li key={h.key}><span className="d">{h.short}</span> {fmt(l.hospUse[h.key] ?? 0, 2)} a day</li>))}
        </ul>
      </>
    );
    cites = [...new Set([...l.evidence, ...(l.listing ? [l.listing.evidence] : [])])];
  } else {
    const h = m.hospitals.find((q) => q.key === pick.key);
    if (!h) return null;
    title = h.key;
    body = <p>{fmt(h.onHand, 0)} {unitWord(m.unit)} on hand at {fmt(h.use, 2)} a day: {h.days === null ? "no daily use recorded" : `${fmt(h.days)} days`}. Read from {h.source}.</p>;
    cites = h.evidence;
  }
  return (
    <div className="ws-note" role="region" aria-label={`Record: ${title}`} ref={(el) => {
      // bring the record into view inside the floating panel (never scrolls the page)
      const panel = el?.closest(".ws-panel") as HTMLElement | null;
      if (panel) panel.scrollTop = panel.scrollHeight;
    }}>
      <div className="ws-note-h">
        <h4>{title}</h4>
        <button type="button" className="ws-x" onClick={p.onClosePick} aria-label="Close the record">&times;</button>
      </div>
      {body}
      {cites.length > 0 && <p className="ws-cites">{cites.slice(0, 12).map((c) => <Cite key={c} id={c} m={m} />)}</p>}
    </div>
  );
}

/* ---------------- engine ---------------- */
interface EngineHooks { onCur: (i: number) => void; onPlaying: (v: boolean) => void }
interface Particle { kind: 0 | 1 | 2 | 3; i: number; h: Hospital | null; s: number; u: number; v: number }

const played = new WeakSet<WsModel>();

function engine(sheet: HTMLElement, root: HTMLElement, m: WsModel, g: Geo, uidBase: string, hooks: EngineHooks) {
  const uid = `${uidBase}${g.mobile ? "t" : "w"}`;
  const reg = new Map<string, Element[]>();
  sheet.querySelectorAll("[data-d]").forEach((el) => {
    const k = el.getAttribute("data-d")!;
    (reg.get(k) ?? reg.set(k, []).get(k)!).push(el);
  });
  const R = (k: string) => reg.get(k) ?? [];
  const panel = root;
  const rDate = () => panel.querySelector<HTMLElement>('[data-r="date"]');
  const rLead = () => panel.querySelector<HTMLElement>('[data-r="listedLead"]');
  const rVal = () => panel.querySelector<HTMLElement>('[data-r="listedVal"]');
  const scrub = sheet.querySelector<HTMLInputElement>('[data-r="scrub"]');
  const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
  const labIdx = new Map(m.labelers.map((l, i) => [l.key, i]));

  let t: Day = m.today;
  let frame = frameAt(m, g, t);
  let lastCur = frame.cur;

  const setStops = (id: string, s: Frame["trib"][number]) => {
    const [c1, c2, f] = s.stops;
    const el = [0, 1, 2, 3].map((i) => R(`${id}:${i}`)[0] as SVGStopElement | undefined);
    if (!el[0]) return;
    el[0]!.style.stopColor = c1;
    el[1]!.setAttribute("offset", String(clamp(f, 0, 1)));
    el[1]!.style.stopColor = c1;
    el[2]!.setAttribute("offset", String(clamp(f + 0.05, 0, 1)));
    el[2]!.style.stopColor = c2;
    el[3]!.style.stopColor = c2;
  };
  const setStream = (dk: string, s: Frame["trib"][number]) => {
    R(`${dk}:water`).forEach((e) => e.setAttribute("opacity", s.water.toFixed(3)));
    R(`${dk}:low`).forEach((e) => e.setAttribute("opacity", s.low.toFixed(3)));
    R(`${dk}:bed`).forEach((e) => e.setAttribute("opacity", s.bed.toFixed(3)));
    R(`${dk}:thread`).forEach((e) => e.setAttribute("opacity", s.thread.toFixed(3)));
    R(`${dk}:edge`).forEach((e) => e.setAttribute("class", s.dash ? "ws-edge ws-edge-dry" : "ws-edge"));
  };

  function apply(nt: Day) {
    t = nt;
    frame = frameAt(m, g, t);
    g.tribs.forEach((_, i) => { setStops(`${uid}t${i}`, frame.trib[i]); setStream(`t:${i}`, frame.trib[i]); });
    m.labelers.forEach((l, li) => {
      setStops(`${uid}l${li}`, frame.branch[l.key]);
      m.hospitals.forEach((h) => setStream(`b:${li}:${h.key}`, frame.branch[l.key]));
      R(`flag:${li}`).forEach((e) => e.setAttribute("opacity", frame.flag[l.key] ? "1" : "0"));
    });
    for (const p of m.plants) {
      const pv = frame.plant[p.key];
      R(`c:${p.key}`).forEach((e) => e.setAttribute("opacity", String(pv.cloud)));
      (["oai", "insp", "vai"] as const).forEach((k) => R(`r:${p.key}:${k}`).forEach((e) => e.setAttribute("opacity", pv.ring === k ? "1" : "0")));
      R(`s:${p.key}`).forEach((e) => {
        if (e.textContent !== pv.state.text) e.textContent = pv.state.text;
        e.setAttribute("class", `ws-data ws-halo ws-state${pv.state.tone === "red" ? " ws-t-red" : pv.state.tone === "amber" ? " ws-t-amber" : ""}`);
      });
      pv.wl.forEach((on, i) => R(`w:${p.key}:${i}`).forEach((e) => e.setAttribute("opacity", on ? "1" : "0")));
      pv.ia.forEach((on, i) => R(`a:${p.key}:${i}`).forEach((e) => e.setAttribute("opacity", on ? "1" : "0")));
    }
    R("tl:cur").forEach((e) => e.setAttribute("transform", `translate(${r1(frame.cursorX)},0)`));
    R("tl:listed").forEach((e) => e.setAttribute("d", frame.listedFrom !== null ? `M${r1(frame.listedFrom)},${g.tl.y - 3}L${r1(frame.cursorX)},${g.tl.y - 3}` : ""));
    frame.glyph.forEach((on, i) => R(`g:${i}`).forEach((e) => e.classList.toggle("on", on)));
    const d = rDate(); if (d && d.textContent !== frame.date) d.textContent = frame.date;
    const ll = rLead(); if (ll && frame.listed && ll.textContent !== frame.listed.lead) ll.textContent = frame.listed.lead;
    const lv = rVal(); if (lv && frame.listed && lv.textContent !== frame.listed.value) lv.textContent = frame.listed.value;
    if (scrub) { scrub.value = String(Math.round(t - m.t0)); scrub.setAttribute("aria-valuetext", frame.date); }
    if (frame.cur !== lastCur) { lastCur = frame.cur; hooks.onCur(frame.cur); }
    if (RM.matches || !running) drawParticles();
  }

  /* pools */
  const days: Partial<Record<Hospital, number>> = {};
  m.hospitals.forEach((h) => (days[h.key] = h.days ?? 0));
  function drawPools() {
    for (const h of m.hospitals) {
      const Rr = g.res[h.key]!;
      const dd = days[h.key] ?? 0;
      const f = poolScale(dd);
      const sc = (q: number) => Rr.shore.map((p) => [Rr.c[0] + (p[0] - Rr.c[0]) * q, Rr.c[1] + (p[1] - Rr.c[1]) * q] as Pt);
      R(`p:${h.key}:pool`).forEach((e) => e.setAttribute("d", f > 0.02 ? smoothPath(sc(f), true) : ""));
      [0, 1, 2, 3].forEach((i) => R(`p:${h.key}:wl${i}`).forEach((e) => e.setAttribute("d", f > 0.12 ? smoothPath(sc(f * (0.84 - i * 0.15)), true) : "")));
      const top: Pt = [Rr.c[0] + (Rr.inlet[0] - Rr.c[0]) * f, Rr.c[1] + (Rr.inlet[1] - Rr.c[1]) * f];
      const Wi = Rr.inW;
      if (top[1] - Rr.inlet[1] > 3) {
        const L = line(cubic(Rr.inlet, [Rr.inlet[0], Rr.inlet[1] + (top[1] - Rr.inlet[1]) * 0.5], [top[0], top[1] - (top[1] - Rr.inlet[1]) * 0.4], [top[0], top[1] + 2], 16), (tt) => Wi * (1 - 0.35 * tt));
        R(`p:${h.key}:ch`).forEach((e) => e.setAttribute("d", ribbonD(L)));
      } else R(`p:${h.key}:ch`).forEach((e) => e.setAttribute("d", ""));
      const st = Rr.staff;
      const yy = st.y0 - Math.min(dd, CAP) * st.per;
      const tw = g.mobile ? 3.5 : 5;
      R(`p:${h.key}:mark`).forEach((e) => e.setAttribute("d", `M${r1(st.sx - 2)},${r1(yy)}l-${tw * 1.6},-${tw}l0,${tw * 2}Z`));
      const bot: Pt = [Rr.c[0] + (Rr.outlet[0] - Rr.c[0]) * f, Rr.c[1] + (Rr.outlet[1] - Rr.c[1]) * f];
      R(`p:${h.key}:markLine`).forEach((e) => e.setAttribute("d", `M${r1(st.sx - 2 - tw * 1.6)},${r1(yy)}L${r1(Math.min(st.sx - 8, bot[0] + Rr.rx * f * 0.7))},${r1(yy)}`));
      R(`p:${h.key}:big`).forEach((e) => { const s = h.days === null ? "n/a" : fmt(dd, 1); if (e.textContent !== s) e.textContent = s; });
      R(`p:${h.key}:stock`).forEach((e) => {
        const n = h.onHand + (transferDelta[h.key] ?? 0) * transferK;
        e.textContent = `${fmt(n, 0)} ${unitWord(m.unit)}, ${fmt(h.use, 1)} a day, ${h.source.replace(" cabinet exports", " exports")}`;
      });
    }
  }
  const transferDelta: Partial<Record<Hospital, number>> = {};
  if (m.transfer) { transferDelta[m.transfer.from] = -m.transfer.units; transferDelta[m.transfer.to] = m.transfer.units; }
  let transferK = 0, transferAnim = 0;
  function transfer(on: boolean) {
    if (!m.transfer) return;
    const from = transferK, to = on ? 1 : 0;
    if (from === to) return;
    R("canal:water").forEach((e) => e.setAttribute("opacity", on ? "1" : "0"));
    const t0 = performance.now(), ms = RM.matches ? 0 : 1100;
    cancelAnimationFrame(transferAnim);
    const tick = (now: number) => {
      const k = ms ? smooth(0, 1, (now - t0) / ms) : 1;
      transferK = from + (to - from) * k;
      for (const h of m.hospitals) {
        const base = h.days ?? 0;
        const after = m.transfer!.after[h.key];
        days[h.key] = after !== undefined ? base + (after - base) * transferK : base;
      }
      drawPools();
      if (k < 1) transferAnim = requestAnimationFrame(tick);
    };
    transferAnim = requestAnimationFrame(tick);
  }

  /* particles on a light canvas layer */
  const cv = sheet.querySelector<HTMLCanvasElement>("canvas.ws-flow")!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(g.W * dpr);
  cv.height = Math.round(g.H * dpr);
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const tribsOf = new Map<string, number[]>();
  g.tribs.forEach((tb, i) => (tribsOf.get(tb.lab) ?? tribsOf.set(tb.lab, []).get(tb.lab)!).push(i));
  const particles: Particle[] = [];
  const per = g.mobile ? 150 : 110;
  g.tribs.forEach((tb, i) => {
    const n = Math.round((tb.L.len * tb.w) / (per * 18));
    for (let j = 0; j < Math.max(3, Math.min(60, n)); j++) particles.push({ kind: 0, i, h: null, s: rnd() * tb.L.len, u: rnd() * 2 - 1, v: 0.75 + rnd() * 0.5 });
  });
  m.labelers.forEach((l, li) => m.hospitals.forEach((h) => {
    const b = g.branches[l.key][h.key];
    if (!b) return;
    const n = Math.round((b.L.len * b.w) / (per * 18));
    for (let j = 0; j < Math.max(2, Math.min(50, n)); j++) particles.push({ kind: 1, i: li, h: h.key, s: rnd() * b.L.len, u: rnd() * 2 - 1, v: 0.75 + rnd() * 0.5 });
  }));
  m.hospitals.forEach((h) => {
    const L = g.outs[h.key]!;
    const n = Math.round((L.len * h.use * g.k) / (per * 24));
    for (let j = 0; j < Math.max(3, Math.min(40, n)); j++) particles.push({ kind: 2, i: 0, h: h.key, s: rnd() * L.len, u: rnd() * 2 - 1, v: 0.6 + rnd() * 0.5 });
  });
  if (g.canal) for (let j = 0; j < 22; j++) particles.push({ kind: 3, i: 0, h: null, s: rnd() * g.canal.L.len, u: rnd() * 2 - 1, v: 0.6 + rnd() * 0.5 });
  const lineOf = (p: Particle): Line | null => {
    if (p.kind === 0) return g.tribs[p.i].L;
    if (p.kind === 1) return g.branches[m.labelers[p.i].key][p.h!]?.L ?? null;
    if (p.kind === 2) return g.outs[p.h!] ?? null;
    return g.canal?.L ?? null;
  };
  const stateOf = (p: Particle) => (p.kind === 0 ? frame.trib[p.i] : p.kind === 1 ? frame.branch[m.labelers[p.i].key] : null);
  let colA = "rgba(240,246,250,.82)", colB = "rgba(255,226,220,.9)";
  const readColors = () => {
    const cs = getComputedStyle(sheet);
    colA = cs.getPropertyValue("--ws-particle").trim() || colA;
    colB = cs.getPropertyValue("--ws-particle-silt").trim() || colB;
  };
  readColors();
  function step(dt: number) {
    const speed = g.mobile ? 26 : 44;
    for (const p of particles) {
      const L = lineOf(p);
      if (!L) continue;
      p.s += speed * p.v * dt;
      if (p.s < L.len) continue;
      if (p.kind === 0) {
        // into the gauge's stack, then down the branch that holds this lateral position
        const tb = g.tribs[p.i];
        const l = m.labelers.find((x) => x.key === tb.lab)!;
        const gg = g.gauges[tb.lab];
        const bs = Object.entries(g.branches[tb.lab]);
        if (!bs.length) { p.s = 0; continue; }
        const x = clamp((tb.ex + p.u * tb.w * 0.5 - (gg.x - gg.w / 2)) / Math.max(1, gg.w), 0, 1);
        const hit = bs.find(([, b]) => b && x >= b.cum0 && x <= b.cum1) ?? bs[0];
        const b = hit[1]!;
        p.kind = 1; p.i = labIdx.get(l.key)!; p.h = hit[0] as Hospital; p.s = 0;
        p.u = clamp(((x - b.cum0) / Math.max(1e-6, b.cum1 - b.cum0)) * 2 - 1, -1, 1);
      } else if (p.kind === 1) {
        const ts = tribsOf.get(m.labelers[p.i].key) ?? [];
        if (!ts.length) { p.s = 0; continue; }
        p.kind = 0; p.i = ts[Math.floor(rnd() * ts.length)]; p.h = null; p.s = 0; p.u = rnd() * 2 - 1;
      } else p.s = p.kind === 3 ? 0 : 0;
    }
  }
  function drawParticles() {
    ctx.clearRect(0, 0, g.W, g.H);
    ctx.lineCap = "round";
    ctx.lineWidth = g.mobile ? 1 : 1.35;
    const pathA = new Path2D(), pathB = new Path2D();
    for (const p of particles) {
      const L = lineOf(p);
      if (!L) continue;
      if (p.kind === 3 && transferK < 0.5) continue;
      const s = stateOf(p);
      const squeeze = s ? s.squeeze : 1;
      if (s && squeeze < 0.5 && ((p.v * 1000) | 0) % 4 !== 0) continue;
      const i = Math.min(L.p.length - 1, Math.max(0, Math.round(p.s / L.step)));
      const j = Math.max(0, i - (g.mobile ? 3 : 4));
      const half = (L.w[i] / 2) * 0.78 * squeeze;
      const x = L.p[i][0] + L.n[i][0] * p.u * half, y = L.p[i][1] + L.n[i][1] * p.u * half;
      const xb = L.p[j][0] + L.n[j][0] * p.u * half, yb = L.p[j][1] + L.n[j][1] * p.u * half;
      const silt = s && s.front > 0 && i / (L.p.length - 1) < s.front;
      const path = silt ? pathB : pathA;
      path.moveTo(xb, yb);
      path.lineTo(x, y);
    }
    ctx.strokeStyle = colA;
    ctx.stroke(pathA);
    ctx.strokeStyle = colB;
    ctx.stroke(pathB);
  }

  /* playback */
  const plan = planReplay(m);
  let playing = false, clock = 0, last = 0, running = false, vis = false, raf = 0;
  const tick = (ts: number) => {
    raf = 0;
    const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
    last = ts;
    if (playing) {
      clock += dt;
      const nt = planAt(plan, clock);
      apply(nt);
      if (clock >= plan.total) { playing = false; apply(m.today); hooks.onPlaying(false); played.add(m); }
    }
    if (!RM.matches) { step(dt); drawParticles(); }
    if ((vis && !RM.matches) || playing) raf = requestAnimationFrame(tick);
    else running = false;
  };
  const kick = () => { if (!raf) { running = true; last = 0; raf = requestAnimationFrame(tick); } };
  const onTheme = () => { readColors(); drawParticles(); };
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onTheme);
  const mo = new MutationObserver(onTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; running = false; } else if (vis) kick(); };
  document.addEventListener("visibilitychange", onVis);

  drawPools();
  apply(m.today);

  return {
    seek(nt: Day) { clock = 0; for (let i = 0; i < plan.keys.length; i++) if (plan.keys[i].t <= nt) clock = plan.keys[i].at; apply(clamp(nt, m.t0, m.today)); },
    play() {
      if (RM.matches) { apply(m.today); return; }
      if (t >= m.today - 0.5) { clock = 0; apply(m.t0); }
      playing = true; hooks.onPlaying(true); kick();
    },
    pause() { if (playing) { playing = false; hooks.onPlaying(false); } },
    transfer,
    visible(v: boolean) { vis = v; if (v) kick(); },
    hasPlayed: () => played.has(m),
    destroy() {
      cancelAnimationFrame(raf); cancelAnimationFrame(transferAnim);
      mq.removeEventListener("change", onTheme); mo.disconnect(); document.removeEventListener("visibilitychange", onVis);
    },
  };
}

