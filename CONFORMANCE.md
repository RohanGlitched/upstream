# Meterless conformance

_Run 2026-10-22T05:02:25.310Z on win32, Node v21.7.0, against Upstream's integration modules (vendored engines at commit 1742dec). Regenerate with `npm run conformance`._

| Engine | Our module | Result | Detail |
|---|---|---|---|
| H-MEM | `src/engines/hmem.ts` | PASS | 13/13 checks passed |
| World Model | `src/engines/world-model.ts` | PASS | 8/8 checks passed |
| Markovian | `src/engines/markovian.ts` | PASS | 8/8 checks passed |
| Scout Intent | `src/engines/scout/index.ts` | PASS | gate PASS on 32 examples: top1 1, top3 1, injection P/R 1/1, tool 1, clarification rate 0.09375 |

## What these numbers mean

- **H-MEM, World Model, Markovian**: the Meterless conformance runners, unmodified, loading our modules through `HMEM_IMPL`, `WORLD_MODEL_IMPL` and `MARKOVIAN_IMPL`. They check spec invariants (feedback deltas, ranking order, sleep guardrails, stable ids, merge bands, provenance, idempotency, bitemporal edges, config bounds, marker protocol). H-MEM runs with Upstream's pharmacy embedder installed. World Model conformance uses in-memory storage, so it does not exercise our deferred-persistence patch; `src/engines/test/world-model.test.ts` does.
- **Scout Intent**: the Meterless eval harness, unmodified, with its own CRM fixture registry and 32-example v1 corpus. Every intent-labelled prompt in that corpus also appears verbatim in the fixture registry's examples, so a lexical scorer is expected to score 1.0; the harness also never compares clarification, non-block risk or multi-intent expectations, and never exercises signing, expiry or scope enforcement. Treat a PASS as "the plumbing is spec-shaped", not as a quality claim. Our own measurements are in `src/engines/results/` (pharmacy eval with a held-out split, the harness's unscored expectations, and contract tests).
