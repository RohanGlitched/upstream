// Plain names for the systems a Zetaris query read. Lineage (src/lib/lineage.ts) resolves each USL table to the
// hospital database or FDA file behind it, so a name here is always a physical system.
import { systemOf, systemsOf, type SourceSystem } from "../../src/lib/lineage";

export function sourceName(s: string): string {
  return systemOf(s).name;
}

/** The distinct data systems behind a step's or a query's sources (H-MEM is memory, not a data system). */
export function dataSystems(sources: Iterable<string>): SourceSystem[] {
  return systemsOf(sources).filter((s) => s.kind !== "memory");
}
