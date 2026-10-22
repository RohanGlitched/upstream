// Shapes the chronograph's server loader hands to the client. Kept free of server imports.

export type Health = "signal" | "watch" | "clear" | "unknown";

/** One FDA action at a plant. k: oai | vai | nai (inspections, dated by the day they ended), wl, ia, inj, sz. */
export interface ChronoEvent {
  d: string;
  k: "oai" | "vai" | "nai" | "wl" | "ia" | "inj" | "sz";
  /** Inspection id, warning-letter case id or import-alert number, when FDA gives one. */
  id: string | null;
  /** When the classification letter went out, for inspections. */
  known?: string | null;
  /** Where the event came from: the FDA file, or a recorded case (matched by firm name when FDA gives no FEI). */
  src?: "fda" | "case";
}

export interface ChronoPlant {
  i: number;
  name: string;
  fei: string | null;
  iso: string | null;
  address: string | null;
  /** FDA's rule applied to the record on the day the atlas was built. */
  health: Health;
  last: string | null;
  /** Position in the 820 x 820 drawing, already spread around the country's centroid. */
  x: number;
  y: number;
  /** Distance to Corvale along the Earth, km (from the country centroid FDA's file gives). */
  km: number;
  bearing: number;
  products: { labeler: string; molecule: string }[];
  events: ChronoEvent[];
  cases: { slug: string; title: string }[];
}

export interface ChronoCountry {
  iso: string;
  n: number;
  x: number;
  y: number;
  r: number;
  signal: number;
}

export interface ChronoData {
  asOf: string;
  builtAt: string | null;
  queryId: string | null;
  from: string;
  plants: ChronoPlant[];
  countries: ChronoCountry[];
  geo: {
    land: string;
    borders: string;
    graticule: string;
    hub: [number, number];
  };
  casesRead: number;
}

export const SIZE = 820;
export const CX = 410;
export const CY = 410;
export const RM = 318;
export const EARTH_KM = 6371.0088;
/** Corvale Health: a fictional system in the US Midwest. */
export const HUB_LONLAT: [number, number] = [-86.0, 40.4];
export const BEZEL_FROM = "2022-01-01";
export const BEZEL_TO = "2027-01-01";
