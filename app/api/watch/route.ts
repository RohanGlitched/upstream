import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "watch/latest.json"), "utf8");
    return new Response(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
  } catch {
    return Response.json({ error: "not built yet" }, { status: 404 });
  }
}
