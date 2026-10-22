import { listCases } from "@/src/lib/cases";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await listCases());
}
