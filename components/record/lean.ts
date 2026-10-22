// What a client drawing needs from a case, and nothing else. The watershed reads stock, presentations, the
// chain, the shortage, the options, the timeline and the evidence rows it cites; it never reads the World
// Model's graph, the SQL of every query, the steps, the gate or H-MEM. Server-only by use, pure by design.
import type { Case } from "../../src/agent/types";

export type LeanCase = Case;

export function leanCase(c: Case): LeanCase {
  return {
    ...c,
    steps: [],
    market: [],
    dataQuality: [],
    memory: [],
    gate: [],
    queries: {},
    memo: null,
    explanation: c.explanation ? { ...c.explanation, sentences: [], verifier: { ...c.explanation.verifier, rejected: [] } } : null,
    // drop the graph the World Model recorded (it is not in Case's type, but it is in the file)
    ...({ graph: undefined } as object),
  };
}
