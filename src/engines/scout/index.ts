// Upstream's implementation of the Meterless Scout Intent spec
// (vendor/meterless/scout-intent/AGENTS.md + docs/*.md). Our own code; the
// upstream repository ships only the spec and an eval harness.
//
//   new Scout({ intentRegistry, policyPack, modelProfiles }).decide({ prompt, user, surface })
//     -> { candidates, risk { level, flags, reason }, toolPlan, clarification, executionContract }
//
// Pipeline per request: Sense -> Interpret -> Guard -> Route -> Recommend.
// This file is also the SCOUT_IMPL the Meterless eval harness loads; with the
// harness's CRM fixture registry it runs with auto-registered placeholder
// tools for declared capabilities, with Upstream's pharmacy registry
// (createUpstreamScout in ./upstream.ts) it runs a strict capability graph.

import { performance } from "node:perf_hooks";
import { CapabilityGraph, ModelRouter, RouteError, permissionsFor, type ToolRegistration } from "./capabilities.ts";
import { CONTRACT_TTL_MS, defaultSecret, signContract, ulid, verifyContract, verifyIntegrity } from "./contract.ts";
import { RateLimiter, injectionLayer, piiLayer, scopeLayer, splitClauses, stripFiller } from "./guard.ts";
import { interpret, type ReferenceResolver } from "./interpret.ts";
import { DEFAULT_DRUGS, Lexicon } from "./lexicon.ts";
import { composePolicy, isDenied, type ComposedPolicy, type PolicyPack } from "./policy.ts";
import { IntentRegistry } from "./registry.ts";
import { Scorer, bandOf, type SenseOptions } from "./scoring.ts";
import { promptHash, telemetry } from "./telemetry.ts";
import type {
  ApprovalRecord,
  ApprovalSpec,
  Band,
  Clarification,
  DecideInput,
  Decision,
  ExecutionContract,
  Intent,
  IntentCandidate,
  IntentRegistryData,
  ModelProfile,
  RiskClass,
  RiskFlag,
  RiskLevel,
  ToolStep,
  UserRef,
} from "./types.ts";

export * from "./types.ts";
export { IntentRegistry } from "./registry.ts";
export { CapabilityGraph, ModelRouter, RouteError } from "./capabilities.ts";
export { verifyContract, assertContract, guardedTool, ContractRefusedError, canonicalJson, ulid, NEVER_CAPABILITIES, CONTRACT_TTL_MS } from "./contract.ts";
export { composePolicy, BUILTIN_PACKS } from "./policy.ts";
export { Lexicon, DEFAULT_DRUGS } from "./lexicon.ts";
export { telemetry } from "./telemetry.ts";

export interface ScoutOptions {
  intentRegistry: string | IntentRegistry | IntentRegistryData;
  policyPack?: string | string[] | PolicyPack[];
  modelProfiles?: string | ModelProfile[];
  signingSecret?: string;
  /** strict capability graph; when omitted, declared capabilities get placeholder tools (autoRegisterDeclared) */
  capabilityGraph?: CapabilityGraph;
  autoRegisterDeclared?: boolean;
  /** role -> permissions; when omitted every user holds "*" */
  rolePermissions?: Record<string, string[]>;
  drugLexicon?: string[];
  referenceResolver?: ReferenceResolver;
  /** optional Stage-2 semantic scorer */
  semantic?: SenseOptions["semantic"];
  clock?: () => number;
  /** run the 16 ms Stage-1 startup self-test (default true) */
  selfTest?: boolean;
  ttlMs?: number;
}

export class ScoutSelfTestError extends Error {}

const LEVELS: Exclude<RiskLevel, "block">[] = ["low", "medium", "high"];
const lift = (l: Exclude<RiskLevel, "block">, n: number) => LEVELS[Math.min(2, LEVELS.indexOf(l) + n)];

interface Issued {
  contract: ExecutionContract;
  primary: Intent;
  secondary: Intent[];
  user: UserRef;
  surface: string;
  dataClass: string;
  parameters: Record<string, unknown>;
  subject?: Record<string, string>;
}

