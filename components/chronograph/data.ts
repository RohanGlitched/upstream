// Server-side loader for the chronograph: every plant behind the formulary, its FDA record and the cases that use it.
// Plants come from data/plants.json; FDA actions from fda-history.json (built from FDA's files by build-history.mjs)
// plus the signals the recorded cases found (some import alerts are matched by firm name, so only the cases have them).
import "server-only";
import { geoAzimuthalEquidistant, geoDistance, geoGraticule, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { loadAllCases, readJson } from "../server/data";
import { drugTitle } from "../lib/drug";
import history from "./fda-history.json";
import {
  CX,
  CY,
  EARTH_KM,
  HUB_LONLAT,
  RM,
  type ChronoCountry,
  type ChronoData,
  type ChronoEvent,
  type ChronoPlant,
  type Health,
} from "./types";

interface PlantsFile {
  builtAt?: string;
  asOf?: string;
  queryId?: string;
  plants: {
    name: string;
    fei: string | null;
    country_iso3: string | null;
    address?: string | null;
    lat?: number | null;
    lon?: number | null;
    /** True only when lat/lon are the site's own; the atlas query writes the country's centre otherwise. */
    geocoded?: boolean;
    health: Health;
    last: string | null;
    products: { labeler: string; molecule: string }[];
  }[];
}

// Country centroids for plants whose file row has no coordinates.
const FALLBACK: Record<string, [number, number]> = {
  USA: [-98.6, 39.8], IND: [79, 22.5], CHN: [104, 35], ITA: [12.5, 42.8], FRA: [2.5, 46.6], DEU: [10.4, 51.1],
  ESP: [-3.7, 40.2], GBR: [-2, 53], CHE: [8.2, 46.8], AUT: [14.5, 47.6], PRT: [-8.2, 39.6], NOR: [9, 61],
  SWE: [16, 62], DNK: [9.5, 56], GRC: [22, 39.3], TWN: [121, 23.7], CAN: [-106, 56], AUS: [134, -25],
};

const KIND: Record<string, ChronoEvent["k"]> = {
  inspection_oai: "oai",
  inspection_vai: "vai",
  warning_letter: "wl",
  import_alert: "ia",
  injunction: "inj",
  seizure: "sz",
};

type Geo = ChronoData["geo"] & { project: (p: [number, number]) => [number, number] };
let GEO: Geo | null = null;

function geometry(): Geo {
  if (GEO) return GEO;
  const proj = geoAzimuthalEquidistant()
    .rotate([-HUB_LONLAT[0], -HUB_LONLAT[1]])
    .clipAngle(179.9)
    .scale(RM / Math.PI)
    .translate([CX, CY])
    .precision(0.4);
  const path = geoPath(proj);
  const topo = world as unknown as Topology<{ countries: GeometryCollection; land: GeometryCollection }>;
  const land = feature(topo, topo.objects.land);
  const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b);
  const round = (d: string | null) => (d ?? "").replace(/(\d+\.\d)\d+/g, "$1");
  const hub = proj(HUB_LONLAT) ?? [CX, CY];
  GEO = {
    land: round(path(land)),
    borders: round(path(borders)),
    // The graticule is a faint guide: whole units are enough, and a third of the bytes.
    graticule: (path(geoGraticule().step([15, 15])()) ?? "").replace(/(\d+)\.\d+/g, "$1"),
    hub: [hub[0], hub[1]],
    project: (p) => (proj(p) as [number, number]) ?? [CX, CY],
  };
  return GEO;
}

// The atlas is the same for every visitor until a file under it changes: keep it for a minute rather than rebuild
// it (and walk every recorded case) on each request.
let CACHE: { at: number; data: ChronoData } | null = null;
const TTL_MS = 60_000;

export async function loadChronoData(): Promise<ChronoData> {
  if (CACHE && Date.now() - CACHE.at < TTL_MS) return CACHE.data;
  const data = await buildChronoData();
  CACHE = { at: Date.now(), data };
  return data;
}

