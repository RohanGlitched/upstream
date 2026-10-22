// A pen signature drawn from a name: one continuous stroke whose loops follow the letters (tall for
// ascenders, dropped for descenders). Deterministic, so the same pharmacist always signs the same way.
import type { CSSProperties } from "react";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const ASC = new Set("bdfhklt".split(""));
const DESC = new Set("gjpqyz".split(""));

export function signaturePath(name: string): { d: string; w: number } {
  const clean = name.replace(/,.*$/, "").trim() || name;
  let seed = hash(clean) || 9;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const base = 30;
  let x = 6;
  const pts: [number, number][] = [[x, base + 2]];
  const words = clean.split(/\s+/);
  words.forEach((w, wi) => {
    [...w].forEach((ch, i) => {
      const c = ch.toLowerCase();
      const cap = i === 0;
      const top = cap ? 4 + rnd() * 3 : ASC.has(c) ? 9 + rnd() * 4 : 19 + rnd() * 4;
      const bottom = DESC.has(c) ? base + 10 + rnd() * 3 : base + rnd() * 1.5;
      const step = cap ? 9 + rnd() * 3 : 5.2 + rnd() * 2.2;
      // Only the first letters of later words are fully formed; the rest trail off, as signatures do.
      if (wi > 0 && i > 3) return;
      pts.push([x + step * 0.35, top]);
      pts.push([x + step * 0.7, bottom]);
      x += step;
    });
    x += 7 + rnd() * 4;
    pts.push([x - 4, base + 1]);
  });
  // The underline flourish.
  pts.push([x + 4, base - 4]);
  pts.push([x - (x * 0.55 + rnd() * 10), base + 6 + rnd() * 3]);
  pts.push([x + 10, base + 3]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    d += ` Q${x1.toFixed(1)} ${y1.toFixed(1)} ${((x1 + x2) / 2).toFixed(1)} ${((y1 + y2) / 2).toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  return { d, w: Math.ceil(x + 16) };
}

export function Signature({ name, draw = false, className, style }: { name: string; draw?: boolean; className?: string; style?: CSSProperties }) {
  const { d, w } = signaturePath(name);
  return (
    <svg
      className={`sig-pen${draw ? " is-drawing" : ""}${className ? " " + className : ""}`}
      viewBox={`0 0 ${w} 48`}
      width={w * 1.15}
      height={55}
      role="img"
      aria-label={`Signed: ${name}`}
      style={style}
    >
      <path d={d} />
    </svg>
  );
}
