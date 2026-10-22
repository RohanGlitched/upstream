// The approver's decision text as H-MEM stores it: quoted data, marked as the approver's own words. Pure, so the
// UI can parse a recalled decision without loading the memory engine.

/** Longest decision text H-MEM stores. */
export const DECISION_QUOTE_MAX = 240;

/** The approver's words as a safe quote: control and bidi characters out, whitespace collapsed, double quotes
 *  turned into single ones (so the quote cannot be closed early), capped at DECISION_QUOTE_MAX. */
export function quoteDecision(text: string): string {
  return String(text ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/["\u201c\u201d]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DECISION_QUOTE_MAX)
    .trim()
    .replace(/[.\s]+$/, "");
}

/** Split a stored decision back into its parts; handles the quoted form and the older unquoted one. */
export function parseDecisionContent(content: string): { drug: string | null; quote: string; quoted: boolean; rationale: string | null; approvedBy: string | null } {
  const q = /^Decision on (.+?), in the approver's words: "([^"]*)"\. Rationale: (.*?)\. Approved by (.+?)\.(?: NDCs: .*)?$/.exec(content);
  if (q) return { drug: q[1], quote: q[2], quoted: true, rationale: q[3], approvedBy: q[4] };
  const o = /^Decision on ([^:]+):\s*(.*?)(?:\. Rationale: (.*?))?(?:\. Approved by (.+?)\.)?(?: NDCs: .*)?$/.exec(content);
  return { drug: o?.[1] ?? null, quote: o?.[2] ?? content, quoted: false, rationale: o?.[3] ?? null, approvedBy: o?.[4] ?? null };
}
