// POST {slug, contract, approver, decision} -> {status, memoryId, audit}. A named pharmacist's approval is attached
// to a decision.record contract before H-MEM is allowed to store the decision.
import { getCase } from "@/src/lib/cases";
import { approveDecision } from "@/src/agent/memo";
import { HMEM, openMemory } from "@/src/engines/hmem";

export const runtime = "nodejs";

// On a read-only host the memory lives for this server instance; locally it persists in .state/hmem.
const memory = process.env.VERCEL ? new HMEM({ actor: "upstream-agent" }) : openMemory({ persistDir: ".state/hmem" });

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { slug?: string; contract?: unknown; approver?: string; decision?: string };
  const c = b.slug ? await getCase(b.slug) : null;
  if (!c) return Response.json({ error: "No such case." }, { status: 404 });
  const decision = String(b.decision ?? c.options[0]?.title ?? "").slice(0, 240);
  if (!decision) return Response.json({ error: "Say which decision is being approved." }, { status: 400 });
  try {
    return Response.json(await approveDecision(c, b.contract, String(b.approver ?? ""), decision, memory));
  } catch (e) {
    return Response.json({ status: "refused", reason: (e as Error).message.slice(0, 200), audit: [] }, { status: 400 });
  }
}
