import Link from "next/link";
import { notFound } from "next/navigation";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { getCase } from "@/src/lib/cases";
import { Watershed } from "@/components/watershed";

export default async function WatershedLab({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ compact?: string }> }) {
  const { slug } = await params;
  const { compact } = await searchParams;
  const c = await getCase(slug);
  if (!c) notFound();
  // the world-model graph isn't drawn here; keep it out of the client payload
  const { graph: _graph, ...lean } = c;
  void _graph;
  const all = (await readdir(path.join(process.cwd(), "data", "cases"))).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  const i = all.indexOf(slug);
  return (
    <div className="lab-wrap">
      <p className="lab-row">
        <Link href="/lab">Lab</Link>
        {i > 0 && <Link href={`/lab/watershed/${all[i - 1]}`}>Previous: {all[i - 1]}</Link>}
        {i < all.length - 1 && <Link href={`/lab/watershed/${all[i + 1]}`}>Next: {all[i + 1]}</Link>}
        <Link href={`/lab/watershed/${slug}${compact ? "" : "?compact=1"}`}>{compact ? "Full" : "Compact"}</Link>
      </p>
      <Watershed caseData={lean} compact={!!compact} />
    </div>
  );
}
