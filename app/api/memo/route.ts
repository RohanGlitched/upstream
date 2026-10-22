// POST {slug} -> {draft, contract, contractId, expiresAt, risk, needs, verifier} or {refused}. Drafting runs under a
// memo.draft contract bound to this case and drug; the model's text is grounded against the case before it is returned.
import { getCase } from "@/src/lib/cases";
import { draftMemo } from "@/src/agent/memo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { slug } = (await req.json().catch(() => ({}))) as { slug?: string };
  const c = slug && /^[a-z0-9-]{1,80}$/.test(slug) ? await getCase(slug) : null;
  if (!c || !slug) return Response.json({ error: "No such case." }, { status: 404 });
  try {
    return Response.json(await draftMemo(c, slug));
  } catch (e) {
    return Response.json({ error: `The memo could not be drafted: ${(e as Error).message.slice(0, 200)}` }, { status: 503 });
  }
}
