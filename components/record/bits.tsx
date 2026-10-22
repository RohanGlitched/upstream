// Small pieces of the record that render anywhere, server or client: Tall Man type, typed characters,
// rubber stamps, the barcodes, and the shared SVG defs (ink filters, the bulldog clip, the tick).
import type { CSSProperties, ReactNode } from "react";
import type { Matrix, Upc } from "./codes";

/** FDA Tall Man lettering as type: the capitals carry the weight. */
export function TallName({ name, className }: { name: string; className?: string }) {
  const runs = name.match(/[A-Z]{2,}|[^A-Z]+|[A-Z]/g) ?? [name];
  const hasTall = /[A-Z]{2,}/.test(name);
  return (
    <span className={className} aria-label={name}>
      {runs.map((r, i) =>
        hasTall && /^[A-Z]{2,}$/.test(r) ? (
          <b key={i} aria-hidden="true">{r}</b>
        ) : (
          <i key={i} aria-hidden="true">{r}</i>
        ),
      )}
    </span>
  );
}

/** A size for a name that has to fit a fixed label width: long combination names step down. */
export function fitSize(name: string, max: number, width: number, min = 13): number {
  const est = name.length * 0.58;
  return Math.max(min, Math.min(max, Math.floor(width / Math.max(4, est))));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Typed text: each character struck a little differently, deterministic so server and client agree. */
export function Typed({ text, className }: { text: string; className?: string }) {
  let seed = hash(text) || 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const words = text.split(/(\s+)/);
  return (
    <span className={`typed${className ? " " + className : ""}`} aria-label={text}>
      {words.map((w, wi) =>
        /^\s+$/.test(w) ? (
          <span key={wi} aria-hidden="true">{w}</span>
        ) : (
          <span key={wi} className="typed-w" aria-hidden="true">
            {[...w].map((ch, i) => (
              <span
                key={i}
                className="typed-c"
                style={{ "--y": `${((rnd() - 0.5) * 0.8).toFixed(2)}px`, "--o": (0.78 + rnd() * 0.22).toFixed(2) } as CSSProperties}
              >
                {ch}
              </span>
            ))}
          </span>
        ),
      )}
    </span>
  );
}

/** A rubber stamp. Tone picks the ink: red for FDA's findings, amber for VAI, carbon for Upstream's own marks. */
export function Stamp({
  big,
  top,
  bottom,
  tone = "red",
  className,
  label,
  w = 178,
  h = 104,
}: {
  big: string;
  top?: string;
  bottom?: string;
  tone?: "red" | "amber" | "carbon" | "ink" | "magenta";
  className?: string;
  label?: string;
  w?: number;
  h?: number;
}) {
  const size = Math.min(47, Math.floor((w - 30) / Math.max(2.2, big.length * 0.78)));
  return (
    <svg className={`stamp stamp--${tone}${className ? " " + className : ""}`} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label ?? [big, bottom, top].filter(Boolean).join(", ")}>
      <g filter="url(#rd-ink)">
        <rect x="3" y="3" width={w - 6} height={h - 6} rx="7" fill="none" strokeWidth="4.6" />
        <rect x="10" y="10" width={w - 20} height={h - 20} rx="3" fill="none" strokeWidth="1.4" />
        {top ? (
          <text x={w / 2} y="27" textAnchor="middle" fontSize="10.5" fontWeight="700" letterSpacing="2.2" stroke="none">
            {top}
          </text>
        ) : null}
        <text x={w / 2} y={top ? h * 0.67 : h * 0.6} textAnchor="middle" fontSize={size} fontWeight="900" letterSpacing={big.length > 6 ? 2 : 6} stroke="none">
          {big}
        </text>
        {bottom ? (
          <text x={w / 2} y={h - 18} textAnchor="middle" fontSize="8.6" fontWeight="700" letterSpacing=".9" stroke="none">
            {bottom}
          </text>
        ) : null}
      </g>
    </svg>
  );
}

/** A small box stamp for registers and ledgers ("ALLOWED", "CONFIRMED"). */
export function BoxStamp({ children, tone = "carbon", tilt = -2 }: { children: ReactNode; tone?: "red" | "amber" | "carbon" | "ink" | "clear"; tilt?: number }) {
  return (
    <span className={`boxstamp boxstamp--${tone}`} style={{ "--tilt": `${tilt}deg` } as CSSProperties}>
      {children}
    </span>
  );
}

