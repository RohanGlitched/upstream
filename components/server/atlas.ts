// Server-side map geometry and the plant list for the atlas. Plants come from data/plants.json (the same file
// /api/plants serves); without it, they are gathered from the recorded cases.
import { geoEqualEarth, geoPath, geoCentroid } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { loadAllCases, readJson } from "./data";

export interface AtlasPlant {
  name: string;
  fei: string | null;
  country_iso3: string | null;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  health: "signal" | "watch" | "clear" | "unknown";
  last: string | null;
  products: { labeler: string; molecule: string }[];
  signals: number;
}

export interface PlantsFile {
  builtAt?: string;
  asOf?: string;
  queryId?: string;
  ms?: number;
  counts?: Record<string, number>;
  plants: AtlasPlant[];
}

export interface PlacedPlant extends AtlasPlant {
  id: string;
  x: number | null;
  y: number | null;
  cases: string[];
}

export const MAP_W = 960;
export const MAP_H = 468;

// ISO 3166 alpha-3 to the numeric ids world-atlas uses.
const NUMERIC: Record<string, string> = {
  USA: "840", IND: "356", CHN: "156", DEU: "276", ITA: "380", ESP: "724", FRA: "250", GBR: "826", IRL: "372",
  CHE: "756", AUT: "040", NLD: "528", BEL: "056", KOR: "410", JPN: "392", ISR: "376", CAN: "124", MEX: "484",
  BRA: "076", PRT: "620", HUN: "348", POL: "616", SVN: "705", CZE: "203", DNK: "208", SWE: "752", GRC: "300",
  TUR: "792", ARG: "032", AUS: "036", TWN: "158", BGD: "050", JOR: "400", EGY: "818", ZAF: "710", CYP: "196",
  ROU: "642", HRV: "191", FIN: "246", NOR: "578", SVK: "703", LVA: "428", LTU: "440", BGR: "100", SRB: "688",
  ISL: "352", LUX: "442", NZL: "554", THA: "764", MYS: "458", IDN: "360", VNM: "704", PHL: "608", PAK: "586",
  ARE: "784", SAU: "682", URY: "858", CHL: "152", COL: "170", DOM: "214", CRI: "188", EST: "233", UKR: "804",
  RUS: "643", BLR: "112", KAZ: "398", LKA: "144", NPL: "524", PER: "604", MAR: "504", TUN: "788", SGP: "702",
  PRI: "630", MLT: "470",
};

// Small or oddly shaped places whose centroid from 110m outlines is missing or off.
const FALLBACK: Record<string, [number, number]> = {
  SGP: [103.82, 1.35], PRI: [-66.5, 18.2], MLT: [14.4, 35.9], LUX: [6.13, 49.8], USA: [-98.6, 39.8], FRA: [2.5, 46.6], NOR: [9, 61],
};

export async function loadPlants(): Promise<{ file: PlantsFile | null; derived: boolean; plants: AtlasPlant[] }> {
  const file = await readJson<PlantsFile>("data/plants.json");
  if (file && Array.isArray(file.plants) && file.plants.length) return { file, derived: false, plants: file.plants };
  // Fallback: the plants named in the recorded cases.
  const byKey = new Map<string, AtlasPlant>();
  for (const { c } of await loadAllCases()) {
    for (const p of c.chain) {
      for (const pl of p.plants) {
        const k = pl.fei ?? pl.name;
        const cur = byKey.get(k);
        const prod = { labeler: p.labeler, molecule: c.molecule };
        if (cur) cur.products.push(prod);
        else
          byKey.set(k, {
            name: pl.name, fei: pl.fei, country_iso3: pl.country, address: pl.address, health: pl.health,
            last: pl.lastClassification ? `${pl.lastClassification.classification} ${pl.lastClassification.endDate}` : null,
            products: [prod], signals: pl.signals.length,
          });
      }
    }
  }
  return { file: null, derived: true, plants: [...byKey.values()] };
}

export async function buildAtlas() {
  const topo = world as unknown as Topology<{ countries: GeometryCollection; land: GeometryCollection }>;
  const land = feature(topo, topo.objects.land);
  const countries = feature(topo, topo.objects.countries);
  const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b);
  const projection = geoEqualEarth().fitExtent(
    [
      [8, 8],
      [MAP_W - 8, MAP_H - 8],
    ],
    { type: "Sphere" },
  );
  const path = geoPath(projection);
  const centroid = new Map<string, [number, number]>();
  for (const f of countries.features) {
    const id = String(f.id);
    centroid.set(id, geoCentroid(f) as [number, number]);
  }

  const { file, derived, plants } = await loadPlants();

  // Which recorded cases name each plant, by FEI or by name.
  const caseLinks = new Map<string, Set<string>>();
  const add = (k: string | null | undefined, slug: string) => {
    if (!k) return;
    const s = caseLinks.get(k) ?? new Set<string>();
    s.add(slug);
    caseLinks.set(k, s);
  };
  for (const { slug, c } of await loadAllCases()) {
    for (const p of c.chain) for (const pl of p.plants) {
      add(pl.fei, slug);
      add(pl.name.toLowerCase(), slug);
    }
    for (const m of c.market) for (const pl of m.plants) {
      add(pl.fei, slug);
      add(pl.name.toLowerCase(), slug);
    }
  }

  // Place each plant; plants sharing a point (country centroids) spread out on a sunflower spiral.
  const groups = new Map<string, number>();
  const placed: PlacedPlant[] = plants.map((p, i) => {
    let lonlat: [number, number] | null = null;
    const iso = p.country_iso3?.toUpperCase() ?? null;
    if (typeof p.lon === "number" && typeof p.lat === "number") lonlat = [p.lon, p.lat];
    else if (iso && FALLBACK[iso]) lonlat = FALLBACK[iso];
    else if (iso && NUMERIC[iso] && centroid.has(NUMERIC[iso])) lonlat = centroid.get(NUMERIC[iso])!;
    let x: number | null = null;
    let y: number | null = null;
    if (lonlat) {
      const pt = projection(lonlat);
      if (pt) {
        const key = `${pt[0].toFixed(0)},${pt[1].toFixed(0)}`;
        const n = groups.get(key) ?? 0;
        groups.set(key, n + 1);
        const r = n === 0 ? 0 : 5.2 * Math.sqrt(n);
        const a = n * 2.39996;
        x = pt[0] + r * Math.cos(a);
        y = pt[1] + r * Math.sin(a);
      }
    }
    // Match by FEI; a name match is used only when the plant has no FEI (firms run several plants).
    const links = new Set<string>(p.fei ? caseLinks.get(p.fei) ?? [] : caseLinks.get(p.name.toLowerCase()) ?? []);
    return { ...p, id: `${p.fei ?? "x"}-${i}`, x, y, cases: [...links] };
  });

  // Crop the empty polar oceans: plants sit between about 50 degrees south and 72 north.
  const yTop = Math.max(0, (projection([0, 74]) ?? [0, 0])[1]);
  const yBottom = Math.min(MAP_H, (projection([0, -52]) ?? [0, MAP_H])[1]);
  return {
    viewBox: `0 ${yTop.toFixed(0)} ${MAP_W} ${(yBottom - yTop).toFixed(0)}`,
    landPath: path(land) ?? "",
    borderPath: path(borders) ?? "",
    spherePath: path({ type: "Sphere" }) ?? "",
    plants: placed,
    file,
    derived,
  };
}
