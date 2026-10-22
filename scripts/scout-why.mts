// Print Scout's full decision (intent, risk, flags, contract scope) for a prompt.
import { createUpstreamScout } from "../src/engines/scout/upstream.ts";
const scout = createUpstreamScout({ signingSecret: "debug" });
for (const p of process.argv.slice(2)) {
  const d = await scout.decide({ prompt: p, user: { id: "buyer-1", role: "buyer" }, surface: "desk" });
  console.log(JSON.stringify({ intent: d.intent, risk: d.risk, clarification: d.clarification, error: d.error, scope: d.executionContract?.scope.capabilities }, null, 1).slice(0, 2500));
}
