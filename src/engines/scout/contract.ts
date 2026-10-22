// ContractService (AGENTS.md section 8, docs/execution-contract.md):
// canonical JSON, HMAC-SHA256 signature, monotonic ULIDs, 5-minute TTL,
// and the executor-side verifyContract() every Upstream tool call must pass.

import crypto from "node:crypto";
import type { ApprovalRecord, ApprovalSpec, ExecutionContract } from "./types.ts";
import { telemetry } from "./telemetry.ts";

export const CONTRACT_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;

/** Capabilities Upstream never executes, whatever a contract says (defense in depth). */
export const NEVER_CAPABILITIES = ["order.place", "inventory.write", "email.send", "formulary.write", "clinical.advise"];

// ------------------------------------------------------------------ canonical JSON

/** Sorted keys, no whitespace, undefined members dropped (same rule as World Model's canonicalJson). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
}

// ------------------------------------------------------------------ ULID

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = -1;
let lastRandom: number[] = [];

/** Monotonic ULID: 48-bit ms timestamp + 80-bit randomness, incremented within the same ms. */
export function ulid(now = Date.now()): string {
  let rand: number[];
  if (now <= lastTime) {
    now = lastTime;
    rand = [...lastRandom];
    for (let i = rand.length - 1; i >= 0; i--) {
      if (rand[i] < 31) {
        rand[i]++;
        break;
      }
      rand[i] = 0;
    }
  } else {
    rand = [...crypto.randomBytes(16)].map((b) => b % 32);
  }
  lastTime = now;
  lastRandom = rand;
  let t = "";
  let x = now;
  for (let i = 0; i < 10; i++) {
    t = CROCKFORD[x % 32] + t;
    x = Math.floor(x / 32);
  }
  return t + rand.map((r) => CROCKFORD[r]).join("");
}

// ------------------------------------------------------------------ secret

let processSecret: string | undefined;

/** Per-deployment signing secret: SCOUT_SIGNING_SECRET, else a random per-process secret (dev). */
export function defaultSecret(): string {
  if (process.env.SCOUT_SIGNING_SECRET) return process.env.SCOUT_SIGNING_SECRET;
  processSecret ??= crypto.randomBytes(32).toString("hex");
  return processSecret;
}

export function sign(body: Omit<ExecutionContract, "signature">, secret: string): string {
  return crypto.createHmac("sha256", secret).update(canonicalJson(body)).digest("hex");
}