export class Scout {
  readonly registry: IntentRegistry;
  readonly policy: ComposedPolicy;
  readonly capabilities: CapabilityGraph;
  readonly router: ModelRouter;
  readonly lexicon: Lexicon;
  readonly selfTestResult: { probes: number; maxMs: number; medianMs: number } | undefined;
  private readonly scorer: Scorer;
  private readonly secret: string;
  private readonly clock: () => number;
  private readonly ttl: number;
  private readonly limiter = new RateLimiter();
  private readonly sessions = new Map<string, { id: string; at: number }[]>();
  private readonly highRisk = new Map<string, number[]>();
  private readonly issued = new Map<string, Issued>();
  private readonly opts: ScoutOptions;

  constructor(opts: ScoutOptions) {
    this.opts = opts;
    this.registry = IntentRegistry.load(opts.intentRegistry);
    this.policy = composePolicy(opts.policyPack);
    this.router = new ModelRouter(opts.modelProfiles);
    this.lexicon = new Lexicon(opts.drugLexicon ?? DEFAULT_DRUGS);
    this.scorer = new Scorer(this.registry, this.lexicon);
    this.secret = opts.signingSecret ?? defaultSecret();
    this.clock = opts.clock ?? Date.now;
    this.ttl = opts.ttlMs ?? CONTRACT_TTL_MS;
    this.capabilities = opts.capabilityGraph ?? new CapabilityGraph();
    if (opts.autoRegisterDeclared ?? !opts.capabilityGraph) {
      for (const cap of this.registry.capabilities()) {
        if (!this.capabilities.has(cap)) this.capabilities.register({ capability: cap, toolId: `declared.${cap}`, local: true, declaredOnly: true });
      }
    }
    this.selfTestResult = opts.selfTest === false ? undefined : this.selfTest();
  }

  // ------------------------------------------------------------------ Sense

