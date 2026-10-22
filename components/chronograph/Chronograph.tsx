"use client";

// The chronograph: an azimuthal-equidistant world centred on Corvale Health, every plant behind the formulary on it,
// and a calendar bezel that replays FDA's actions at those plants from 2022 to today. Server-rendered at today's state
// so the first paint is the finished picture; the replay runs once when it comes into view.
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { countryName, firmCase } from "../lib/format";
import {
  HEALTH_RULE,
  HEALTH_WORD,
  KIND_SHORT,
  KIND_WORD,
  clockOf,
  dn,
  fmtDay,
  fmtIso,
  healthAt,
  kmText,
  lastText,
  toneOf,
} from "./model";
import { BEZEL_FROM, BEZEL_TO, CX, CY, EARTH_KM, RM, SIZE, type ChronoData, type ChronoEvent, type ChronoPlant, type Health } from "./types";
import "./chronograph.css";

const T0 = dn(BEZEL_FROM);
const T1 = dn(BEZEL_TO);
const R_ARC = 342;
const R_EV = 348;
const SEG = 4.3;
const R_YEAR = 389;
const FLASH_DAYS = 55;
const ORDER: Health[] = ["signal", "watch", "clear", "unknown"];
const KIND_ORDER: ChronoEvent["k"][] = ["oai", "wl", "inj", "sz", "ia", "vai", "nai"];

const ang = (n: number) => ((n - T0) / (T1 - T0)) * 2 * Math.PI;
const pol = (a: number, r: number): [number, number] => [CX + Math.sin(a) * r, CY - Math.cos(a) * r];
const f1 = (v: number) => Math.round(v * 10) / 10;

function arc(n0: number, n1: number, r: number): string {
  const a0 = ang(n0);
  const a1 = ang(Math.max(n1, n0 + 0.01));
  const p0 = pol(a0, r);
  const p1 = pol(a1, r);
  return `M${f1(p0[0])},${f1(p0[1])} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f1(p1[0])},${f1(p1[1])}`;
}

interface Flat {
  p: ChronoPlant;
  e: ChronoEvent;
  n: number;
}

function Glyph({ k, size = 14 }: { k: ChronoEvent["k"] | "today"; size?: number }) {
  return (
    <svg className={`chr-glyph chr-glyph--${k === "today" ? "today" : toneOf(k)}`} width={size} height={size} viewBox="-7 -7 14 14" aria-hidden="true">
      {k === "oai" ? <path d="M0 -5.5 L5.5 0 L0 5.5 L-5.5 0 Z" /> : null}
      {k === "wl" || k === "inj" || k === "sz" ? <path d="M0 -5 L5.2 4.4 L-5.2 4.4 Z" /> : null}
      {k === "ia" ? <rect x={-4} y={-4} width={8} height={8} /> : null}
      {k === "vai" ? <path d="M0 -4.8 L4.8 0 L0 4.8 L-4.8 0 Z" className="hollow" /> : null}
      {k === "nai" ? <circle r={3.6} className="hollow" /> : null}
      {k === "today" ? (
        <>
          <circle r={4.8} className="hollow" />
          <circle r={1.8} />
        </>
      ) : null}
    </svg>
  );
}

export function KindGlyph({ k }: { k: ChronoEvent["k"] }) {
  return <Glyph k={k} />;
}

function Stamp({ h }: { h: Health }) {
  return <span className={`chr-stamp chr-stamp--${h}`}>{HEALTH_WORD[h]}</span>;
}

