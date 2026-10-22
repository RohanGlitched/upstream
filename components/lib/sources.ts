// Plain names for the sources a Zetaris query read.
const SOURCE_NAME: Record<string, string> = {
  "lightning.metastore.upstream": "Upstream semantic layer (USL)",
  "corvale_general": "Corvale General, Postgres",
  "corvale_east": "Corvale East, Postgres",
  "corvale_lakeside": "Corvale Lakeside, cabinet CSV",
  "meterless.hmem": "H-MEM decision memory",
};

export function sourceName(s: string): string {
  if (SOURCE_NAME[s]) return SOURCE_NAME[s];
  const [db, table] = s.split(".");
  if (db === "fda" && table) return `FDA ${table.replace(/_/g, " ")}`;
  if (SOURCE_NAME[db] && table) return `${SOURCE_NAME[db]}: ${table.replace(/_/g, " ")}`;
  return s;
}