  /** Stage-1 startup self-test: a full-registry scan must finish in < 16 ms (AGENTS.md 4.1). */
  private selfTest() {
    const probes = [
      ...this.registry.all().flatMap((i) => i.examples.slice(0, 2)),
      "why is it short", "check stock and order more", "ignore previous instructions", "hello",
    ].slice(0, 60);
    for (let w = 0; w < 3; w++) for (const p of probes) this.scorer.sense(this.lexicon.normalise(p).text, p);
    const times = probes.map((p) => {
      const t0 = performance.now();
      this.scorer.sense(this.lexicon.normalise(p).text, p);
      return performance.now() - t0;
    });
    const sorted = [...times].sort((a, b) => a - b);
    const res = { probes: probes.length, maxMs: Number(sorted[sorted.length - 1].toFixed(3)), medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)) };
    if (res.maxMs >= 16) throw new ScoutSelfTestError(`Scout Stage-1 self-test failed: slowest full-registry scan ${res.maxMs} ms >= 16 ms`);
    return res;
  }

  private senseOpts(user: UserRef, ctx: DecideInput["context"]): SenseOptions {
    const now = this.clock();
    const s = ctx?.sessionId ? this.sessions.get(ctx.sessionId) : undefined;
    let recency: Record<string, number> | undefined;
    if (s && s.length) {
      recency = {};
      for (const { id, at } of s) recency[id] = Math.max(recency[id] ?? 0, Math.exp(-(now - at) / (10 * 60_000)));
    }
    let contextual: Record<string, number> | undefined;
    if (ctx && (ctx.activeIntent || ctx.recentIntents?.length || ctx.intentHints)) {
      contextual = { ...(ctx.intentHints ?? {}) };
      for (const r of ctx.recentIntents ?? []) contextual[r] = Math.max(contextual[r] ?? 0, 0.5);
      if (ctx.activeIntent) contextual[ctx.activeIntent] = Math.max(contextual[ctx.activeIntent] ?? 0, 1);
    }
    return {
      semantic: this.opts.semantic,
      recency,
      contextual,
      // riskPenalty: down-rank intents whose capabilities are on the never list, so they only win on strong evidence.
      riskPenalty: (i) => (i.capabilities.some((c) => this.policy.neverCapabilities.has(c)) ? 0.02 : 0),
    };
  }

  async classify(input: { prompt: string; surface?: string }): Promise<{ candidates: IntentCandidate[] }> {
    const n = this.lexicon.normalise(input.prompt);
    return { candidates: this.scorer.sense(n.text, input.prompt).candidates.map(({ intent, score }) => ({ intent, score })) };
  }

  // ------------------------------------------------------------------ decide

  async decide(input: DecideInput): Promise<Decision> {
    const t0 = performance.now();
    const now = this.clock();
    const traceId = ulid(now);
    const user: UserRef = { ...(input.user ?? {}) };
    const role = user.role ?? "anonymous";
    const surface = input.surface ?? "chat";

    // Guard layer 4 first: PII is redacted before any later stage sees the prompt.
    const pii = piiLayer(this.policy, input.prompt);
    const prompt = pii.redacted;

    // ---- Sense
    const norm = this.lexicon.normalise(prompt);
    const sOpts = this.senseOpts(user, input.context);
    const sense = this.scorer.sense(norm.text, prompt, sOpts);
    const senseMs = performance.now() - t0;
    const cands = sense.candidates;
    const top = cands[0];
    const band: Band = bandOf(top.score);

    // Clause-level scan for multi-intent plans and for deny checks on every clause.
    const clauses = splitClauses(prompt).map((text) => {
      const n = this.lexicon.normalise(text);
      const s = this.scorer.sense(n.text, text, sOpts).candidates;
      return { text, top: s[0], second: s[1], all: s };
    });

    const general = this.registry.get("GENERAL");
    let primary: Intent = band === "reject" && general ? general : this.registry.get(top.intent)!;

    // Multi-intent: High-band primary plus another clause whose top intent differs and is >= 0.55, on disjoint spans.
    let plan: Decision["plan"];
    const clauseTops = clauses.filter((c) => c.top && c.top.intent !== "GENERAL");
    const distinct = [...new Map(clauseTops.map((c) => [c.top.intent, c])).values()];
    if (clauses.length > 1 && distinct.length > 1) {
      const sorted = [...distinct].sort((a, b) => b.top.score - a.top.score);
      if (sorted[0].top.score >= 0.8 && sorted[1].top.score >= 0.55) {
        plan = sorted.filter((c, i) => i === 0 || c.top.score >= 0.55).map((c) => ({ intent: c.top.intent, score: c.top.score, span: c.text }));
        if (band !== "reject" || !general) primary = this.registry.get(plan[0].intent)!;
      }
    }
    const secondary = (plan ?? []).slice(1).map((p) => this.registry.get(p.intent)!).filter((i) => i.id !== primary.id);
    const involved = [primary, ...secondary];

    // ---- Interpret
    const interp = interpret(primary, norm, prompt, { activeDrug: input.context?.activeDrug, resolver: this.opts.referenceResolver });

    // ---- Guard
    const flags: RiskFlag[] = [...pii.flags];
    let blockReason: string | undefined;
    let blockedIntent: Intent | undefined;
    const block = (f: RiskFlag, reason: string, intent?: Intent) => {
      if (!flags.some((x) => x.layer === f.layer && x.kind === f.kind)) flags.push(f);
      if (!blockReason) {
        blockReason = reason;
        blockedIntent = intent;
      }
    };

    // 1. injection
    for (const f of injectionLayer(this.policy, input.prompt, this.capabilities.toolIds())) block(f, `Possible prompt injection (${f.kind}); nothing was run.`);

    // 2. policy gate: deny patterns on imperative clauses, denied intents near the top, RBAC, surfaces, bounds, never-list.
    for (const c of clauses) {
      const stripped = stripFiller(c.text);
      for (const dp of this.policy.denyPatterns) {
        if (dp.pattern.test(stripped)) {
          const di = this.registry.get(dp.intent);
          block({ layer: "policy", kind: `deny:${dp.intent}`, verdict: "block", evidence: "imperative clause" }, di?.blockReason ?? `${dp.intent} is not allowed`, di);
        }
      }
    }
    // Denied intents that win the whole prompt (>= 0.40, or within denyMargin of the top) or win a clause in the Medium band or above.
    const nearTop = (list: { intent: string; score: number }[], floor: number, margin: number) => {
      const best = list[0]?.score ?? 0;
      return list.filter((c) => c.score >= floor && c.score >= best - margin);
    };
    const deniedChecks = [nearTop(cands, 0.4, this.policy.denyMargin), ...(clauses.length > 1 ? clauses.map((c) => nearTop(c.all, 0.55, 0)) : [])];
    for (const list of deniedChecks) {
      for (const c of list) {
        const intent = this.registry.get(c.intent);
        if (intent && isDenied(this.policy, intent)) {
          block({ layer: "policy", kind: `deny:${intent.id}`, verdict: "block", evidence: `score ${c.score}` }, intent.blockReason ?? `${intent.id} is outside this system's scope`, intent);
        }
      }
    }
    for (const i of involved) {
      if (isDenied(this.policy, i)) block({ layer: "policy", kind: `deny:${i.id}`, verdict: "block" }, i.blockReason ?? `${i.id} is outside this system's scope`, i);
      if (!(i.roles.includes("*") || i.roles.includes(role))) {
        block({ layer: "policy", kind: "role-denied", verdict: "block", evidence: `role ${role}` }, `Your role (${role}) cannot ${i.description.charAt(0).toLowerCase()}${i.description.slice(1).replace(/\.$/, "")}. Allowed roles: ${i.roles.join(", ")}.`, i);
      }
      if (!i.surfaces.includes(surface)) block({ layer: "scope", kind: "surface-denied", verdict: "block", evidence: `surface ${surface}` }, `${i.id} is not available on the ${surface} surface.`, i);
    }
    for (const v of interp.violations) block({ layer: "policy", kind: "parameter-bounds", verdict: "block", evidence: v }, `Parameter out of bounds: ${v}.`);

    // 3. scope warnings (lift one band each)
    const recentHigh = (this.highRisk.get(user.id ?? "anonymous") ?? []).filter((t) => now - t < 10 * 60_000).length;
    flags.push(...scopeLayer(this.policy, prompt, recentHigh));

    // 5. rate limit (per user, per intent)
    if (!blockReason) {
      const high = involved.some((i) => i.riskClass === "high");
      const ok = this.limiter.take(`${user.id ?? "anonymous"}|${primary.id}`, high ? this.policy.rateLimit.highRiskPerMinute : this.policy.rateLimit.perMinute, now);
      if (!ok) block({ layer: "rate-limit", kind: "rate-limit", verdict: "block" }, `Too many ${primary.id} requests; try again in a minute.`);
    }

    // reduce
    const floor: RiskClass = involved.reduce<RiskClass>((m, i) => (LEVELS.indexOf(i.riskClass) > LEVELS.indexOf(m) ? i.riskClass : m), "low");
    const warns = flags.filter((f) => f.verdict === "warn").length;
    const level: RiskLevel = blockReason ? "block" : lift(floor, warns);
    const scopeCaps = [...new Set(involved.flatMap((i) => i.capabilities))];
    const approvalsRequired = level === "block" ? [] : this.approvalsFor(involved, level, scopeCaps);

    const candidatesOut: IntentCandidate[] = cands.slice(0, 5).map((c) => {
      const p = plan?.find((x) => x.intent === c.intent);
      return p ? { intent: c.intent, score: c.score, span: p.span } : { intent: c.intent, score: c.score };
    });

    const base = {
      traceId,
      candidates: candidatesOut,
      intent: { primary: blockedIntent?.id ?? primary.id, confidence: top.score, band, parameters: interp.parameters, references: interp.references },
      plan,
      stage2: sense.stage2,
    };

    if (level === "block") {
      const decision: Decision = {
        ...base,
        risk: { level, flags, redactions: pii.redactions, reason: blockReason },
        toolPlan: [],
        latencyMs: { sense: senseMs, total: performance.now() - t0 },
      };
      this.log(decision, prompt);
      return decision;
    }

    // ---- clarification (AGENTS.md 4.6)
    const optionsFrom = (list: { intent: string }[]) =>
      list
        .map((c) => this.registry.get(c.intent)!)
        .filter((i) => i && i.id !== "GENERAL" && !isDenied(this.policy, i))
        .slice(0, 3)
        .map((i) => ({ label: i.description.split(/[.:]/)[0], intent: i.id }));
    let clarification: Clarification | undefined;
    // Denied intents are never offered as options, so they do not create a tie either.
    const second = cands.find((c) => c.intent !== top.intent && !isDenied(this.policy, this.registry.get(c.intent)!));
    const vague = isVague(prompt);
    const unresolved = hasUnresolvedReference(prompt) && !input.context?.activeIntent && !input.context?.activeDrug;
    if (primary.id === "GENERAL") {
      const opts = optionsFrom(cands.filter((c) => c.score > 0));
      clarification = { trigger: band === "low" ? "low-band" : "reject", question: "I can't tell what you want me to do. Did you mean one of these?", options: opts.length ? opts : optionsFrom(["shortage.investigate", "stock.days_on_hand", "memory.recall_decisions"].map((intent) => ({ intent }))) };
    } else if (unresolved) {
      clarification = { trigger: "params", question: "I can't tell which earlier request or item you mean. Which one?", options: optionsFrom(cands), missing: ["reference"] };
    } else if (!plan && (band === "low" || vague)) {
      clarification = { trigger: "low-band", question: "Which of these did you mean?", options: optionsFrom(cands) };
    } else if (!plan && band === "medium" && second && top.score - second.score < 0.05) {
      clarification = { trigger: "tie", question: "Did you mean one of these?", options: optionsFrom([top, second]) };
    } else if (interp.missing.length) {
      clarification = { trigger: "params", question: `Which ${interp.missing.join(" and ")} do you mean?`, options: [{ label: primary.description.split(/[.:]/)[0], intent: primary.id }], missing: interp.missing };
    } else if (involved.some((i) => i.riskClass === "high") && top.score < 0.95) {
      clarification = { trigger: "high-risk", question: `This is a high-risk request (${involved.find((i) => i.riskClass === "high")!.id}). Confirm that is what you want before anything is drafted.`, options: [{ label: primary.description.split(/[.:]/)[0], intent: primary.id }] };
    }

    // ---- Route
    const permissions = permissionsFor(user, this.opts.rolePermissions);
    let toolPlan: ToolStep[] = [];
    let error: Decision["error"];
    try {
      toolPlan = this.capabilities.plan(scopeCaps, { permissions, surface }, interp.parameters);
    } catch (e) {
      if (!(e instanceof RouteError)) throw e;
      error = { kind: e.kind, capability: e.capability, message: e.message };
      clarification ??= { trigger: "route", question: `I can't do that right now: ${e.message}.`, options: [] };
    }

    // ---- Recommend
    const modelProfile = this.router.route({ risk: level, dataClass: pii.dataClass });
    const decision: Decision = {
      ...base,
      risk: { level, flags, redactions: pii.redactions, approvalsRequired },
      toolPlan,
      clarification,
      modelProfile,
      error,
      latencyMs: { sense: senseMs, total: 0 },
    };
    // A contract is issued only when the decision can act: no clarification pending, routing succeeded.
    if (!clarification && !error) {
      decision.executionContract = this.issue({
        traceId,
        primary,
        secondary,
        confidence: top.score,
        alternates: cands.filter((c) => c.intent !== primary.id).slice(0, 3).map(({ intent, score }) => ({ intent, score })),
        parameters: interp.parameters,
        references: interp.references,
        level,
        flags,
        redactions: pii.redactions,
        approvals: [],
        approvalsRequired,
        toolPlan,
        modelProfile,
        user,
        surface,
        scope: scopeCaps,
        dataClass: pii.dataClass,
        spans: plan,
        subject: input.subject,
      });
    }
    decision.latencyMs.total = performance.now() - t0;
    this.remember(user, input.context?.sessionId, primary, level, now);
    this.log(decision, prompt);
    return decision;
  }

  private approvalsFor(involved: Intent[], level: Exclude<RiskLevel, "block">, scopeCaps: string[]): ApprovalSpec[] {
    const out: ApprovalSpec[] = [];
    for (const r of this.policy.approvalRules) {
      const matches = involved.some((i) => (r.intents ? r.intents.includes(i.id) : true) && (r.riskClass ? i.riskClass === r.riskClass || (r.riskClass === "high" && level === "high") : true));
      if (!matches) continue;
      if (r.spec.capabilities && r.spec.capabilities.length && !r.spec.capabilities.some((c) => scopeCaps.includes(c))) continue;
      if (!out.some((o) => o.kind === r.spec.kind && JSON.stringify(o.capabilities) === JSON.stringify(r.spec.capabilities))) out.push({ ...r.spec });
    }
    // Spec reduction rule: high-risk intent + medium/high level -> approvals required, even with no pack rule.
    if (involved.some((i) => i.riskClass === "high") && !out.some((o) => o.kind === "user-confirm")) out.push({ kind: "user-confirm", reason: "high-risk intent" });
    return out;
  }

  private issue(a: {
    traceId: string;
    parentId?: string;
    primary: Intent;
    secondary: Intent[];
    confidence: number;
    alternates: IntentCandidate[];
    parameters: Record<string, unknown>;
    references: ExecutionContract["intent"]["references"];
    level: Exclude<RiskLevel, "block">;
    flags: RiskFlag[];
    redactions: ExecutionContract["risk"]["redactions"];
    approvals: ApprovalRecord[];
    approvalsRequired: ApprovalSpec[];
    toolPlan: ToolStep[];
    modelProfile: ExecutionContract["modelProfile"];
    user: UserRef;
    surface: string;
    scope: string[];
    dataClass: string;
    spans?: Decision["plan"];
    subject?: Record<string, string>;
  }): ExecutionContract {
    const issuedAt = this.clock();
    const contract = signContract(
      {
        contractId: ulid(issuedAt),
        parentId: a.parentId,
        traceId: a.traceId,
        intent: {
          primary: { id: a.primary.id, version: a.primary.version },
          parameters: a.parameters,
          references: a.references,
          confidence: a.confidence,
          alternates: a.alternates,
          secondary: a.secondary.length ? a.secondary.map((i) => ({ id: i.id, version: i.version, span: a.spans?.find((p) => p.intent === i.id)?.span })) : undefined,
        },
        risk: { level: a.level, flags: a.flags, redactions: a.redactions, approvals: a.approvals, approvalsRequired: a.approvalsRequired },
        toolPlan: a.toolPlan,
        modelProfile: a.modelProfile,
        scope: { user: { id: a.user.id, role: a.user.role }, surface: a.surface, capabilities: a.scope, subject: a.subject && Object.keys(a.subject).length ? { ...a.subject } : undefined },
        issuedAt: new Date(issuedAt).toISOString(),
        expiresAt: new Date(issuedAt + this.ttl).toISOString(),
        registryVersion: this.registry.version,
        policyPackVersion: this.policy.version,
        signedBy: "scout",
      },
      this.secret,
    );
    this.issued.set(contract.contractId, { contract, primary: a.primary, secondary: a.secondary, user: a.user, surface: a.surface, dataClass: a.dataClass, parameters: a.parameters, subject: a.subject });
    if (this.issued.size > 1000) this.issued.delete(this.issued.keys().next().value as string);
    telemetry.emit("contract.issued", { contractId: contract.contractId, parentId: a.parentId, traceId: a.traceId, intent: a.primary.id, risk: a.level, profile: a.modelProfile.id, capabilities: a.scope });
    return contract;
  }

  // ------------------------------------------------------------------ lineage

  /** Executor-side check bound to this Scout's secret. */
  verifyContract(contract: unknown, capability: string, engine?: string) {
    return verifyContract(contract, capability, { secret: this.secret, now: this.clock(), engine, never: [...this.policy.neverCapabilities] });
  }

  /**
   * Re-planning (AGENTS.md 8.3): a downstream engine could not fulfil a step.
   * Same trace id, parent link, re-routed without the unavailable tools or
   * capabilities in state.unavailable.
   */
  async replan(input: { parent: string; reason: string; state?: { unavailable?: string[] } }): Promise<Decision> {
    const rec = this.issued.get(input.parent);
    if (!rec) throw new Error(`Scout.replan: unknown parent contract ${input.parent}`);
    const t0 = performance.now();
    const p = rec.contract;
    const unavailable = new Set(input.state?.unavailable ?? []);
    const permissions = permissionsFor(rec.user, this.opts.rolePermissions);
    const base = {
      traceId: p.traceId,
      candidates: [{ intent: p.intent.primary.id, score: p.intent.confidence }],
      intent: { primary: p.intent.primary.id, confidence: p.intent.confidence, band: bandOf(p.intent.confidence), parameters: p.intent.parameters, references: p.intent.references },
      stage2: "skipped" as const,
    };
    try {
      const toolPlan = this.capabilities.plan(p.scope.capabilities, { permissions, surface: rec.surface, unavailable }, p.intent.parameters);
      const contract = this.issue({
        traceId: p.traceId,
        parentId: p.contractId,
        primary: rec.primary,
        secondary: rec.secondary,
        confidence: p.intent.confidence,
        alternates: p.intent.alternates,
        parameters: p.intent.parameters,
        references: p.intent.references,
        level: p.risk.level,
        flags: [...p.risk.flags, { layer: "route", kind: "replan", verdict: "warn", evidence: input.reason }],
        redactions: p.risk.redactions,
        approvals: p.risk.approvals,
        approvalsRequired: p.risk.approvalsRequired,
        toolPlan,
        modelProfile: p.modelProfile,
        user: rec.user,
        surface: rec.surface,
        scope: p.scope.capabilities,
        dataClass: rec.dataClass,
        subject: rec.subject,
      });
      return { ...base, risk: { level: p.risk.level, flags: contract.risk.flags, redactions: p.risk.redactions, approvalsRequired: p.risk.approvalsRequired }, toolPlan, executionContract: contract, modelProfile: p.modelProfile, latencyMs: { sense: 0, total: performance.now() - t0 } };
    } catch (e) {
      if (!(e instanceof RouteError)) throw e;
      return {
        ...base,
        risk: { level: p.risk.level, flags: p.risk.flags, redactions: p.risk.redactions },
        toolPlan: [],
        error: { kind: e.kind, capability: e.capability, message: e.message },
        clarification: { trigger: "route", question: `Re-planning failed: ${e.message}.`, options: [] },
        latencyMs: { sense: 0, total: performance.now() - t0 },
      };
    }
  }

  /**
   * Fresh contract for the next chunk/phase of long work (TTL is never
   * extended; a new contract is issued with the old one as parent). Refuses
   * a parent that is already invalid or expired.
   */
  refresh(contract: ExecutionContract, reason = "chunk-refresh"): ExecutionContract {
    const v = verifyIntegrity(contract, { secret: this.secret, now: this.clock() });
    if (!v.ok) throw new Error(`Scout.refresh: parent contract invalid (${v.reason})`);
    const rec = this.issued.get(contract.contractId);
    if (!rec) throw new Error(`Scout.refresh: unknown parent contract ${contract.contractId}`);
    return this.issue({
      traceId: contract.traceId,
      parentId: contract.contractId,
      primary: rec.primary,
      secondary: rec.secondary,
      confidence: contract.intent.confidence,
      alternates: contract.intent.alternates,
      parameters: contract.intent.parameters,
      references: contract.intent.references,
      level: contract.risk.level,
      flags: contract.risk.flags,
      redactions: contract.risk.redactions,
      approvals: contract.risk.approvals,
      approvalsRequired: contract.risk.approvalsRequired,
      toolPlan: contract.toolPlan,
      modelProfile: { ...contract.modelProfile, reason: `${contract.modelProfile.reason}; ${reason}` },
      user: rec.user,
      surface: rec.surface,
      scope: contract.scope.capabilities,
      dataClass: rec.dataClass,
      subject: rec.subject,
    });
  }

  /**
   * Attach a human approval. Contracts are immutable, so this re-issues a
   * new signed contract (parentId = the original, same trace) carrying the
   * approval record. The record must name a person and match a required spec.
   */
  approve(contract: ExecutionContract, record: Omit<ApprovalRecord, "at"> & { at?: string }): ExecutionContract {
    const v = verifyIntegrity(contract, { secret: this.secret, now: this.clock() });
    if (!v.ok) throw new Error(`Scout.approve: contract invalid (${v.reason})`);
    if (!record.by || !record.by.trim()) throw new Error("Scout.approve: an approval must name the approver");
    const spec = contract.risk.approvalsRequired.find((s) => s.kind === record.kind && (!s.roles?.length || (record.role && s.roles.includes(record.role))));
    if (!spec) throw new Error(`Scout.approve: no required ${record.kind} approval${record.role ? ` for role ${record.role}` : ""} on this contract`);
    const rec = this.issued.get(contract.contractId);
    if (!rec) throw new Error(`Scout.approve: unknown contract ${contract.contractId}`);
    const full: ApprovalRecord = {
      ...record,
      by: record.by.trim(),
      at: record.at ?? new Date(this.clock()).toISOString(),
      ...(record.kind === "user-confirm" ? { confirmation: "yes" as const } : { decision: "approve" as const }),
    };
    return this.issue({
      traceId: contract.traceId,
      parentId: contract.contractId,
      primary: rec.primary,
      secondary: rec.secondary,
      confidence: contract.intent.confidence,
      alternates: contract.intent.alternates,
      parameters: contract.intent.parameters,
      references: contract.intent.references,
      level: contract.risk.level,
      flags: contract.risk.flags,
      redactions: contract.risk.redactions,
      approvals: [...contract.risk.approvals, full],
      approvalsRequired: contract.risk.approvalsRequired,
      toolPlan: contract.toolPlan,
      modelProfile: contract.modelProfile,
      user: rec.user,
      surface: rec.surface,
      scope: contract.scope.capabilities,
      dataClass: rec.dataClass,
      subject: rec.subject,
    });
  }

  /** Record a user override ("No, I meant ...") for the override_frequency metric. */
  override(traceId: string, from: string, to: string): void {
    telemetry.emit("scout.override", { traceId, from, to });
  }

  // ------------------------------------------------------------------ session + telemetry

  private remember(user: UserRef, sessionId: string | undefined, intent: Intent, level: RiskLevel, now: number): void {
    if (sessionId) this.sessions.set(sessionId, [...(this.sessions.get(sessionId) ?? []).filter((x) => now - x.at < 30 * 60_000), { id: intent.id, at: now }].slice(-20));
    if (level === "high") {
      const key = user.id ?? "anonymous";
      this.highRisk.set(key, [...(this.highRisk.get(key) ?? []).filter((t) => now - t < 10 * 60_000), now]);
    }
  }

  private log(d: Decision, prompt: string): void {
    telemetry.emit("scout.decision", { traceId: d.traceId, intent: d.intent.primary, band: d.intent.band, risk: d.risk.level, latencyMs: Number(d.latencyMs.total.toFixed(2)), stage2: d.stage2, promptHash: promptHash(prompt) });
    if (d.clarification) telemetry.emit("scout.clarification", { traceId: d.traceId, trigger: d.clarification.trigger });
  }
}

export type { ToolRegistration };

const VAGUE_VERBS = /^(?:please\s+)?(handle|fix|sort out|sort|deal with|take care of|manage|resolve|do|help with)\b/i;

/** A bare vague command ("handle the shortage", "fix it", "do the thing") with almost no other content: clarify instead of guessing. */
export function isVague(prompt: string): boolean {
  const p = prompt.trim();
  if (!VAGUE_VERBS.test(p)) return false;
  const rest = p.replace(VAGUE_VERBS, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !/^(the|it|this|that|thing|things|stuff|situation|issue|problem|one|a|an|for|me|us|now|please|usual|from|yesterday|today|again)$/.test(w));
  return rest.length <= 1;
}


const UNRESOLVED_REF = /\b(the thing|that thing|the stuff|what we (talked|discussed|spoke) about|we (talked|discussed|spoke) about|the usual|like last time|same as (before|last time)|you know (what|which))\b/i;

/** Deictic references to earlier context that nothing in the prompt or context binds (clarification rule 3). */
export function hasUnresolvedReference(prompt: string): boolean {
  return UNRESOLVED_REF.test(prompt);
}
