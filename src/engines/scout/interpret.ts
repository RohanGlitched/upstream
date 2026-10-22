// InterpretService (AGENTS.md section 5): bind parameters per the intent's
// schema, bind entity references (drug, NDC) to stable ids when a resolver is
// available, validate bounds, and report unbound required parameters
// (clarification trigger 3). Interpret never changes scores.

import type { Normalised } from "./lexicon.ts";
import type { EntityRef, Intent } from "./types.ts";

export type ReferenceResolver = (kind: string, value: string) => string | undefined;

export interface Interpretation {
  parameters: Record<string, unknown>;
  references: Record<string, EntityRef>;
  missing: string[];
  violations: string[];
}

export function interpret(
  intent: Intent,
  norm: Normalised,
  raw: string,
  opts: { activeDrug?: string; resolver?: ReferenceResolver } = {},
): Interpretation {
  const parameters: Record<string, unknown> = {};
  const references: Record<string, EntityRef> = {};
  const violations: string[] = [];
  const props = intent.parameters?.properties ?? {};
  const lower = raw.toLowerCase();
  let numberIdx = 0;

  for (const [name, p] of Object.entries(props)) {
    if (p.entity === "drug") {
      const drug = norm.drugs[0] ?? undefined;
      const ndc = norm.ndcs[0];
      if (drug) {
        parameters[name] = drug;
        references[name] = { kind: "drug", value: drug, id: opts.resolver?.("drug", drug) };
      } else if (ndc) {
        parameters[name] = ndc;
        references[name] = { kind: "ndc", value: ndc, id: opts.resolver?.("ndc", ndc) };
      } else if (opts.activeDrug) {
        parameters[name] = opts.activeDrug;
        references[name] = { kind: "drug", value: opts.activeDrug, id: opts.resolver?.("drug", opts.activeDrug) };
      }
      if (ndc && drug) references.ndc = { kind: "ndc", value: ndc, id: opts.resolver?.("ndc", ndc) };
      continue;
    }
    if (p.enum) {
      const hit = p.enum.find((v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower));
      if (hit) parameters[name] = hit;
      continue;
    }
    if (p.type === "integer" || p.type === "number") {
      let v: number | undefined;
      if (/^(quantity|count|qty)$/i.test(name) && norm.quantities.length) v = norm.quantities[0].value;
      else if (/^(quantity|count|qty)$/i.test(name)) v = norm.numbers[numberIdx++];
      else if (/value|amount|min|max/i.test(name)) v = norm.numbers.find((n) => n >= 1000) ?? undefined;
      if (v === undefined || Number.isNaN(v)) continue;
      if (p.type === "integer") v = Math.round(v);
      if (p.minimum !== undefined && v < p.minimum) violations.push(`${name}=${v} below minimum ${p.minimum}`);
      if (p.maximum !== undefined && v > p.maximum) violations.push(`${name}=${v} above maximum ${p.maximum}`);
      parameters[name] = v;
    }
  }
  const missing = (intent.parameters?.required ?? []).filter((r) => parameters[r] === undefined);
  return { parameters, references, missing, violations };
}
