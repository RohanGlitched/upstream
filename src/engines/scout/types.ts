// Scout Intent types, following vendor/meterless/scout-intent/AGENTS.md and
// docs/*.md. Field names match the spec so the Meterless eval harness can
// read decisions directly. Additions are marked "Upstream:".

export type RiskClass = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high" | "block";
export type Band = "high" | "medium" | "low" | "reject";

export interface ParameterProperty {
  type?: "string" | "integer" | "number" | "array" | "boolean";
  enum?: string[];
  minimum?: number;
  maximum?: number;
  /** Upstream: entity kind bound by the Interpret stage ("drug"). */
  entity?: string;
  items?: unknown;
}

export interface ParameterSchema {
  type?: "object";
  properties?: Record<string, ParameterProperty>;
  required?: string[];
}

export interface Trigger {
  phrase: string;
  weight: number;
}

export interface Intent {
  id: string;
  category: string;
  description: string;
  parameters: ParameterSchema;
  capabilities: string[];
  riskClass: RiskClass;
  surfaces: string[];
  roles: string[];
  examples: string[];
  version: number;
  /** Upstream: optional weighted trigger phrases for the Stage-1 scan (examples are always used too). */
  triggers?: Trigger[];
  /** Upstream: plain-English reason shown when a policy pack denies this intent. */
  blockReason?: string;
}

export interface IntentRegistryData {
  version: number;
  name?: string;
  note?: string;
  intents: Intent[];
}

export interface UserRef {
  id?: string;
  role?: string;
  /** Upstream: display name, used on approval records. */
  name?: string;
  permissions?: string[];
}

export interface IntentCandidate {
  intent: string;
  score: number;
  span?: string;
}

export interface RiskFlag {
  layer: "injection" | "policy" | "scope" | "pii" | "rate-limit" | "route";
  kind: string;
  verdict: "warn" | "block";
  /** metadata only; detected injection payloads are never stored */
  evidence?: string;
}

export interface Redaction {
  kind: "email" | "phone" | "mrn" | "ssn" | "card" | "credential";
  /** replacement token used in the redacted prompt */
  token: string;
}

export interface ApprovalSpec {
  kind: "user-confirm" | "operator-review" | "named-approver";
  /** roles allowed to give this approval (named-approver) */
  roles?: string[];
  /** capabilities this approval gates; absent = every capability in the contract */
  capabilities?: string[];
  reason?: string;
}

export interface ApprovalRecord {
  kind: ApprovalSpec["kind"];
  /** named human, e.g. "J. Patel, PharmD" */
  by: string;
  role?: string;
  at: string;
  decision?: "approve";
  confirmation?: "yes";
  note?: string;
}

export interface Risk {
  level: RiskLevel;
  flags: RiskFlag[];
  redactions: Redaction[];
  reason?: string;
  approvalsRequired?: ApprovalSpec[];
}

export interface ToolStep {
  /** spec: the concrete tool id */
  tool: string;
  input: Record<string, unknown>;
  /** the abstract capability (the harness reads `capability`) */
  capability: string;
  local: boolean;
  /** Upstream: false when the tool is a placeholder registered from the registry declaration only */
  bound: boolean;
}

export interface ModelProfile {
  id: string;
  provider: string;
  model: string;
  local: boolean;
  context?: number;
  cost?: { in: number; out: number };
  latency?: { p95Ms: number };
  capabilities: string[];
  dataClasses: string[];
  quality?: "fast" | "capable";
  fallbacks?: string[];
  /** env var that must be set (non-empty) for this profile to be available */
  requiresEnv?: string;
}

export interface ModelProfileRef {
  id: string;
  provider: string;
  model: string;
  local: boolean;
  dataClass: string;
  reason: string;
}

export interface EntityRef {
  kind: string;
  value: string;
  /** World Model id, when a resolver bound it */
  id?: string;
}

export interface ExecutionContract {
  contractId: string;
  parentId?: string;
  traceId: string;
  intent: {
    primary: { id: string; version: number };
    parameters: Record<string, unknown>;
    references: Record<string, EntityRef>;
    confidence: number;
    alternates: IntentCandidate[];
    /** Upstream: secondary intents of a multi-intent plan */
    secondary?: { id: string; version: number; span?: string }[];
  };
  risk: {
    level: Exclude<RiskLevel, "block">;
    flags: RiskFlag[];
    redactions: Redaction[];
    approvals: ApprovalRecord[];
    /** Upstream: what approvals the executor must see before each gated capability */
    approvalsRequired: ApprovalSpec[];
  };
  toolPlan: ToolStep[];
  modelProfile: ModelProfileRef;
  scope: {
    user: UserRef;
    surface: string;
    capabilities: string[];
    deadline?: string;
    budget?: { tokensMax?: number; costMaxUSD?: number };
  };
  issuedAt: string;
  expiresAt: string;
  registryVersion: number;
  policyPackVersion: string;
  signature: string;
  signedBy: "scout";
}

export interface Clarification {
  trigger: "low-band" | "tie" | "params" | "high-risk" | "reject" | "route";
  question: string;
  options: { label: string; intent: string }[];
  missing?: string[];
}

export interface Decision {
  traceId: string;
  candidates: IntentCandidate[];
  intent: {
    primary: string;
    confidence: number;
    band: Band;
    parameters: Record<string, unknown>;
    references: Record<string, EntityRef>;
  };
  /** multi-intent plan (two High candidates on disjoint spans) */
  plan?: { intent: string; score: number; span: string }[];
  risk: Risk;
  toolPlan: ToolStep[];
  clarification?: Clarification;
  executionContract?: ExecutionContract;
  modelProfile?: ModelProfileRef;
  stage2: "used" | "skipped";
  latencyMs: { sense: number; total: number };
  error?: { kind: "unresolvable-capability" | "permission" | "unavailable"; capability: string; message: string };
}

export interface DecideInput {
  prompt: string;
  user?: UserRef;
  surface: string;
  /** contextual signals: active intent, recent intents, memory hits, active drug */
  context?: {
    activeIntent?: string;
    recentIntents?: string[];
    /** intent id -> 0..1 relevance from retrieved memory or workflow */
    intentHints?: Record<string, number>;
    activeDrug?: string;
    /** recency ("used recently in-session") is tracked per session id; no id, no recency term */
    sessionId?: string;
  };
}