export function signContract(body: Omit<ExecutionContract, "signature">, secret: string): ExecutionContract {
  const c = { ...body, signature: sign(body, secret) } as ExecutionContract;
  return deepFreeze(c);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

// ------------------------------------------------------------------ verification

export type RefusalReason =
  | "malformed"
  | "unsigned"
  | "bad-signature"
  | "expired"
  | "not-yet-valid"
  | "scope-mismatch"
  | "never-capability"
  | "approval-missing"
  | "version-mismatch";

export type VerifyResult = { ok: true; contract: ExecutionContract } | { ok: false; reason: RefusalReason; detail: string };

export interface VerifyOptions {
  secret?: string;
  now?: number;
  /** which executor is verifying (telemetry) */
  engine?: string;
  never?: string[];
  expectRegistryVersion?: number;
  expectPolicyPackVersion?: string;
}

/** Approvals required before `capability` may run, per the contract's own (signed) requirements. */
export function requiredApprovals(c: ExecutionContract, capability: string): ApprovalSpec[] {
  return (c.risk.approvalsRequired ?? []).filter((s) => !s.capabilities || s.capabilities.includes(capability));
}

function satisfies(rec: ApprovalRecord, spec: ApprovalSpec): boolean {
  if (rec.kind !== spec.kind) return false;
  if (!rec.by || !rec.by.trim()) return false;
  if (spec.roles && spec.roles.length && (!rec.role || !spec.roles.includes(rec.role))) return false;
  if (rec.kind === "user-confirm") return rec.confirmation === "yes";
  return rec.decision === "approve";
}

/**
 * Executor-side check. Every Upstream tool call passes through this with the
 * capability it is about to use. Refuses unsigned, tampered, expired,
 * out-of-scope and never-list calls, and calls whose required approvals are
 * missing. Emits contract.verified / contract.refused / contract.expired.
 */
export function verifyContract(contract: unknown, capability: string, opts: VerifyOptions = {}): VerifyResult {
  const engine = opts.engine ?? "upstream-executor";
  const refuse = (reason: RefusalReason, detail: string): VerifyResult => {
    const id = (contract as { contractId?: string } | null)?.contractId ?? "unknown";
    telemetry.emit(reason === "expired" ? "contract.expired" : "contract.refused", { contractId: id, engine, capability, reason });
    return { ok: false, reason, detail };
  };
  const c = contract as ExecutionContract;
  if (!c || typeof c !== "object" || !c.scope || !Array.isArray(c.scope.capabilities) || !c.expiresAt || !c.intent) return refuse("malformed", "not an execution contract");
  if (!c.signature || c.signedBy !== "scout") return refuse("unsigned", "missing signature or signedBy");
  const { signature, ...body } = c;
  const expected = sign(body, opts.secret ?? defaultSecret());
  const a = Buffer.from(String(signature), "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return refuse("bad-signature", "signature does not match the canonical contract");
  const now = opts.now ?? Date.now();
  if (now >= Date.parse(c.expiresAt)) return refuse("expired", `expired at ${c.expiresAt}`);
  if (Date.parse(c.issuedAt) > now + CLOCK_SKEW_MS) return refuse("not-yet-valid", `issued in the future (${c.issuedAt})`);
  if (opts.expectRegistryVersion !== undefined && c.registryVersion !== opts.expectRegistryVersion) return refuse("version-mismatch", `registry ${c.registryVersion} != ${opts.expectRegistryVersion}`);
  if (opts.expectPolicyPackVersion !== undefined && c.policyPackVersion !== opts.expectPolicyPackVersion) return refuse("version-mismatch", `policy ${c.policyPackVersion} != ${opts.expectPolicyPackVersion}`);
  if ((opts.never ?? NEVER_CAPABILITIES).includes(capability)) return refuse("never-capability", `${capability} is never executed by Upstream`);
  if (!c.scope.capabilities.includes(capability)) return refuse("scope-mismatch", `${capability} not in scope [${c.scope.capabilities.join(", ")}]`);
  for (const spec of requiredApprovals(c, capability)) {
    if (!c.risk.approvals.some((r) => satisfies(r, spec))) return refuse("approval-missing", `${capability} needs ${spec.kind}${spec.roles ? ` by ${spec.roles.join("/")}` : ""}`);
  }
  telemetry.emit("contract.verified", { contractId: c.contractId, engine, capability });
  return { ok: true, contract: c };
}

/** Signature and validity window only (no capability check). Used by Scout before refresh/approve. */
export function verifyIntegrity(contract: ExecutionContract, opts: { secret?: string; now?: number } = {}): { ok: true } | { ok: false; reason: RefusalReason } {
  if (!contract?.signature || contract.signedBy !== "scout") return { ok: false, reason: "unsigned" };
  const { signature, ...body } = contract;
  const a = Buffer.from(String(signature), "hex");
  const b = Buffer.from(sign(body, opts.secret ?? defaultSecret()), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad-signature" };
  const now = opts.now ?? Date.now();
  if (now >= Date.parse(contract.expiresAt)) return { ok: false, reason: "expired" };
  if (Date.parse(contract.issuedAt) > now + CLOCK_SKEW_MS) return { ok: false, reason: "not-yet-valid" };
  return { ok: true };
}

export class ContractRefusedError extends Error {
  constructor(readonly reason: RefusalReason, readonly capability: string, detail: string) {
    super(`contract refused for ${capability}: ${reason} (${detail})`);
    this.name = "ContractRefusedError";
  }
}

/** Throwing form of verifyContract. */
export function assertContract(contract: unknown, capability: string, opts: VerifyOptions = {}): ExecutionContract {
  const r = verifyContract(contract, capability, opts);
  if (!r.ok) throw new ContractRefusedError(r.reason, capability, r.detail);
  return r.contract;
}

/** Wrap a tool so it can only run under a contract that allows its capability. */
export function guardedTool<A extends unknown[], R>(capability: string, fn: (...args: A) => R | Promise<R>, opts: VerifyOptions = {}) {
  return async (contract: unknown, ...args: A): Promise<R> => {
    assertContract(contract, capability, opts);
    return fn(...args);
  };
}
