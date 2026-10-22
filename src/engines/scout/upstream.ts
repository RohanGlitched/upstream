// Upstream's Scout configuration: pharmacy registry, policy packs, model
// profiles and a STRICT capability graph (no placeholder tools: a capability
// without a registered tool fails routing instead of being invented).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { CapabilityGraph } from "./capabilities.ts";
import { DEFAULT_DRUGS } from "./lexicon.ts";
import { Scout, type ScoutOptions } from "./index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PHARMACY_REGISTRY = path.join(here, "registry", "pharmacy-intents.json");
export const MODEL_PROFILES = path.join(here, "registry", "model-profiles.json");
export const UPSTREAM_POLICY = ["default", "adversarial-tight", "upstream-pharmacy"];

/** Capability map. Never registered (so never routable): order.place, inventory.write, email.send, formulary.write, clinical.advise. */
export const UPSTREAM_TOOLS = [
  { capability: "zetaris.read", toolId: "zetaris.federated-sql", local: false, requiredPermissions: ["data:read"], latency: { p95Ms: 1500 } },
  { capability: "world.read", toolId: "meterless.world-model.graph", local: true },
  { capability: "world.write", toolId: "meterless.world-model.write", local: true },
  { capability: "hmem.read", toolId: "meterless.hmem.retrieve", local: true },
  { capability: "hmem.write", toolId: "meterless.hmem.add", local: true, requiredPermissions: ["memory:write"] },
  { capability: "markovian.chain", toolId: "meterless.markovian.run", local: true },
  { capability: "memo.draft", toolId: "upstream.memo.draft", local: true },
  { capability: "transfer.draft", toolId: "upstream.transfer.draft", local: true },
] as const;

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  viewer: ["data:read"],
  technician: ["data:read"],
  buyer: ["data:read"],
  pharmacist: ["data:read", "memory:write"],
  director: ["data:read", "memory:write"],
};

export function upstreamCapabilityGraph(): CapabilityGraph {
  const g = new CapabilityGraph();
  for (const t of UPSTREAM_TOOLS) g.register({ ...t, requiredPermissions: "requiredPermissions" in t ? [...t.requiredPermissions] : [] });
  return g;
}

export function createUpstreamScout(opts: Partial<ScoutOptions> & { formulary?: string[] } = {}): Scout {
  return new Scout({
    intentRegistry: PHARMACY_REGISTRY,
    policyPack: UPSTREAM_POLICY,
    modelProfiles: MODEL_PROFILES,
    capabilityGraph: upstreamCapabilityGraph(),
    autoRegisterDeclared: false,
    rolePermissions: ROLE_PERMISSIONS,
    drugLexicon: [...DEFAULT_DRUGS, ...(opts.formulary ?? [])],
    ...opts,
  });
}
