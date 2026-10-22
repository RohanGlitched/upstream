# Vendored Meterless engines

- **Source:** https://github.com/Meterless/Meterless
- **Commit:** `1742dec56a66e58eef9dda2d2b865823758ca8cd`
- **Copied:** 22 Oct 2026
- **Licence:** Apache-2.0. The licence text is in [LICENSE](LICENSE). The upstream repository has no NOTICE file.

## Contents
For H-MEM, World Model and Markovian we copied `reference/src`, `reference/test`, `reference/package.json`, `reference/tsconfig.json`, `conformance/` and `AGENTS.md`.

Scout Intent upstream is a specification with an eval harness and no code. We copied `evals/`, `package.json`, `AGENTS.md` and `docs/*.md`. Our implementation is in `src/engines/scout/` and is our own code.

## Our modifications
Each modified file carries a one-line `// Modified by Upstream (2026-10-22): ...` header. All three engines still pass their unmodified conformance suites against Upstream's modules (see `CONFORMANCE.md` at the repo root).

| File | Change | Why |
|---|---|---|
| `world-model/reference/src/store.ts` | Optional `persistMode: "deferred"`: `persist()` only marks the store dirty; new `flush()` writes once; `isDirty()`; a `writes` counter. Default (`"immediate"`) is the original behaviour. | The reference rewrote the whole pretty-printed file on every event and audit line (O(n^2)). Measured on this machine: 300 drugs / 1,200 writes took 29.2 s and 2,700 file writes immediate, 0.1 s and 1 write deferred (`src/engines/results/world-persist-bench.json`). |
| `world-model/reference/src/types.ts` | `WorldModelOptions.persist` (`"immediate"` or `"deferred"`). | Option plumbing for the above. |
| `world-model/reference/src/index.ts` | Passes `opts.persist` to the store; adds `flush()` (queued behind pending writes) and `persistWrites()`. | Public surface for the above. |
| `hmem/reference/src/embeddings.ts` | `embed()` delegates to a swappable embedder (`setEmbedder`, `activeEmbedder`, `EmbedderImpl`); the original FNV-1a 64-dim embedder is kept as `hashEmbed` and remains the default; `cosine()` iterates over the shorter vector. | Lets Upstream install a better local embedder (and later a remote one) without forking retrieval; guards against mixed-dimension vectors. |
| `hmem/reference/src/index.ts` | Re-exports `setEmbedder`, `activeEmbedder`, `hashEmbed` and the `EmbedderImpl` type. | Public surface for the above. |

Not modified: every conformance runner, vector file, test, AGENTS.md and the Scout Intent harness. Running the Scout harness rewrites `scout-intent/evals/reports/latest.md`; `scripts/run-conformance.mjs` restores the vendored copy afterwards and saves the generated report to `src/engines/results/scout-harness-report.md`.
