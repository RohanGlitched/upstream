// POST {question} -> NDJSON stream: {type:"decision"}, {type:"step"} per step, then {type:"case"} or {type:"refused"}.
// Live when this server can reach Zetaris (UPSTREAM_LIVE=1); otherwise it replays a recorded case for the drug,
// marked "replay", so the hosted demo never pretends a recorded answer is a live one.
import { createUpstreamScout } from "@/src/engines/scout/upstream";
import { caseForMolecule } from "@/src/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const enc = new TextEncoder();

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: string };
  const question = String(body.question ?? "").trim().slice(0, 400);
  if (!question) return Response.json({ error: "Ask about a drug, for example: why is carboplatin short?" }, { status: 400 });

  const live = process.env.UPSTREAM_LIVE === "1";
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        if (live) {
          const { investigate } = await import("@/src/agent/investigate");
          const { openMemory } = await import("@/src/engines/hmem");
          const c = await investigate({ question, memory: openMemory({ persistDir: ".state/hmem" }), onStep: (step) => send({ type: "step", mode: "live", step }) });
          send({ type: "case", mode: "live", case: c });
        } else {
          const scout = createUpstreamScout({ signingSecret: process.env.SCOUT_SIGNING_SECRET ?? "upstream-replay" });
          const d = await scout.decide({ prompt: question, user: { id: "visitor", role: "buyer" }, surface: "chat" });
          send({ type: "decision", intent: d.intent.primary, risk: d.risk.level, reason: d.risk.reason ?? null, clarification: d.clarification?.question ?? null,
            drug: String(d.intent.parameters.drug ?? "") || null, contractId: d.executionContract?.contractId ?? null, scope: d.executionContract?.scope.capabilities ?? [] });
          if (d.risk.level === "block" || !d.executionContract) {
            send({ type: "refused", reason: d.risk.reason ?? d.clarification?.question ?? "Scout issued no contract for this request." });
          } else {
            const drug = String(d.intent.parameters.drug ?? "");
            const c = await caseForMolecule(drug);
            if (!c) {
              send({ type: "unrecorded", drug, reason: `Upstream runs live investigations where its Zetaris instance runs. This hosted copy replays recorded ones; there is no recording for "${drug || question}" yet.` });
            } else {
              for (const step of c.steps) {
                await new Promise((r) => setTimeout(r, Math.min(900, 150 + step.ms / 8)));
                send({ type: "step", mode: "replay", step });
              }
              send({ type: "case", mode: "replay", case: c });
            }
          }
        }
      } catch (e) {
        send({ type: "error", message: (e as Error).message.slice(0, 300) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