export function UpcSvg({ upc, className, title }: { upc: Upc; className?: string; title?: string }) {
  const W = upc.width;
  const d = upc.digits;
  return (
    <svg className={className} viewBox={`0 0 ${W} 40`} preserveAspectRatio="none" shapeRendering="crispEdges" role="img" aria-label={title ?? `UPC-A ${d}`}>
      <path d={upc.bars} className="bars" />
      <g className="hri">
        <text x="4" y="39.6" fontSize="6" textAnchor="middle">{d[0]}</text>
        <text x={9 + 3 + 21} y="39.6" fontSize="7" textAnchor="middle">{d.slice(1, 6)}</text>
        <text x={9 + 50 + 21} y="39.6" fontSize="7" textAnchor="middle">{d.slice(6, 11)}</text>
        <text x={W - 4} y="39.6" fontSize="6" textAnchor="middle">{d[11]}</text>
      </g>
    </svg>
  );
}

export function DmSvg({ m, className, title }: { m: Matrix; className?: string; title: string }) {
  return (
    <svg className={className} viewBox={`-1 -1 ${m.size + 2} ${m.size + 2}`} shapeRendering="crispEdges" role="img" aria-label={title}>
      <path d={m.path} className="bars" />
    </svg>
  );
}

export function TickMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={(size * 20) / 24} viewBox="0 0 24 20" aria-hidden="true">
      <path d="M3 11 C 5 12, 7 14, 9 17 C 12 10, 16 5, 22 2" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A hand-drawn pencil ring, stretched to whatever it circles. */
export function Ring({ className }: { className?: string }) {
  return (
    <svg className={`ring${className ? " " + className : ""}`} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path vectorEffect="non-scaling-stroke" pathLength={1} d="M14 5 C 46 -3, 95 1, 97 18 C 99 35, 52 42, 16 37 C -3 33, 0 11, 24 3" />
    </svg>
  );
}

/** Mounted once in the layout: the ink filters and the steel clip every page shares. */
export function InkDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="rd-ink" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".95" numOctaves="2" seed="11" result="fine" />
          <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="3" result="coarse" />
          <feComposite in="fine" in2="coarse" operator="arithmetic" k1="0" k2=".75" k3=".55" k4="0" result="mix" />
          <feColorMatrix in="mix" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -3.1 0 0 0 2.75" result="holes" />
          <feComposite in="SourceGraphic" in2="holes" operator="in" result="inked" />
          <feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="2" seed="8" result="warp" />
          <feDisplacementMap in="inked" in2="warp" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="rd-ink-soft" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="5" result="fine" />
          <feColorMatrix in="fine" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.2 0 0 0 2.05" result="holes" />
          <feComposite in="SourceGraphic" in2="holes" operator="in" />
        </filter>
        <radialGradient id="rd-pinhead" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".25" stopColor="#C9CFCC" />
          <stop offset=".8" stopColor="#6E7774" />
          <stop offset="1" stopColor="#4C5452" />
        </radialGradient>
        <linearGradient id="rd-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4A5150" />
          <stop offset=".45" stopColor="#1E2322" />
          <stop offset="1" stopColor="#0F1312" />
        </linearGradient>
        <symbol id="rd-bulldog" viewBox="0 0 30 26">
          <path d="M8 9 C 6 1, 12 -3, 15 -3 C 18 -3, 24 1, 22 9" fill="none" stroke="#8C9592" strokeWidth="1.4" />
          <path d="M8.6 9 C 7 2.4, 12 -1.6, 15 -1.6 C 18 -1.6, 23 2.4, 21.4 9" fill="none" stroke="#DDE3E0" strokeWidth=".5" opacity=".8" />
          <path d="M2 8 H28 L26 24 H4 Z" fill="url(#rd-steel)" />
          <path d="M3.2 9.6 H26.8" stroke="#79807E" strokeWidth=".8" />
          <path d="M5 22.6 H25" stroke="#000" strokeWidth=".8" opacity=".5" />
        </symbol>
      </defs>
    </svg>
  );
}

export function Clip({ className }: { className?: string }) {
  return (
    <svg className={`clip${className ? " " + className : ""}`} viewBox="0 0 30 26" aria-hidden="true">
      <use href="#rd-bulldog" />
    </svg>
  );
}

export function PaperClip({ className }: { className?: string }) {
  return (
    <svg className={`paperclip${className ? " " + className : ""}`} viewBox="0 0 22 62" aria-hidden="true">
      <path d="M7 14 V48 C7 56, 17 56, 17 48 V8 C17 1, 4 1, 4 8 V44" fill="none" stroke="#8D9693" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M7.6 14 V48 C7.6 55, 16.4 55, 16.4 48" fill="none" stroke="#E7ECEA" strokeWidth=".7" />
    </svg>
  );
}
