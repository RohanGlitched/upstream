import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCase } from "@/src/lib/cases";
import { Film } from "@/components/film";
import type { EvalFile, PlantsFile } from "@/components/film";

async function readJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path.join(process.cwd(), p), "utf8")) as T; } catch { return null; }
}

export default async function FilmLab({ searchParams }: { searchParams: Promise<{ top?: string }> }) {
  const { top } = await searchParams;
  const c = await getCase("carboplatin");
  if (!c) notFound();
  const { graph: _graph, ...lean } = c;
  void _graph;
  const plants = await readJson<PlantsFile>("data/plants.json");
  const trace = await readJson<EvalFile>("data/eval/trace.json");
  // only what the film reads: positions, health and the eval summary
  const plantsLean = plants && { asOf: plants.asOf, queryId: plants.queryId, plants: plants.plants.map((p) => ({ name: p.name, fei: p.fei, country_iso3: p.country_iso3, lat: p.lat, lon: p.lon, health: p.health })) };
  const evalLean = trace && { summary: trace.summary };
  return (
    <>
      <div className="lab-wrap" style={{ paddingBottom: 24 }}>
        <p className="lab-row"><Link href="/lab">Lab</Link><span>The prologue film, built from the carboplatin case.</span></p>
      </div>
      <Film caseData={lean} plants={plantsLean} evalData={evalLean} offsetTop={top ? Number(top) : 65} />
      <div className="lab-wrap"><p className="lab-p">After the film.</p></div>
    </>
  );
}
