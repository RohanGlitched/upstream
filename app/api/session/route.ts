// POST {staffId, pin} -> {token, name, role, canApprove, expiresAt}. The demo sign-in for the memo's approver: in a
// hospital this would come from single sign-on; here the demo PIN is printed on the page next to each name.
import { signIn, clientIp } from "@/src/lib/session";
import { canApprove } from "@/src/agent/staff";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { staffId?: string; pin?: string };
  const r = signIn(String(b.staffId ?? ""), String(b.pin ?? ""), clientIp(req));
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.status });
  return Response.json(
    { token: r.token, name: r.session.name, role: r.session.role, canApprove: canApprove(r.session.role), expiresAt: new Date(r.session.exp).toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
