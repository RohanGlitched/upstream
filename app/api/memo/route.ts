// POST {slug} -> {draft, contract, contractId, risk, needs} or {refused}. Drafting runs under a memo.draft contract.
import { getCase } from "@/src/lib/cases";
import { draftMemo } from "@/src/agent/memo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { slug } = (await req.json().catch(() => ({}))) as { slug?: string };
  const c = slug ? await getCase(slug) : null;
  if (!c) return Response.json({ error: "No such case." }, { status: 404 });
  try {
    return Response.json(await draftMemo(c));
  } catch (e) {
    return Response.json({ error: `The memo could not be drafted: ${(e as Error).message.slice(0, 200)}` }, { status: 503 });
  }
}
