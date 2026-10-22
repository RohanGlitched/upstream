// GuardService layers that do not need the classified intent (AGENTS.md
// section 6, docs/risk-and-policy.md): injection, PII / sensitivity, scope
// warnings, rate limiting, and the clause splitter used by the policy gate.
// The intent-aware policy gate (RBAC, surfaces, deny rules, bounds) runs in
// index.ts because it needs Sense and Interpret output.

import type { ComposedPolicy } from "./policy.ts";
import type { Redaction, RiskFlag } from "./types.ts";

export function injectionLayer(policy: ComposedPolicy, prompt: string, knownTools: Set<string>): RiskFlag[] {
  const flags: RiskFlag[] = [];
  for (const { kind, pattern } of policy.injection) {
    const m = prompt.match(pattern);
    if (!m) continue;
    if (kind === "tool-ref") {
      const name = m[0].split(/\s+/).pop() ?? "";
      if (knownTools.has(name)) continue; // a tool reachable through the graph is not out-of-band
    }
    flags.push({ layer: "injection", kind, verdict: "block", evidence: `pattern:${kind}` });
  }
  return flags;
}

const PII: { kind: Redaction["kind"]; re: RegExp; check?: (s: string) => boolean }[] = [
  { kind: "credential", re: /\b(sk-[A-Za-z0-9_-]{16,}|nvapi-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,})\b/g },
  { kind: "email", re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { kind: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: "card", re: /\b(?:\d[ -]?){13,19}\b/g, check: luhn },
  { kind: "phone", re: /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g },
  { kind: "mrn", re: /\b(?:mrn|medical record(?: number)?)[\s:#]*\d{5,12}\b/gi },
];

function luhn(s: string): boolean {
  const d = s.replace(/\D/g, "");
  if (d.length < 13) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Redact PII before anything downstream sees the prompt; block configured data classes. */
export function piiLayer(policy: ComposedPolicy, prompt: string): { redacted: string; redactions: Redaction[]; flags: RiskFlag[]; dataClass: string } {
  let redacted = prompt;
  const redactions: Redaction[] = [];
  const flags: RiskFlag[] = [];
  for (const { kind, re, check } of PII) {
    let n = 0;
    redacted = redacted.replace(re, (m) => {
      if (check && !check(m)) return m;
      n += 1;
      const token = `[${kind.toUpperCase()}_${n}]`;
      redactions.push({ kind, token });
      return token;
    });
    if (n && policy.piiBlock.has(kind)) flags.push({ layer: "pii", kind, verdict: "block", evidence: `${n} ${kind} value(s) redacted` });
  }
  const restricted = redactions.some((r) => ["mrn", "ssn", "card", "credential"].includes(r.kind));
  return { redacted, redactions, flags, dataClass: restricted ? "restricted" : redactions.length ? "confidential" : "internal" };
}

export function scopeLayer(policy: ComposedPolicy, prompt: string, recentHighRisk: number): RiskFlag[] {
  const flags: RiskFlag[] = [];
  for (const { kind, pattern } of policy.scopeWarnings) if (pattern.test(prompt)) flags.push({ layer: "scope", kind, verdict: "warn", evidence: `pattern:${kind}` });
  if (recentHighRisk >= 3) flags.push({ layer: "scope", kind: "high-risk-burst", verdict: "warn", evidence: `${recentHighRisk} high-risk decisions in 10 min` });
  return flags;
}

/** Token bucket per key. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  take(key: string, perMinute: number, now: number): boolean {
    const b = this.buckets.get(key) ?? { tokens: perMinute, at: now };
    const refill = ((now - b.at) / 60_000) * perMinute;
    b.tokens = Math.min(perMinute, b.tokens + refill);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }
}

const FILLER = /^(?:please|pls|ok(?:ay)?|so|now|also|then|and|just|quickly|can you|could you|would you|will you|i need you to|i want you to|we need to|let'?s|go ahead and|go ahead|kindly)\b[\s,]*/;

/** Strip leading politeness and connective words so imperative patterns see the verb. */
export function stripFiller(clause: string): string {
  let c = clause.trim().toLowerCase();
  for (let i = 0; i < 6; i++) {
    const next = c.replace(FILLER, "").trim();
    if (next === c) break;
    c = next;
  }
  return c;
}

/** Split a prompt into clauses on sentence ends, semicolons and coordinating "and/then/also/but". */
export function splitClauses(prompt: string): string[] {
  const p = prompt.replace(/pharmacy\s+(and|&)\s+therapeutics/gi, "P&T");
  return p
    .split(/[.;!?\n]+|,?\s+\b(?:and then|and also|then|and|also|but)\b\s+|,\s+(?=(?:then|also|and)\b)/i)
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
}
