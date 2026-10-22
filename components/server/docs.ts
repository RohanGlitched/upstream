// Reads the engine README and the Zetaris SQL files so /how shows what the repo actually says.
import { listDir, readText } from "./data";

export interface MdTable {
  head: string[];
  rows: string[][];
}

/** The first Markdown table after a heading whose text includes `heading`. */
export function tableAfter(md: string, heading: string): MdTable | null {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.toLowerCase().includes(heading.toLowerCase()));
  if (start < 0) return null;
  let i = start + 1;
  while (i < lines.length && !lines[i].trim().startsWith("|")) {
    if (/^#{1,6}\s/.test(lines[i])) return null;
    i++;
  }
  const rows: string[][] = [];
  for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    const cells = lines[i]
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  if (rows.length < 2) return null;
  return { head: rows[0], rows: rows.slice(1) };
}

export async function engineReadme(): Promise<string> {
  return (await readText("src/engines/README.md")) ?? "";
}

export interface SqlNote {
  file: string;
  title: string;
  notes: string[];
}

/** The comment lines of each zetaris/*.sql file: what it sets up and the traps it works around. */
export async function zetarisNotes(): Promise<SqlNote[]> {
  const files = (await listDir("zetaris")).filter((f) => f.endsWith(".sql")).sort();
  const out: SqlNote[] = [];
  for (const f of files) {
    const txt = (await readText(`zetaris/${f}`)) ?? "";
    const comments = txt
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("--"))
      .map((l) => l.replace(/^\s*--\s?/, "").trim())
      .filter((l) => l && !/^@/.test(l));
    if (!comments.length) continue;
    // Join wrapped comment lines into sentences; keep list items separate.
    const notes: string[] = [];
    for (const c of comments) {
      if (/^[a-z_<>]+\.[a-z_0-9]+\s*->/.test(c) || /^[-*]/.test(c)) notes.push(c);
      else if (notes.length && !/[.:)]$/.test(notes[notes.length - 1])) notes[notes.length - 1] += " " + c;
      else notes.push(c);
    }
    out.push({ file: f, title: notes[0] ?? f, notes: notes.slice(1) });
  }
  return out;
}

export function isTrap(s: string): boolean {
  return /trap|returned|bad request|invalid|must not|needs a|only the public|instead|works/i.test(s);
}
