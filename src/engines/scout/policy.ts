// Policy packs (docs/risk-and-policy.md "Policy packs"). A pack is a named,
// versioned bundle of injection patterns, deny rules, approval rules, scope
// warnings, PII handling and rate limits. Packs compose; the composed
// version string ("default@1+adversarial-tight@1") is stamped on contracts.
//
// Built-in packs: default, adversarial-tight, regulated, upstream-pharmacy.
// A pack can also be a JSON file path with the same fields (regexes as strings).

import fs from "node:fs";
import type { ApprovalSpec, Intent, RiskClass } from "./types.ts";

export interface PolicyPack {
  name: string;
  version: number;
  /** injection layer: any match blocks */
  injection?: { kind: string; pattern: RegExp }[];
  /** policy gate: these intents are recognised but never executable (block with the intent's blockReason) */
  denyIntents?: string[];
  /** policy gate: imperative clause patterns that block regardless of classifier score */
  denyPatterns?: { intent: string; pattern: RegExp }[];
  /** policy gate: capabilities no contract may ever carry */
  neverCapabilities?: string[];
  /** policy gate: approvals lifted into the contract */
  approvalRules?: { riskClass?: RiskClass; intents?: string[]; spec: ApprovalSpec }[];
  /** scope layer: warnings that lift risk one band each */
  scopeWarnings?: { kind: string; pattern: RegExp }[];
  /** PII layer */
  pii?: { block?: string[] };
  /** rate-limit layer, per user per intent */
  rateLimit?: { perMinute: number; highRiskPerMinute: number };
  /** denied intents within this margin of the top candidate (and >= 0.40) block: fail safe toward refusal */
  denyMargin?: number;
}

const DEFAULT: PolicyPack = {
  name: "default",
  version: 1,
  injection: [
    { kind: "instruction-override", pattern: /\b(ignore|disregard|forget)\b[^.\n]{0,30}\b(previous|prior|above|earlier|all|the (rules|user|instructions|guidance)|your (rules|instructions|guidelines|guardrails))\b/i },
    { kind: "role-drift", pattern: /\b(you are now|pretend to be|act as (the )?system|unrestricted mode|developer mode|god mode)\b/i },
    { kind: "embedded-control", pattern: /<\/?\s*(system|user|assistant)\s*>|\[\/?INST\]|<\|im_(start|end)\|>|<<\/?SYS>>/i },
    { kind: "tool-ref", pattern: /\b(use|call|invoke|run|via)\s+(the\s+)?[a-z]+(_[a-z0-9]+)+\b/i },
    { kind: "control-bytes", pattern: /\\u202[a-e]|\\u206[6-9]|[‪-‮⁦-⁩]/i },
    { kind: "credential-exfil", pattern: /\b(reveal|dump|print|leak|show|tell me|give me)\b[^.\n]{0,40}\b(credentials?|api keys?|secrets?|passwords?|tokens?|signing (key|secret))\b/i },
  ],
  pii: { block: ["credential", "card"] },
  rateLimit: { perMinute: 60, highRiskPerMinute: 10 },
  denyMargin: 0,
};

