// TelemetryService (AGENTS.md section 9, docs/telemetry-and-learning.md).
// Structured events; raw prompts are never logged (a short sha-256 prefix
// stands in). Optional JSONL sink via SCOUT_TELEMETRY_FILE or setSink().

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type TelemetryEvent =
  | "scout.decision"
  | "scout.clarification"
  | "scout.override"
  | "contract.issued"
  | "contract.verified"
  | "contract.expired"
  | "contract.refused";

export interface TelemetryRecord {
  event: TelemetryEvent;
  at: string;
  [k: string]: unknown;
}

class Telemetry {
  private buf: TelemetryRecord[] = [];
  private max = 2000;
  private file?: string = process.env.SCOUT_TELEMETRY_FILE;
  private listeners = new Set<(r: TelemetryRecord) => void>();

  emit(event: TelemetryEvent, fields: Record<string, unknown>): void {
    const rec: TelemetryRecord = { event, at: new Date().toISOString(), ...fields };
    this.buf.push(rec);
    if (this.buf.length > this.max) this.buf.splice(0, this.buf.length - this.max);
    if (this.file) {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.appendFileSync(this.file, JSON.stringify(rec) + "\n");
      } catch {
        // telemetry must never break a decision
      }
    }
    for (const l of this.listeners) l(rec);
  }

  events(filter?: TelemetryEvent): TelemetryRecord[] {
    return filter ? this.buf.filter((r) => r.event === filter) : [...this.buf];
  }

  clear(): void {
    this.buf = [];
  }

  setSink(file: string | undefined): void {
    this.file = file;
  }

  subscribe(fn: (r: TelemetryRecord) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const telemetry = new Telemetry();

export function promptHash(prompt: string): string {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}
