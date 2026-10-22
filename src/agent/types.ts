// The shape of one investigation. The agent writes it; the UI, the memo and the back-test read it.
import type { QueryResult } from "../lib/zetaris";

export type Hospital = "Corvale General" | "Corvale East" | "Corvale Lakeside";

/** One row of evidence: a query and the row in it. Every claim in a case cites one or more of these. */
export interface Evidence {
  id: string; // "E7"
  queryId: string; // "Q-3f9a1c"
  row: number;
  label: string; // short human label, e.g. "FDA inspection 1196012, OAI"
  fields: Record<string, string | number | null>;
}

export interface Step {
  key:
    | "resolve"
    | "stock"
    | "chain"
    | "signals"
    | "fda_shortage"
    | "market"
    | "interchange"
    | "data_quality"
    | "memory";
  title: string; // "Where our carboplatin comes from"
  purpose: string; // one sentence on why this step runs
  queryIds: string[];
  sources: string[];
  ms: number;
  rows: number;
  finding: string; // one plain sentence
  status: "ok" | "empty" | "failed";
  error?: string;
}

export interface StockLine {
  hospital: Hospital;
  itemKey: string;
  ndc11: string;
  description: string;
  labeler: string | null;
  onHand: number;
  dailyUse: number;
  days: number | null;
  unit: string;
  ndcMatch: string;
  evidence: string;
}

export type Health = "signal" | "watch" | "clear" | "unknown";

export interface Signal {
  kind: "inspection_oai" | "inspection_vai" | "warning_letter" | "injunction" | "seizure" | "import_alert" | "recall";
  date: string; // when it happened (inspection end, letter issue, alert published, recall start)
  knownDate: string; // when it was public or plausibly known
  knownBasis: string;
  fei: string | null;
  firm: string;
  text: string;
  evidence: string;
}

export interface Plant {
  key: string; // DUNS when known, else a name key
  name: string;
  duns: string | null;
  fei: string | null;
  country: string | null;
  address: string | null;
  operations: string;
  linkSource: string; // spl_establishment | label_text | drugsfda_sponsor
  linkQuality: "registered plant" | "named on label, not placed" | "sponsor only";
  health: Health;
  lastClassification: { classification: string; endDate: string } | null;
  signals: Signal[];
  evidence: string[];
}

export interface ProductChain {
  ndc11: string;
  packageNdc: string;
  labeler: string;
  generic: string;
  setId: string | null;
  plants: Plant[];
  evidence: string;
}

export interface ShortageStatus {
  listed: boolean;
  status: string | null; // Current | To Be Discontinued | Resolved
  firstPosting: string | null;
  companies: { company: string; status: string; updated: string; info: string; evidence: string }[];
  reasons: string[];
  ourNdcsListed: string[];
}

export interface MarketLine {
  labeler: string;
  ndc11: string;
  dosageForm: string;
  plants: { name: string; fei: string | null; country: string | null; health: Health; last: string | null }[];
  onShortageList: boolean;
  inOurStock: boolean;
}

export interface OptionLine {
  kind: "transfer" | "alternate_manufacturer" | "alternate_concentration" | "interchange" | "iv_to_po";
  title: string;
  detail: string;
  rank: number;
  why: string;
  needs: string; // who must approve
  evidence: string[];
}

export interface Sentence {
  text: string;
  cites: string[];
}

export interface Explanation {
  state: "confirmed" | "check" | "no_signal";
  headline: string;
  sentences: Sentence[];
  verifier: { checked: number; rejected: { text: string; reason: string }[] };
  model: string;
}

export interface TimelineEvent {
  date: string;
  kind: Signal["kind"] | "shortage_posted" | "today";
  label: string;
  daysBeforePosting: number | null;
  evidence: string | null;
}

export interface DataQualityNote {
  table: string;
  rule: string;
  total: number;
  invalid: number;
  note: string;
}

export interface MemoryLine {
  id: string;
  text: string;
  approvedBy: string | null;
  when: string | null;
  score: number;
}

export interface GateEntry {
  at: string;
  action: string;
  capability: string;
  decision: "allowed" | "needs approval" | "refused";
  reason: string;
}

export interface Usage {
  zetarisQueries: number;
  zetarisMs: number;
  modelCalls: number;
  tokensIn: number;
  tokensOut: number;
  mode: "live" | "replay" | "mixed";
}

export interface Case {
  id: string;
  question: string;
  askedAt: string;
  asOf: string; // the "today" the data reflects
  molecule: string;
  intent: { name: string; risk: string; contractId: string | null; clarification: string | null };
  steps: Step[];
  stock: StockLine[];
  chain: ProductChain[];
  shortage: ShortageStatus;
  market: MarketLine[];
  options: OptionLine[];
  timeline: TimelineEvent[];
  explanation: Explanation | null;
  dataQuality: DataQualityNote[];
  memory: MemoryLine[];
  memo: { draft: string; status: "draft" | "approved"; approvedBy: string | null; contractId: string | null } | null;
  gate: GateEntry[];
  evidence: Record<string, Evidence>;
  queries: Record<string, Pick<QueryResult, "id" | "sql" | "ms" | "mode" | "sources" | "ranAt"> & { rows: number }>;
  usage: Usage;
}