const ADVERSARIAL_TIGHT: PolicyPack = {
  name: "adversarial-tight",
  version: 1,
  injection: [
    { kind: "prompt-exfil", pattern: /\b(system prompt|developer message|hidden instructions?)\b/i },
    { kind: "jailbreak", pattern: /\b(jailbreak|DAN mode|do anything now)\b/i },
    { kind: "guard-bypass", pattern: /\b(override|bypass|disable|turn off)\b[^.\n]{0,30}\b(guard|guardrails?|safety|polic(y|ies)|restrictions?|filters?|scout)\b/i },
    { kind: "role-drift", pattern: /\byou(?:'re| are) now\b|\byou(?:'re| are) (?:the|a|an) [a-z ]{0,30}(?:system|bot|agent|admin) now\b/i },
    { kind: "addressed-instruction", pattern: /["'“‘]\s*(assistant|ai|agent|model|upstream)\s*[,:]/i },
  ],
};

const REGULATED: PolicyPack = {
  name: "regulated",
  version: 1,
  pii: { block: ["credential", "card", "ssn"] },
};

/** Upstream's pharmacy pack: what Upstream must never do, and who must approve what. */
const UPSTREAM_PHARMACY: PolicyPack = {
  name: "upstream-pharmacy",
  version: 1,
  denyIntents: ["order.place", "inventory.modify", "formulary.change", "clinical.dosing_advice"],
  neverCapabilities: ["order.place", "inventory.write", "email.send", "formulary.write", "clinical.advise"],
  denyPatterns: [
    // imperative clause openings only (after filler words are stripped), so "our cisplatin order got cut" or "the vincristine we buy" do not match
    { intent: "order.place", pattern: /^(re-?order|re-?stock|replenish|procure|purchase|buy|order)\b/ },
    { intent: "order.place", pattern: /^(place|submit|send|put in|raise|cut)\b[^.]{0,40}\b(order|po|purchase order|requisition)\b/ },
    { intent: "order.place", pattern: /^get\b[^.]{0,20}\b(another|more|\d+)\b/ },
    { intent: "inventory.modify", pattern: /^(set|mark|update|adjust|change|zero out|write off|correct)\b[^.]{0,60}\b(on[- ]?hand|count|inventory|par( level)?|quantity|stock level|as zero|to zero)\b/ },
    { intent: "formulary.change", pattern: /^(add|remove|take|swap|make|change|update|list|put|drop)\b[^.]{0,60}\bformulary\b/ },
    { intent: "clinical.dosing_advice", pattern: /\b(what|right|correct|which|recommended|starting|loading|conversion|equivalent)\s+(is the\s+)?dos(e|ing|age)\b|\bdos(e|ing|age)\s+(of|for|conversion|adjustment)\b|\bhow (should|do|would) (i|we) dose\b|\bmg\s*\/\s*kg\b|\bmg per kg\b|\bdrip rate\b|\binfusion rate\b|\btitrat(e|ion|ing)\b|\brenal(ly)? (dose|dosing|adjust)/ },
  ],
  approvalRules: [
    { riskClass: "medium", spec: { kind: "named-approver", roles: ["pharmacist", "director"], capabilities: ["hmem.write"], reason: "a decision enters memory only with a named pharmacist or director approval" } },
    // Informational (gates no Upstream capability): a draft memo or transfer request takes effect only when a named human approves it in their own system.
    { intents: ["memo.draft_pt", "transfer.draft_request"], spec: { kind: "named-approver", roles: ["pharmacist", "director"], capabilities: [], reason: "drafts take effect only after a named pharmacist or director approves them outside Upstream" } },
    { riskClass: "high", spec: { kind: "user-confirm", reason: "high-risk outreach: the user confirms the drafted message" } },
    { riskClass: "high", spec: { kind: "operator-review", roles: ["pharmacist", "director"], reason: "high-risk outreach: a pharmacist or director reviews before anything leaves the hospital" } },
  ],
  scopeWarnings: [
    { kind: "approval-bypass-language", pattern: /\b(already (signed off|approved|okayed)|signed off already|skip (the )?(sign[- ]?off|approval|review)|no need to (wait|ask|review|check)|without (a |the |any )?(pharmacist|approval|sign[- ]?off|review)|bypass (the )?(approval|review))\b/i },
    { kind: "bulk-scope", pattern: /\b(all|every) (hospitals?|vendors?|suppliers?|wholesalers?|customers?)\b/i },
  ],
  rateLimit: { perMinute: 60, highRiskPerMinute: 5 },
  denyMargin: 0,
};

export const BUILTIN_PACKS: Record<string, PolicyPack> = {
  default: DEFAULT,
  "adversarial-tight": ADVERSARIAL_TIGHT,
  regulated: REGULATED,
  "upstream-pharmacy": UPSTREAM_PHARMACY,
};

export interface ComposedPolicy {
  version: string;
  packs: PolicyPack[];
  injection: { kind: string; pattern: RegExp }[];
  denyIntents: Set<string>;
  denyPatterns: { intent: string; pattern: RegExp }[];
  neverCapabilities: Set<string>;
  approvalRules: NonNullable<PolicyPack["approvalRules"]>;
  scopeWarnings: { kind: string; pattern: RegExp }[];
  piiBlock: Set<string>;
  rateLimit: { perMinute: number; highRiskPerMinute: number };
  denyMargin: number;
}

function fromJson(file: string): PolicyPack {
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  const re = (s: string) => new RegExp(s, "i");
  return {
    ...raw,
    injection: raw.injection?.map((x: { kind: string; pattern: string }) => ({ kind: x.kind, pattern: re(x.pattern) })),
    denyPatterns: raw.denyPatterns?.map((x: { intent: string; pattern: string }) => ({ intent: x.intent, pattern: re(x.pattern) })),
    scopeWarnings: raw.scopeWarnings?.map((x: { kind: string; pattern: string }) => ({ kind: x.kind, pattern: re(x.pattern) })),
  };
}

export function composePolicy(spec: string | string[] | PolicyPack[] | undefined): ComposedPolicy {
  const names = spec === undefined ? ["default"] : Array.isArray(spec) ? spec : [spec];
  const packs = (names as (string | PolicyPack)[]).map((n) => {
    if (typeof n !== "string") return n;
    if (BUILTIN_PACKS[n]) return BUILTIN_PACKS[n];
    if (fs.existsSync(n)) return fromJson(n);
    throw new Error(`Scout: unknown policy pack "${n}"`);
  });
  // "default" is always the base layer.
  if (!packs.some((p) => p.name === "default")) packs.unshift(DEFAULT);
  const rl = packs.map((p) => p.rateLimit).filter(Boolean) as { perMinute: number; highRiskPerMinute: number }[];
  return {
    version: packs.map((p) => `${p.name}@${p.version}`).join("+"),
    packs,
    injection: packs.flatMap((p) => p.injection ?? []),
    denyIntents: new Set(packs.flatMap((p) => p.denyIntents ?? [])),
    denyPatterns: packs.flatMap((p) => p.denyPatterns ?? []),
    neverCapabilities: new Set(packs.flatMap((p) => p.neverCapabilities ?? [])),
    approvalRules: packs.flatMap((p) => p.approvalRules ?? []),
    scopeWarnings: packs.flatMap((p) => p.scopeWarnings ?? []),
    piiBlock: new Set(packs.flatMap((p) => p.pii?.block ?? [])),
    rateLimit: { perMinute: Math.min(...rl.map((r) => r.perMinute)), highRiskPerMinute: Math.min(...rl.map((r) => r.highRiskPerMinute)) },
    denyMargin: Math.max(...packs.map((p) => p.denyMargin ?? 0)),
  };
}

export function isDenied(policy: ComposedPolicy, intent: Intent): boolean {
  return policy.denyIntents.has(intent.id) || intent.capabilities.some((c) => policy.neverCapabilities.has(c));
}