async function buildChronoData(): Promise<ChronoData> {
  const file = await readJson<PlantsFile>("data/plants.json");
  const plants = file?.plants ?? [];
  const asOf = file?.asOf ?? (history as { asOf: string }).asOf;
  const geo = geometry();
  const H = (history as { plants: Record<string, ChronoEvent[]>; from: string }).plants;

  // Cases that name each plant (by FEI), and the signals they found there.
  const caseLinks = new Map<string, Map<string, string>>();
  const caseEvents = new Map<string, ChronoEvent[]>();
  const all = await loadAllCases();
  for (const { slug, c } of all) {
    const title = drugTitle(c.molecule);
    const link = (fei: string | null | undefined) => {
      if (!fei) return;
      const m = caseLinks.get(fei) ?? new Map<string, string>();
      m.set(slug, title);
      caseLinks.set(fei, m);
    };
    for (const p of c.chain ?? []) {
      for (const pl of p.plants ?? []) {
        link(pl.fei);
        for (const s of pl.signals ?? []) {
          const fei = s.fei ?? pl.fei;
          const k = KIND[s.kind];
          if (!fei || !k || !s.date) continue;
          const list = caseEvents.get(fei) ?? [];
          list.push({ d: s.date, k, id: null, known: s.knownDate ?? null, src: "case" });
          caseEvents.set(fei, list);
        }
      }
    }
    for (const m of c.market ?? []) for (const pl of m.plants ?? []) link(pl.fei);
  }

  // Spread plants that share a country centroid on a sunflower, keeping clear of Corvale itself.
  const groups = new Map<string, number>();
  const out: ChronoPlant[] = plants.map((p, i) => {
    const iso = p.country_iso3?.toUpperCase() ?? null;
    const lonlat: [number, number] =
      typeof p.lon === "number" && typeof p.lat === "number" ? [p.lon, p.lat] : (iso && FALLBACK[iso]) || HUB_LONLAT;
    const [px, py] = geo.project(lonlat);
    const key = iso ?? `${px.toFixed(0)},${py.toFixed(0)}`;
    let n = groups.get(key) ?? 0;
    let x = px;
    let y = py;
    for (;;) {
      const r = n === 0 ? 0 : 5.6 * Math.sqrt(n + 0.6);
      const a = n * 2.39996;
      x = px + r * Math.cos(a);
      y = py + r * Math.sin(a);
      n++;
      if (Math.hypot(x - geo.hub[0], y - geo.hub[1]) > 15) break;
    }
    groups.set(key, n);
    const km = geoDistance(lonlat, HUB_LONLAT) * EARTH_KM;
    const bearing = ((Math.atan2(x - CX, -(y - CY)) * 180) / Math.PI + 360) % 360;

    const seen = new Set<string>();
    const events: ChronoEvent[] = [];
    for (const e of [...(p.fei ? H[p.fei] ?? [] : []).map((e) => ({ ...e, src: "fda" as const })), ...(p.fei ? caseEvents.get(p.fei) ?? [] : [])]) {
      if (e.d > asOf) continue;
      const k = `${e.k}${e.d}`;
      if (seen.has(k)) continue;
      seen.add(k);
      events.push({ d: e.d, k: e.k, id: e.id ?? null, known: e.known ?? null, src: e.src });
    }
    events.sort((a, b) => a.d.localeCompare(b.d));
    // The client needs four years before the bezel for FDA's rule, plus the last inspection before that (an old OAI
    // still keeps a plant off "clear"). Older records stay on the server.
    const CUT = "2017-10-01";
    const lastOld = events.filter((e) => e.d < CUT && (e.k === "oai" || e.k === "vai" || e.k === "nai") && e.src === "fda").pop();
    const kept = [...(lastOld ? [lastOld] : []), ...events.filter((e) => e.d >= CUT)];
    const links = p.fei ? caseLinks.get(p.fei) : undefined;
    return {
      i,
      name: p.name,
      fei: p.fei,
      iso,
      address: p.address ?? null,
      health: p.health,
      last: p.last,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      km: Math.round(km),
      bearing: Math.round(bearing * 10) / 10,
      placed: p.geocoded ? "site" : "country",
      products: p.products ?? [],
      events: kept,
      cases: links ? [...links.entries()].map(([slug, title]) => ({ slug, title })).sort((a, b) => a.title.localeCompare(b.title)) : [],
    };
  });

  const byIso = new Map<string, ChronoPlant[]>();
  for (const p of out) {
    if (!p.iso) continue;
    const l = byIso.get(p.iso) ?? [];
    l.push(p);
    byIso.set(p.iso, l);
  }
  const countries: ChronoCountry[] = [...byIso.entries()]
    .map(([iso, l]) => {
      const lonlat = FALLBACK[iso] ?? [0, 0];
      const src = plants.find((p) => p.country_iso3 === iso && typeof p.lon === "number");
      const [x, y] = geo.project(src && typeof src.lon === "number" && typeof src.lat === "number" ? [src.lon, src.lat] : lonlat);
      const r = Math.max(...l.map((p) => Math.hypot(p.x - x, p.y - y))) + 7;
      return { iso, n: l.length, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.round(r * 10) / 10, signal: l.filter((p) => p.health === "signal").length };
    })
    .sort((a, b) => b.n - a.n);

  return {
    asOf,
    builtAt: file?.builtAt ?? null,
    queryId: file?.queryId ?? null,
    from: (history as { from: string }).from,
    plants: out,
    countries,
    geo: { land: geo.land, borders: geo.borders, graticule: geo.graticule, hub: geo.hub },
    casesRead: all.length,
  };
}