/** The plant's record card: what FDA has on file, what we buy from it, and the investigations that reach it. */
function RecordCard({ p, t, state, onClose, compact }: { p: ChronoPlant; t: number; state: Health; onClose: () => void; compact?: boolean }) {
  const evs = [...p.events].reverse();
  const shown = evs.slice(0, compact ? 4 : 8);
  const molecules = [...new Set(p.products.map((x) => x.molecule))];
  const labelers = [...new Set(p.products.map((x) => x.labeler))];
  return (
    <article className="chr-card" aria-labelledby={`chr-card-${p.i}`}>
      <header className="chr-card__head">
        <h3 id={`chr-card-${p.i}`}>{firmCase(p.name)}</h3>
        <button type="button" className="chr-x" onClick={onClose} aria-label="Close the record card">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2 L12 12 M12 2 L2 12" />
          </svg>
        </button>
      </header>
      <p className="chr-card__where">
        {p.fei ? (
          <>
            FEI <span className="chr-type">{p.fei}</span>,{" "}
          </>
        ) : (
          "No FEI on file, "
        )}
        {countryName(p.iso)}
      </p>
      <p className="chr-card__dist">
        {kmText(p.km)} from Corvale, bearing {String(Math.round(p.bearing)).padStart(3, "0")}°
      </p>
      <div className="chr-card__state">
        <Stamp h={state} />
        <span>
          on {fmtDay(t)}. {HEALTH_RULE[state]}.
        </span>
      </div>
      {!compact && p.address ? <p className="chr-card__addr">{p.address.replace(/\s*\([A-Z]{3}\)\s*$/, "")}</p> : null}
      <h4>FDA&apos;s record</h4>
      {shown.length ? (
        <ol className="chr-card__evs">
          {shown.map((e, i) => {
            const future = dn(e.d) > t;
            return (
              <li key={i} className={future ? "is-future" : undefined}>
                <Glyph k={e.k} />
                <span className="chr-card__d">{fmtIso(e.d)}</span>
                <span>
                  {KIND_WORD[e.k]}
                  {e.id ? <span className="chr-type"> {e.k === "ia" ? e.id : e.k === "wl" ? `case ${e.id}` : e.id}</span> : null}
                  {e.k === "oai" && e.known ? `, letter ${fmtIso(e.known)}` : ""}
                  {e.src === "case" ? (e.k === "ia" ? ", matched by firm name" : ", from a recorded case") : ""}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="chr-card__none">Nothing on FDA&apos;s file since 2017. Last on record: {lastText(p.last)}.</p>
      )}
      {evs.length > shown.length ? (
        <p className="chr-card__more">
          and {evs.length - shown.length} earlier, back to {fmtIso(evs[evs.length - 1].d)}
        </p>
      ) : null}
      <h4>What it makes for our formulary</h4>
      <p className="chr-card__mol">
        {molecules.slice(0, compact ? 5 : 10).join(", ")}
        {molecules.length > (compact ? 5 : 10) ? `, and ${molecules.length - (compact ? 5 : 10)} more` : ""}
        <span className="chr-card__lab">
          {labelers.length === 1 ? `Labelled by ${labelers[0]}` : `For ${labelers.length} labelers`}
        </span>
      </p>
      <h4>Investigations that reach it</h4>
      {p.cases.length ? (
        <ul className="chr-card__cases">
          {p.cases.slice(0, compact ? 4 : 12).map((c) => (
            <li key={c.slug}>
              <Link href={`/case/${c.slug}`}>{c.title}</Link>
            </li>
          ))}
          {p.cases.length > (compact ? 4 : 12) ? <li className="chr-card__more">and {p.cases.length - (compact ? 4 : 12)} more</li> : null}
        </ul>
      ) : (
        <p className="chr-card__none">No recorded investigation names this plant yet.</p>
      )}
    </article>
  );
}

export function Chronograph({
  data,
  variant = "full",
  intro,
  autoplay = true,
}: {
  data: ChronoData;
  variant?: "full" | "band";
  intro?: ReactNode;
  autoplay?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const TODAY = dn(data.asOf);
  const [t, setT] = useState(TODAY);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const raf = useRef<number | null>(null);
  const played = useRef(false);
  const drag = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;

  const plants = data.plants;
  const clocks = useMemo(() => plants.map(clockOf), [plants]);
  const byBearing = useMemo(() => [...plants].sort((a, b) => a.bearing - b.bearing || a.km - b.km).map((p) => p.i), [plants]);
  const flat: Flat[] = useMemo(() => {
    const out: Flat[] = [];
    for (const p of plants) for (const e of p.events) if (e.d >= BEZEL_FROM) out.push({ p, e, n: dn(e.d) });
    return out.sort((a, b) => a.n - b.n);
  }, [plants]);
  const actions = useMemo(() => flat.filter((f) => f.e.k !== "nai"), [flat]);

  const states = useMemo(() => clocks.map((c) => healthAt(c, Math.floor(t))), [clocks, t]);
  const sig = states.join("|");
  const counts = useMemo(() => {
    const c: Record<Health, number> = { signal: 0, watch: 0, clear: 0, unknown: 0 };
    for (const s of sig.split("|")) c[s as Health]++;
    return c;
  }, [sig]);

  // Playback: 2022 to today in about twenty seconds, once, when the band is on screen.
  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setPlaying(false);
  }, []);
  const play = useCallback(
    (from?: number) => {
      if (raf.current) cancelAnimationFrame(raf.current);
      const start = from ?? (tRef.current >= TODAY - 1 ? T0 : tRef.current);
      const span = TODAY - start;
      if (span <= 0) return;
      const ms = (span / (TODAY - T0)) * (variant === "band" ? 16000 : 21000);
      const t0 = performance.now();
      setPlaying(true);
      const step = (now: number) => {
        const f = Math.min(1, (now - t0) / ms);
        setT(start + span * f);
        if (f < 1) raf.current = requestAnimationFrame(step);
        else {
          raf.current = null;
          setPlaying(false);
        }
      };
      raf.current = requestAnimationFrame(step);
    },
    [TODAY, variant],
  );
  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  useEffect(() => {
    if (!autoplay || played.current) return;
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = rootRef.current;
    if (!el) return;
    let timer = 0;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting) && !played.current) {
          played.current = true;
          io.disconnect();
          // Let today's picture land first, then wind back to 2022 and replay.
          timer = window.setTimeout(() => play(T0), 1100);
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, [autoplay, play]);

  // Other parts of the page (the ledger) can ask for a plant by FEI.
  useEffect(() => {
    const pick = (fei: string | null) => {
      if (!fei) return false;
      const p = plants.find((x) => x.fei === fei);
      if (!p) return false;
      setSel(p.i);
      return true;
    };
    const onEv = (e: Event) => {
      const fei = (e as CustomEvent<{ fei: string }>).detail?.fei ?? null;
      if (pick(fei)) rootRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    };
    const onHash = () => {
      const m = /^#plant-(\w+)$/.exec(window.location.hash);
      if (m) pick(m[1]);
    };
    window.addEventListener("upstream:plant", onEv);
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => {
      window.removeEventListener("upstream:plant", onEv);
      window.removeEventListener("hashchange", onHash);
    };
  }, [plants]);

  // Pointer: the bezel is a dial for the date; inside it, a tap picks the nearest plant.
  const toSvg = (cx: number, cy: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: p.x, y: p.y, scale: m.a };
  };
  const dayAt = (x: number, y: number) => {
    let a = Math.atan2(x - CX, -(y - CY));
    if (a < 0) a += 2 * Math.PI;
    return Math.max(T0, Math.min(TODAY, T0 + (a / (2 * Math.PI)) * (T1 - T0)));
  };
  const nearest = (x: number, y: number, scale: number) => {
    const lim = Math.max(14, 26 / Math.max(scale, 0.2));
    let best: number | null = null;
    let bd = lim;
    for (const p of plants) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = p.i;
      }
    }
    return best;
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const s = toSvg(e.clientX, e.clientY);
    if (!s) return;
    const r = Math.hypot(s.x - CX, s.y - CY);
    if (r > RM + 3 && r < 404) {
      stop();
      drag.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setT(dayAt(s.x, s.y));
      return;
    }
    if (r <= RM + 3) {
      const n = nearest(s.x, s.y, s.scale);
      setSel((cur) => (n === null ? null : n === cur ? cur : n));
    }
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const s = toSvg(e.clientX, e.clientY);
    if (!s) return;
    if (drag.current) {
      setT(dayAt(s.x, s.y));
      return;
    }
    if (e.pointerType === "mouse") {
      const r = Math.hypot(s.x - CX, s.y - CY);
      setHover(r <= RM + 3 ? nearest(s.x, s.y, s.scale) : null);
    }
  };
  const onUp = () => {
    drag.current = false;
  };

  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const pos = sel === null ? -1 : byBearing.indexOf(sel);
    const n = byBearing.length;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      setSel(byBearing[(pos + 1) % n]);
      e.preventDefault();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      setSel(byBearing[(pos - 1 + n) % n]);
      e.preventDefault();
    } else if (e.key === "Escape") {
      setSel(null);
    } else if (e.key === " " || e.key === "Enter") {
      if (playing) stop();
      else play();
      e.preventDefault();
    }
  };

  const stepAction = (dir: 1 | -1) => {
    stop();
    const cur = Math.floor(tRef.current);
    const list = dir > 0 ? actions.filter((f) => f.n > cur && f.n <= TODAY) : actions.filter((f) => f.n < cur).reverse();
    const f = list[0];
    if (!f) return;
    setT(f.n);
    setSel(f.p.i);
  };

  // ---------- static layers (memoised; they never change with the date) ----------
  const { land, borders, graticule, hub } = data.geo;
  const mapLayer = useMemo(() => {
    const rings: ReactNode[] = [];
    for (let r = 5.6; r < RM - 2; r += 5.6) {
      const n = Math.max(6, Math.floor((2 * Math.PI * r) / 5.6));
      const gap = (2 * Math.PI * r) / n;
      rings.push(<circle key={r} cx={CX} cy={CY} r={f1(r)} strokeDasharray={`0 ${gap.toFixed(3)}`} />);
    }
    return (
      <g className="chr-map">
        <defs>
          <clipPath id={`land-${uid}`}>
            <path d={land} />
          </clipPath>
          <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" className="chr-glow0" />
            <stop offset="100%" className="chr-glow1" />
          </radialGradient>
        </defs>
        <circle className="chr-sphere" cx={CX} cy={CY} r={RM} />
        <circle cx={CX} cy={CY} r={RM} fill={`url(#glow-${uid})`} />
        <path className="chr-grat" d={graticule} />
        <path className="chr-land" d={land} />
        <g className="chr-stipple" clipPath={`url(#land-${uid})`}>
          {rings}
        </g>
        <path className="chr-borders" d={borders} />
        <path className="chr-coast" d={land} />
        {[5000, 10000, 15000].map((km) => {
          const r = (km / (Math.PI * EARTH_KM)) * RM;
          const a = (205 * Math.PI) / 180;
          return (
            <g key={km}>
              <circle className="chr-ring" cx={CX} cy={CY} r={f1(r)} />
              <text className="chr-ringlab" x={f1(CX + Math.sin(a) * r + 4)} y={f1(CY - Math.cos(a) * r + 3)}>
                {km.toLocaleString("en-US")} km
              </text>
            </g>
          );
        })}
        <circle className="chr-rim" cx={CX} cy={CY} r={RM} />
        <g className="chr-brg">
          {Array.from({ length: 72 }, (_, i) => {
            const b = i * 5;
            const a = (b * Math.PI) / 180;
            const big = b % 30 === 0;
            const p0 = pol(a, RM);
            const p1 = pol(a, RM - (big ? 8 : 4));
            return <line key={b} className={big ? "big" : undefined} x1={f1(p0[0])} y1={f1(p0[1])} x2={f1(p1[0])} y2={f1(p1[1])} />;
          })}
          {Array.from({ length: 11 }, (_, i) => {
            const b = (i + 1) * 30;
            const q = pol((b * Math.PI) / 180, RM - 18);
            return (
              <text key={b} x={f1(q[0])} y={f1(q[1])} textAnchor="middle" dominantBaseline="central">
                {String(b).padStart(3, "0")}°
              </text>
            );
          })}
          <text className="n" x={CX} y={CY - RM + 18} textAnchor="middle" dominantBaseline="central">
            N
          </text>
        </g>
        <text className="chr-ringlab chr-far" x={CX} y={CY + RM - 9} textAnchor="middle">
          20,015 km, the far side of the Earth
        </text>
      </g>
    );
  }, [land, borders, graticule, uid]);

  const countryLayer = useMemo(
    () => (
      <g className="chr-ctry" aria-hidden="true">
        {data.countries.map((c) => (
          <g key={c.iso}>
            {c.n > 1 ? <circle cx={c.x} cy={c.y} r={c.r} className={c.signal ? "sig" : undefined} /> : null}
            {c.n >= 5 ? (
              <text x={c.x} y={f1(c.y + c.r + 13)} textAnchor="middle" className="halo">
                {c.iso === "USA" ? "" : `${countryName(c.iso)} ${c.n}`}
              </text>
            ) : null}
          </g>
        ))}
      </g>
    ),
    [data.countries],
  );

  const bezelStatic = useMemo(() => {
    const ticks: ReactNode[] = [];
    for (let m = 0; m < 60; m++) {
      const y = 2022 + Math.floor(m / 12);
      const mo = m % 12;
      const n = dn(`${y}-${String(mo + 1).padStart(2, "0")}-01`);
      const a = ang(n);
      const isY = mo === 0;
      const isQ = mo % 3 === 0;
      const p0 = pol(a, RM + 2);
      const p1 = pol(a, isY ? RM + 19 : isQ ? RM + 12 : RM + 8);
      ticks.push(<line key={m} className={isY ? "y" : isQ ? "q" : undefined} x1={f1(p0[0])} y1={f1(p0[1])} x2={f1(p1[0])} y2={f1(p1[1])} />);
    }
    const years: ReactNode[] = [];
    for (let y = 2022; y <= 2026; y++) {
      const a = ang(dn(`${y}-07-01`));
      const p = pol(a, R_YEAR);
      let deg = (a * 180) / Math.PI;
      if (deg > 90 && deg < 270) deg += 180;
      years.push(
        <text key={y} className="chr-yl" textAnchor="middle" dominantBaseline="central" transform={`translate(${f1(p[0])},${f1(p[1])}) rotate(${f1(deg)})`}>
          {y}
        </text>,
      );
    }
    // FDA's actions as a radial histogram: one stack per week, red first, then the border, amber and green.
    const weeks = new Map<number, Flat[]>();
    for (const f of flat) {
      const w = Math.floor((f.n - T0) / 7);
      const l = weeks.get(w) ?? [];
      l.push(f);
      weeks.set(w, l);
    }
    const segs: ReactNode[] = [];
    for (const [w, l] of weeks) {
      l.sort((a, b) => KIND_ORDER.indexOf(a.e.k) - KIND_ORDER.indexOf(b.e.k));
      const a = ang(T0 + w * 7 + 3.5);
      l.slice(0, 6).forEach((f, j) => {
        const p0 = pol(a, R_EV + j * SEG);
        const p1 = pol(a, R_EV + j * SEG + SEG - 1.1);
        segs.push(<line key={`${w}-${j}`} className={`seg seg--${toneOf(f.e.k)}`} x1={f1(p0[0])} y1={f1(p0[1])} x2={f1(p1[0])} y2={f1(p1[1])} />);
      });
    }
    return (
      <g className="chr-bezel" aria-hidden="true">
        <circle className="chr-bz-bg" cx={CX} cy={CY} r={361} />
        <circle className="chr-bz-out" cx={CX} cy={CY} r={402} />
        <g className="chr-ticks">{ticks}</g>
        {years}
        <path className="chr-future" d={arc(TODAY, T1 - 1, R_ARC)} />
        <g className="chr-segs">{segs}</g>
      </g>
    );
  }, [flat, TODAY]);

  // ---------- dynamic layers ----------
  const flashing = useMemo(() => {
    const now = Math.floor(t);
    if (now >= TODAY && !playing) return [] as Flat[];
    return actions.filter((f) => f.n <= now && f.n > now - FLASH_DAYS && f.e.k !== "vai");
  }, [actions, t, TODAY, playing]);
  const flashKey = flashing.map((f) => `${f.p.i}${f.e.k}${f.n}`).join(",");

  const plantLayer = useMemo(() => {
    const st = sig.split("|") as Health[];
    return (
      <g className="chr-plants">
        <g className="chr-spokes">
          {plants.map((p) => (
            <line key={p.i} className={`sp sp--${st[p.i]}${sel === p.i ? " is-sel" : ""}`} x1={p.x} y1={p.y} x2={hub[0]} y2={hub[1]} />
          ))}
        </g>
        {plants.map((p) => (
          <g key={p.i} className={`pl pl--${st[p.i]}${sel === p.i ? " is-sel" : ""}${hover === p.i ? " is-hover" : ""}`} transform={`translate(${p.x},${p.y})`}>
            {st[p.i] === "signal" ? <circle className="pl-ring" r={6.2} /> : null}
            <circle className="pl-dot" r={st[p.i] === "unknown" ? 2.6 : 3.3} />
          </g>
        ))}
      </g>
    );
  }, [plants, sig, sel, hover, hub]);

  const flashLayer = useMemo(
    () => (
      <g className="chr-flashes" aria-hidden="true">
        {flashing.map((f) => (
          <g key={`${f.p.i}-${f.e.k}-${f.n}`} className={`fl fl--${toneOf(f.e.k)}`}>
            <line x1={f.p.x} y1={f.p.y} x2={hub[0]} y2={hub[1]} pathLength={100} />
            <circle cx={f.p.x} cy={f.p.y} r={5} />
          </g>
        ))}
      </g>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flashKey, hub],
  );

  const now = Math.floor(t);
  const elapsed = arc(T0, Math.min(t, TODAY), R_ARC);
  const shade = arc(Math.min(t, TODAY), T1 - 0.5, 361);
  const ptrDeg = (ang(t) * 180) / Math.PI;
  const latest = useMemo(() => {
    for (let i = actions.length - 1; i >= 0; i--) if (actions[i].n <= now) return actions[i];
    return null;
  }, [actions, now]);
  const ticker = playing || now < TODAY ? (flashing.length ? flashing[flashing.length - 1] : null) : null;

  const selP = sel !== null ? plants[sel] : null;
  const hovP = hover !== null && hover !== sel ? plants[hover] : null;
  const label = (p: ChronoPlant, cls: string, lines: string[]) => {
    const left = p.x > CX + 40 || (p.x > CX - 40 && p.x > hub[0]);
    const lx = p.x + (left ? 12 : -12);
    const ly = p.y - 10;
    return (
      <text className={`chr-label ${cls} halo`} x={f1(lx)} y={f1(ly)} textAnchor={left ? "start" : "end"}>
        {lines.map((l, i) => (
          <tspan key={i} x={f1(lx)} dy={i === 0 ? 0 : "1.3em"} className={i === 0 ? "l0" : "l1"}>
            {l}
          </tspan>
        ))}
      </text>
    );
  };
  const midSel = selP ? { x: (selP.x + hub[0]) / 2, y: (selP.y + hub[1]) / 2 } : null;
  let selAng = selP ? (Math.atan2(hub[1] - selP.y, hub[0] - selP.x) * 180) / Math.PI : 0;
  if (selAng > 90) selAng -= 180;
  if (selAng < -90) selAng += 180;

  const total = plants.length;
  const isBand = variant === "band";

  return (
    <div className={`chr chr--${variant}`} ref={rootRef} data-playing={playing ? "" : undefined}>
      <div className="chr-intro">
        {intro}
        <div className="chr-date" aria-live="off">
          <span className="chr-date__v">{fmtDay(Math.min(Math.floor(t), TODAY))}</span>
          <span className="chr-date__s">{now >= TODAY ? "today, on FDA's file" : "replaying FDA's file"}</span>
        </div>
        <ul className="chr-counts" aria-label={`Plants on ${fmtDay(now)}`}>
          {ORDER.map((h) => (
            <li key={h} className={`chr-count chr-count--${h}`}>
              <span className="chr-count__n">{counts[h]}</span>
              <span className="chr-count__bar" aria-hidden="true">
                <span style={{ width: `${(counts[h] / Math.max(1, total)) * 100}%` }} />
              </span>
              <span className="chr-count__k">{HEALTH_WORD[h]}</span>
            </li>
          ))}
        </ul>
        {isBand ? (
          <p className="chr-more">
            <Link href="/plants">Open the plant atlas</Link>
            <span> {total} plants, {data.countries.length} countries, every FDA action since 2022</span>
          </p>
        ) : null}
      </div>

      <div className="chr-stage">
        <svg
          ref={svgRef}
          className="chr-svg"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="group"
          aria-label={`World map centred on Corvale Health with ${total} plants. Arrow keys move between plants, Escape clears, Space plays the replay.`}
          tabIndex={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
        >
          {mapLayer}
          {bezelStatic}
          <path className="chr-shade" d={shade} />
          <path className="chr-elapsed" d={elapsed} />
          {countryLayer}
          {plantLayer}
          {flashLayer}
          {selP && midSel ? (
            <>
              <line className="chr-selspoke" x1={selP.x} y1={selP.y} x2={hub[0]} y2={hub[1]} />
              {selP.km > 1500 ? (
                <text className="chr-dist halo" textAnchor="middle" transform={`translate(${f1(midSel.x)},${f1(midSel.y)}) rotate(${f1(selAng)}) translate(0,-6)`}>
                  {kmText(selP.km)}
                </text>
              ) : null}
            </>
          ) : null}
          <g className="chr-hub" aria-hidden="true">
            <circle cx={hub[0]} cy={hub[1]} r={8.5} className="hub-ring" />
            <circle cx={hub[0]} cy={hub[1]} r={3.6} className="hub-dot" />
            <text className="chr-hublab halo" x={hub[0] + 16} y={hub[1] + 46}>
              <tspan x={hub[0] + 16}>Corvale Health</tspan>
              <tspan x={hub[0] + 16} dy="1.3em" className="l1">
                US Midwest, {plants.filter((p) => p.iso === "USA").length} US plants around it
              </tspan>
            </text>
          </g>
          {hovP ? label(hovP, "is-hover", [firmCase(hovP.name)]) : null}
          {ticker && (!selP || ticker.p.i !== selP.i)
            ? label(ticker.p, `is-tick tone-${toneOf(ticker.e.k)}`, [firmCase(ticker.p.name), `${KIND_SHORT[ticker.e.k]}, ${fmtDay(ticker.n)}`])
            : null}
          {selP ? label(selP, "is-sel", [firmCase(selP.name), `${selP.fei ? `FEI ${selP.fei}, ` : ""}${countryName(selP.iso)}`]) : null}
          <g className="chr-ptr" transform={`rotate(${f1(ptrDeg)} ${CX} ${CY})`} aria-hidden="true">
            <line x1={CX} y1={CY - RM - 1} x2={CX} y2={CY - 404} />
            <path d={`M${CX} ${CY - RM - 1} l-4.5 -8 h9 Z`} />
            <circle cx={CX} cy={CY - R_ARC} r={4.2} />
          </g>
          <g className="chr-todaymk" aria-hidden="true">
            {(() => {
              const p = pol(ang(TODAY), R_ARC);
              return <circle cx={f1(p[0])} cy={f1(p[1])} r={5.5} />;
            })()}
          </g>
        </svg>

        <div className="chr-controls">
          <button type="button" className="chr-btn chr-btn--play" onClick={() => (playing ? stop() : play())} aria-pressed={playing}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2 1 L11 6 L2 11 Z" />}
            </svg>
            {playing ? "Pause" : now >= TODAY ? "Replay 2022 to today" : "Play"}
          </button>
          <button type="button" className="chr-btn chr-btn--icon" onClick={() => stepAction(-1)} aria-label="Previous FDA action">
            <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
              <path d="M2 1v10M12 1 L4 6 L12 11 Z" />
            </svg>
          </button>
          <button type="button" className="chr-btn chr-btn--icon" onClick={() => stepAction(1)} aria-label="Next FDA action">
            <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
              <path d="M12 1v10M2 1 L10 6 L2 11 Z" />
            </svg>
          </button>
          <label className="chr-range">
            <span className="sr-only">Date on the bezel</span>
            <input
              type="range"
              min={T0}
              max={TODAY}
              step={1}
              value={Math.round(Math.min(t, TODAY))}
              aria-valuetext={fmtDay(Math.min(Math.floor(t), TODAY))}
              onChange={(e) => {
                stop();
                setT(Number(e.target.value));
              }}
            />
          </label>
        </div>
      </div>

      <div className="chr-side">
        {selP ? (
          <RecordCard p={selP} t={Math.min(now, TODAY)} state={states[selP.i]} onClose={() => setSel(null)} compact={isBand} />
        ) : (
          <div className="chr-key">
            {latest ? (
              <div className="chr-latest">
                <p className="chr-latest__k">{now >= TODAY ? "FDA's latest action on this map" : "The action on the bezel"}</p>
                <button type="button" className="chr-latest__b" onClick={() => setSel(latest.p.i)}>
                  <Glyph k={latest.e.k} />
                  <span>
                    <strong>{firmCase(latest.p.name)}</strong>
                    <span>
                      {KIND_WORD[latest.e.k]}, {fmtDay(latest.n)}, {countryName(latest.p.iso)}
                    </span>
                  </span>
                </button>
              </div>
            ) : null}
            <ul className="chr-legend">
              <li>
                <svg width="26" height="16" viewBox="-13 -8 26 16" aria-hidden="true">
                  <circle r={6} className="lg-ring" />
                  <circle r={3.3} className="lg-sig" />
                </svg>
                <span>An OAI inspection, warning letter or import alert in three years</span>
              </li>
              <li>
                <svg width="26" height="16" viewBox="-13 -8 26 16" aria-hidden="true">
                  <circle r={3.3} className="lg-cau" />
                </svg>
                <span>A recent VAI, or a last inspection that was OAI</span>
              </li>
              <li>
                <svg width="26" height="16" viewBox="-13 -8 26 16" aria-hidden="true">
                  <circle r={3.3} className="lg-clr" />
                </svg>
                <span>Inspected in four years, nothing worse</span>
              </li>
              <li>
                <svg width="26" height="16" viewBox="-13 -8 26 16" aria-hidden="true">
                  <line x1={-12} y1={0} x2={12} y2={0} className="lg-spoke" />
                </svg>
                <span>The shortest path over the Earth to Corvale; rings every 5,000 km</span>
              </li>
              <li>
                <svg width="26" height="16" viewBox="-13 -8 26 16" aria-hidden="true">
                  <line x1={-10} y1={5} x2={-10} y2={-5} className="lg-seg-s" />
                  <line x1={-4} y1={5} x2={-4} y2={-5} className="lg-seg-b" />
                  <line x1={2} y1={5} x2={2} y2={-5} className="lg-seg-c" />
                  <line x1={8} y1={5} x2={8} y2={-5} className="lg-seg-g" />
                </svg>
                <span>
                  The bezel is a calendar, 2022 to 2026: one mark per FDA action, red for OAI and letters, magenta for import
                  alerts, amber VAI, green NAI. Drag it.
                </span>
              </li>
            </ul>
            {!isBand ? <p className="chr-hint">Tap a plant, or focus the map and use the arrow keys, to open its record.</p> : null}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {selP ? `${firmCase(selP.name)}, ${countryName(selP.iso)}: ${HEALTH_WORD[states[selP.i]]} on ${fmtDay(now)}.` : ""}
      </p>
    </div>
  );
}
