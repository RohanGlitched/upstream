// POST {slug, contract, decision, note?} with "Authorization: Bearer <session>" -> {status, memoryId, audit}.
// The approver's name and role come only from the signed session issued by /api/session (the demo sign-in; in a
// hospital, single sign-on). Anything the body says about who is approving is ignored. Without a valid session the
// approval is refused; a buyer's session is refused by Scout, which issues decision.record only to a pharmacist or
// the director. The decision must be one of the case's ranked options (a short note may be attached, stored as
// quoted data). The memo contract must be the one issued for this case and drug, and unexpired.
import { getCase } from "@/src/lib/cases";
import { approveDecision } from "@/src/agent/memo";
import { HMEM, openMemory } from "@/src/engines/hmem";
import { bearer, verifySession } from "@/src/lib/session";

export const runtime = "nodejs";

// On a read-only host the memory lives for this server instance; locally it persists in .state/hmem.
const memory = process.env.VERCEL ? new HMEM({ actor: "upstream-agent" }) : openMemory({ persistDir: ".state/hmem" });

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { slug?: string; contract?: unknown; decision?: string; note?: string };
  const s = verifySession(bearer(req));
  if (!s.ok) {
    return Response.json(
      { status: "refused", error: `Sign in as a Corvale pharmacist or the director to approve (${s.reason}).`, reason: `Sign in as a Corvale pharmacist or the director to approve (${s.reason}).`, audit: [] },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="upstream-approver"' } },
    );
  }
  const slug = b.slug && /^[a-z0-9-]{1,80}$/.test(b.slug) ? b.slug : null;
  const c = slug ? await getCase(slug) : null;
  if (!c || !slug) return Response.json({ error: "No such case." }, { status: 404 });
  try {
    // A refusal is a normal answer (200 with status "refused") so the audit trail of what was checked comes back too.
    return Response.json(await approveDecision(c, slug, b.contract, { id: s.session.sub, name: s.session.name, role: s.session.role }, String(b.decision ?? ""), memory, String(b.note ?? "")));
  } catch (e) {
    return Response.json({ status: "refused", reason: (e as Error).message.slice(0, 200), audit: [] }, { status: 400 });
  }
}
