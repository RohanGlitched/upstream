// CapabilityGraphService (AGENTS.md section 7, docs/capability-graph.md) and
// ModelRouterService (section 8.1, docs/model-routing.md).

import fs from "node:fs";
import type { ModelProfile, ModelProfileRef, RiskLevel, ToolStep, UserRef } from "./types.ts";

export interface ToolRegistration {
  capability: string;
  toolId: string;
  availability?: () => boolean;
  requiredPermissions?: string[];
  cost?: { perCall: number };
  latency?: { p95Ms: number };
  local?: boolean;
  surfaces?: string[];
  /** capabilities this tool itself needs (the graph walks them transitively) */
  needs?: string[];
  invoke?: (input: unknown) => unknown;
  /** placeholder registered only from a registry declaration (no real tool behind it) */
  declaredOnly?: boolean;
}

export class RouteError extends Error {
  constructor(readonly kind: "unresolvable-capability" | "permission" | "unavailable", readonly capability: string, message: string) {
    super(message);
    this.name = "RouteError";
  }
}

export class CapabilityGraph {
  private readonly tools = new Map<string, ToolRegistration[]>();

  register(t: ToolRegistration): void {
    const list = this.tools.get(t.capability) ?? [];
    if (list.some((x) => x.toolId === t.toolId)) throw new Error(`capability graph: ${t.toolId} already registered for ${t.capability}`);
    list.push(t);
    this.tools.set(t.capability, list);
  }

  has(capability: string): boolean {
    return (this.tools.get(capability)?.length ?? 0) > 0;
  }

  toolsFor(capability: string): readonly ToolRegistration[] {
    return this.tools.get(capability) ?? [];
  }

  toolIds(): Set<string> {
    return new Set([...this.tools.values()].flat().map((t) => t.toolId));
  }

  /** Pick one tool per capability by the five selection rules. Throws RouteError when nothing resolves. */
  resolve(capability: string, ctx: { permissions: Set<string>; surface: string; unavailable?: Set<string> }): ToolRegistration {
    const all = this.tools.get(capability) ?? [];
    if (!all.length) throw new RouteError("unresolvable-capability", capability, `no tool registered for ${capability}`);
    const permitted = all.filter((t) => (t.requiredPermissions ?? []).every((p) => ctx.permissions.has(p) || ctx.permissions.has("*")));
    if (!permitted.length) throw new RouteError("permission", capability, `user lacks permissions for every ${capability} tool`);
    const available = permitted.filter((t) => !ctx.unavailable?.has(t.toolId) && !ctx.unavailable?.has(capability) && (t.availability?.() ?? true));
    if (!available.length) throw new RouteError("unavailable", capability, `every ${capability} tool is offline`);
    const ranked = [...available].sort(
      (a, b) =>
        Number(!!b.surfaces?.includes(ctx.surface)) - Number(!!a.surfaces?.includes(ctx.surface)) ||
        (a.cost?.perCall ?? 0) - (b.cost?.perCall ?? 0) ||
        (a.latency?.p95Ms ?? 0) - (b.latency?.p95Ms ?? 0) ||
        Number(!!b.local) - Number(!!a.local) ||
        a.toolId.localeCompare(b.toolId),
    );
    return ranked[0];
  }

  /** Ordered tool plan for a capability list, walking tool dependencies transitively (deduplicated). */
  plan(capabilities: string[], ctx: { permissions: Set<string>; surface: string; unavailable?: Set<string> }, input: Record<string, unknown>): ToolStep[] {
    const steps: ToolStep[] = [];
    const seen = new Set<string>();
    const visit = (cap: string, depth: number) => {
      if (seen.has(cap) || depth > 8) return;
      seen.add(cap);
      const t = this.resolve(cap, ctx);
      for (const dep of t.needs ?? []) visit(dep, depth + 1);
      steps.push({ tool: t.toolId, capability: cap, input, local: !!t.local, bound: !t.declaredOnly });
    };
    for (const c of capabilities) visit(c, 0);
    return steps;
  }
}

// ------------------------------------------------------------------ model routing

export class ModelRouter {
  readonly profiles: ModelProfile[];

  constructor(src?: string | ModelProfile[]) {
    if (!src) this.profiles = [RULES_ONLY];
    else if (typeof src === "string") this.profiles = (JSON.parse(fs.readFileSync(src, "utf-8")) as { profiles: ModelProfile[] }).profiles;
    else this.profiles = src;
    if (!this.profiles.some((p) => p.id === RULES_ONLY.id)) this.profiles.push(RULES_ONLY);
  }

  private available(p: ModelProfile): boolean {
    return !p.requiresEnv || !!process.env[p.requiresEnv];
  }

  /**
   * Rules (docs/model-routing.md): data class clearance is mandatory; then
   * high/medium risk prefers "capable", low prefers "fast"; local wins ties and
   * wins outright for confidential/restricted data; unavailable profiles drop
   * out; the deterministic rules-only profile is the last resort.
   */
  route(args: { risk: Exclude<RiskLevel, "block">; dataClass: string; needs?: string[] }): ModelProfileRef {
    const want = args.risk === "low" ? "fast" : "capable";
    const sensitive = args.dataClass === "confidential" || args.dataClass === "restricted";
    const cleared = this.profiles.filter((p) => p.dataClasses.includes(args.dataClass) && (args.needs ?? []).every((n) => p.capabilities.includes(n)));
    const usable = cleared.filter((p) => this.available(p) && p.id !== RULES_ONLY.id);
    const ranked = [...usable].sort(
      (a, b) =>
        (sensitive ? Number(b.local) - Number(a.local) : 0) ||
        Number(b.quality === want) - Number(a.quality === want) ||
        Number(b.local) - Number(a.local) ||
        (a.cost?.in ?? 0) - (b.cost?.in ?? 0),
    );
    const pick = ranked[0] ?? this.profiles.find((p) => p.id === RULES_ONLY.id)!;
    const reason = ranked[0]
      ? `${want} profile cleared for ${args.dataClass}${sensitive ? " (local preferred)" : ""}`
      : `no available model profile cleared for ${args.dataClass}; deterministic rules only`;
    return { id: pick.id, provider: pick.provider, model: pick.model, local: pick.local, dataClass: args.dataClass, reason };
  }
}

export const RULES_ONLY: ModelProfile = {
  id: "rules-only",
  provider: "none",
  model: "deterministic",
  local: true,
  capabilities: ["text"],
  dataClasses: ["public", "internal", "confidential", "restricted"],
  quality: "fast",
  cost: { in: 0, out: 0 },
};

export function permissionsFor(user: UserRef | undefined, rolePermissions: Record<string, string[]> | undefined): Set<string> {
  const s = new Set<string>(user?.permissions ?? []);
  if (!rolePermissions) {
    s.add("*");
    return s;
  }
  for (const p of rolePermissions[user?.role ?? ""] ?? []) s.add(p);
  for (const p of rolePermissions["*"] ?? []) s.add(p);
  return s;
}
