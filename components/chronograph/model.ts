// Pure helpers shared by the chronograph and the plant ledger: dates, FDA's health rule at any day, and words.
import type { ChronoEvent, ChronoPlant, Health } from "./types";

const DAY = 86_400_000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const dn = (iso: string): number => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);

export function fmtDay(n: number): string {
  const d = new Date(Math.round(n) * DAY);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtIso(iso: string | null | undefined): string {
  return iso ? fmtDay(dn(iso)) : "";
}

export function monthYear(n: number): string {
  const d = new Date(Math.round(n) * DAY);
  return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const KIND_WORD: Record<ChronoEvent["k"], string> = {
  oai: "Inspection classified OAI",
  vai: "Inspection classified VAI",
  nai: "Inspection, no action",
  wl: "Warning letter",
  ia: "Import alert",
  inj: "Injunction",
  sz: "Seizure",
};

export const KIND_SHORT: Record<ChronoEvent["k"], string> = {
  oai: "OAI",
  vai: "VAI",
  nai: "NAI",
  wl: "Warning letter",
  ia: "Import alert",
  inj: "Injunction",
  sz: "Seizure",
};

/** The colour family each kind belongs to: red where FDA found a problem, magenta at the border, amber for VAI. */
export function toneOf(k: ChronoEvent["k"]): "signal" | "border" | "caution" | "clear" {
  if (k === "ia") return "border";
  if (k === "vai") return "caution";
  if (k === "nai") return "clear";
  return "signal";
}

export const HEALTH_WORD: Record<Health, string> = {
  signal: "FDA acted here",
  watch: "Worth watching",
  clear: "Inspected, no action",
  unknown: "Not inspected lately",
};

export const HEALTH_RULE: Record<Health, string> = {
  signal: "An OAI inspection, warning letter or import alert in the three years before",
  watch: "A VAI inspection in the two years before, or a last inspection that was OAI",
  clear: "Inspected in the four years before, with nothing worse than that",
  unknown: "No inspection on FDA's file in the four years before",
};

export interface PlantClock {
  days: number[];
  ev: ChronoEvent[];
}

export function clockOf(p: ChronoPlant): PlantClock {
  return { days: p.events.map((e) => dn(e.d)), ev: p.events };
}

/** FDA's rule (src/agent/investigate.ts healthOf) applied to the record as it stood on day t. */
export function healthAt(c: PlantClock, t: number): Health {
  const Y = 365.25;
  let lastInsp = -1;
  let signal = false;
  for (let i = 0; i < c.days.length; i++) {
    const d = c.days[i];
    if (d > t) break;
    const k = c.ev[i].k;
    // Firm-name matches from a case are shown, but FDA's rule (and plants.json) only counts records joined by FEI.
    if (c.ev[i].src === "case") continue;
    const age = (t - d) / Y;
    if ((k === "oai" || k === "wl" || k === "ia" || k === "inj" || k === "sz") && age <= 3) signal = true;
    if (k === "oai" || k === "vai" || k === "nai") lastInsp = i;
  }
  if (signal) return "signal";
  if (lastInsp < 0) return "unknown";
  const k = c.ev[lastInsp].k;
  const age = (t - c.days[lastInsp]) / Y;
  if (k === "oai") return "watch";
  if (k === "vai" && age <= 2) return "watch";
  if (age <= 4) return "clear";
  return "unknown";
}

export function lastText(s: string | null): string {
  if (!s) return "No inspection on file";
  const m = /^([A-Z]{3})\s+(\d{4}-\d{2}-\d{2})$/.exec(s);
  return m ? `${m[1]}, ${fmtIso(m[2])}` : s;
}

export function kmText(km: number): string {
  return `${(Math.round(km / 10) * 10).toLocaleString("en-US")} km`;
}
