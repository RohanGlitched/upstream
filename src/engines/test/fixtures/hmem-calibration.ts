// Labelled fixture for H-MEM recall calibration. Memories are written the way
// Upstream writes them (rememberDecision / rememberInvestigation); each query
// lists the decision keys a pharmacist would expect to see. Queries with an
// empty `relevant` list are distractors that should return nothing.

import type { DecisionInput, InvestigationInput } from "../../hmem.ts";

export const DAY = 24 * 60 * 60 * 1000;
export const T0 = Date.parse("2026-10-01T09:00:00Z");

export const DECISIONS: (DecisionInput & { key: string })[] = [
  { key: "carbo-sub", drug: "carboplatin", decision: "use cisplatin as the interim substitute for ovarian protocols", approvedBy: "J. Patel, PharmD", rationale: "carboplatin on FDA shortage list, two labelers on allocation", ndcs: ["0703-4244-01"], evidenceRefs: ["fda-shortage:carboplatin"], at: T0 - 200 * DAY },
  { key: "carbo-conserve", drug: "carboplatin", decision: "restrict carboplatin to curative-intent regimens and round doses to vial size", approvedBy: "P&T Committee (chair M. Okafor)", rationale: "days on hand fell below 10", at: T0 - 190 * DAY },
  { key: "cis-transfer", drug: "cisplatin", decision: "borrow 40 vials of cisplatin from Mercy West", approvedBy: "S. Lee, Director of Pharmacy", rationale: "sister hospital surplus covered three weeks", at: T0 - 120 * DAY },
  { key: "hep-icu", drug: "heparin", decision: "reserve heparin 5,000 units/mL vials for ICU and dialysis", approvedBy: "J. Patel, PharmD", rationale: "single labeler after a recall", at: T0 - 90 * DAY },
  { key: "vinc-ration", drug: "vincristine", decision: "ration vincristine to pediatric oncology first", approvedBy: "P&T Committee (chair M. Okafor)", rationale: "sole-source manufacturer import alert", at: T0 - 60 * DAY },
  { key: "mtx-alt", drug: "methotrexate", decision: "switch to the Accord labeler's methotrexate as an equivalent product", approvedBy: "S. Lee, Director of Pharmacy", rationale: "primary labeler warning letter", at: T0 - 30 * DAY },
  { key: "bupi-sub", drug: "bupivacaine", decision: "use ropivacaine for epidurals while bupivacaine is backordered", approvedBy: "Anesthesia and P&T joint decision (A. Ruiz)", rationale: "backorder of 0.25% vials", at: T0 - 20 * DAY },
  { key: "saline-conserve", drug: "normal saline", decision: "conserve 1 L normal saline bags by switching eligible IV pushes", approvedBy: "J. Patel, PharmD", rationale: "manufacturing site hurricane damage", at: T0 - 10 * DAY },
];

export const INVESTIGATIONS: (InvestigationInput & { key: string })[] = [
  { key: "inv-carbo", investigationId: "inv-2026-03-carboplatin", drug: "carboplatin", summary: "two manufacturing sites with FDA 483 observations; one warning letter; shortage listed as current", at: T0 - 205 * DAY },
  { key: "inv-hep", investigationId: "inv-2026-07-heparin", drug: "heparin", summary: "class II recall at the main labeler's site; second labeler on allocation", at: T0 - 92 * DAY },
];

export const QUERIES: { q: string; relevant: string[]; drug?: string }[] = [
  { q: "what did we do last time carboplatin was short", relevant: ["carbo-sub", "carbo-conserve"], drug: "carboplatin" },
  { q: "past decisions about cisplatin", relevant: ["cis-transfer", "carbo-sub"], drug: "cisplatin" },
  { q: "how did we handle the heparin shortage", relevant: ["hep-icu"], drug: "heparin" },
  { q: "vincristine rationing decision", relevant: ["vinc-ration"], drug: "vincristine" },
  { q: "which methotrexate labeler did we switch to", relevant: ["mtx-alt"], drug: "methotrexate" },
  { q: "bupivacaine backorder substitute", relevant: ["bupi-sub"], drug: "bupivacaine" },
  { q: "normal saline conservation", relevant: ["saline-conserve"], drug: "normal saline" },
  { q: "who approved the carboplatin substitution", relevant: ["carbo-sub"], drug: "carboplatin" },
  { q: "parking rules for the night shift", relevant: [] },
  { q: "quarterly budget variance for the cafeteria", relevant: [] },
  { q: "insulin pen training schedule", relevant: [] },
  { q: "vancomycin trough monitoring policy", relevant: [] },
];
