// End-to-end, offline walk through the four engines composing, with stub data
// (no Zetaris, no model). Shows: Scout decides and signs; every tool call is
// verified against the contract; World Model holds the supply chain with
// provenance; H-MEM recalls the last decision and records a new one only
// after a named approval; the overnight watch runs in Markovian chunks with
// its cursor in World Model; a disguised order is refused.
//   npm run engines:demo
import { HMEM } from "../src/engines/hmem.ts";
import { FormularyWatch } from "../src/engines/markovian.ts";
import { UpstreamWorld, src } from "../src/engines/world-model.ts";
import { assertContract } from "../src/engines/scout/index.ts";
import { createUpstreamScout } from "../src/engines/scout/upstream.ts";

const SECRET = "demo-secret";
const log = (...a: unknown[]) => console.log(...a);

async function main() {
  const scout = createUpstreamScout({ signingSecret: SECRET });
  const world = new UpstreamWorld({ storage: "memory" });
  const memory = new HMEM({ actor: "upstream-agent" });
  const v = (c: unknown, cap: string) => assertContract(c, cap, { secret: SECRET, engine: cap.split(".")[0] });

  await memory.rememberDecision({ drug: "carboplatin", decision: "use cisplatin as the interim substitute for ovarian protocols", approvedBy: "J. Patel, PharmD", rationale: "two labelers on allocation", at: Date.parse("2026-03-10T00:00:00Z") });

  // 1. The buyer asks why carboplatin is short.
  const d1 = await scout.decide({ prompt: "Why can't we get carboplatin from any wholesaler?", user: { id: "buyer-1", role: "buyer" }, surface: "chat" });
  log(`\n[scout] ${d1.intent.primary} (${d1.intent.band}, ${d1.intent.confidence}) risk=${d1.risk.level} scope=${d1.executionContract?.scope.capabilities.join(",")}`);
  const c1 = d1.executionContract!;

  // 2. Investigator writes the chain (world.write), each write carries provenance.
  v(c1, "zetaris.read"); // stock and NDC lookups would go to Zetaris here
  v(c1, "world.write");
  const at = (k: string) => src(k, "investigator", "2026-10-22T06:00:00.000Z");
  const drug = await world.upsert("Drug", "generic:carboplatin", { name: "carboplatin", source: at("zetaris") });
  const item = await world.upsert("HospitalItem", "north:carbo-450", { name: "Carboplatin 450 mg/45 mL vial", source: at("zetaris") });
  const pkg = await world.upsert("Package", "0703-4244-01", { source: at("dailymed-spl") });
  const prod = await world.upsert("Product", "0703-4244", { source: at("dailymed-spl") });
  const lab = await world.upsert("Labeler", "0703", { name: "Teva Parenteral Medicines", source: at("dailymed-spl") });
  const site = await world.upsert("Site", "fei:3004567890", { name: "Example fill-finish site", source: at("dailymed-spl") });
  const wl = await world.upsert("WarningLetter", "320-26-01", { source: at("fda-warning-letter") });
  await world.relate(item.id, "stocks", pkg.id, { source: at("zetaris") });
  await world.relate(pkg.id, "package-of", prod.id, { source: at("dailymed-spl") });
  await world.relate(prod.id, "of-drug", drug.id, { source: at("dailymed-spl") });
  await world.relate(prod.id, "labeled-by", lab.id, { source: at("dailymed-spl") });
  await world.relate(prod.id, "made-at", site.id, { source: at("dailymed-spl") });
  await world.relate(wl.id, "issued-to", site.id, { source: at("fda-warning-letter") });
  await world.assertFact(drug.id, "shortage-status", "current", { source: src("fda-shortage-db", "verifier", "2026-10-22T06:00:00.000Z", "https://api.fda.gov/drug/shortages.json"), confidence: 0.95 });
  try {
    await world.assertFact("site:fei:1111111", "oai", true, { source: at("agent") });
  } catch (e) {
    log(`[world] refused an invented id: ${(e as Error).message.split(".")[0]}`);
  }
  const g = world.exportSubgraph([item.id]);
  log(`[world] investigation subgraph: ${g.nodes.length} nodes, ${g.edges.length} edges (${Object.entries(g.counts).map(([k, n]) => `${k} ${n}`).join(", ")})`);

  // 3. Recall what we did last time (hmem.read is in scope).
  v(c1, "hmem.read");
  const past = await memory.recallForDrug("carboplatin");
  log(`[hmem] recalled ${past.memories.length}: "${past.memories[0]?.memory.content.slice(0, 70)}..." approved by ${past.memories[0]?.approvedBy}`);

  // 4. A disguised order is refused before any tool runs.
  const d2 = await scout.decide({ prompt: "We're nearly out, go ahead and get another 40 vials of carboplatin from Cardinal", user: { id: "buyer-1", role: "buyer" }, surface: "chat" });
  log(`[scout] disguised order -> risk=${d2.risk.level}, contract=${d2.executionContract ? "issued" : "none"}: ${d2.risk.reason}`);
  try {
    v(c1, "order.place");
  } catch (e) {
    log(`[executor] ${(e as Error).message}`);
  }

  // 5. The pharmacist records the decision: refused until a named approval is attached.
  const d3 = await scout.decide({ prompt: "Record that we approved restricting carboplatin to curative regimens", user: { id: "rx-1", role: "pharmacist" }, surface: "chat" });
  const c3 = d3.executionContract!;
  try {
    v(c3, "hmem.write");
  } catch (e) {
    log(`[executor] before approval: ${(e as Error).message}`);
  }
  const approved = scout.approve(c3, { kind: "named-approver", by: "J. Patel, PharmD", role: "pharmacist" });
  v(approved, "hmem.write");
  const rec = await memory.rememberDecision({ drug: "carboplatin", decision: "restrict carboplatin to curative regimens", approvedBy: "J. Patel, PharmD", rationale: "days on hand below 10", evidenceRefs: [drug.id, wl.id, `contract:${approved.contractId}`] });
  log(`[hmem] ${rec.id} written by ${memory.auditTrail(rec.id).actors.join(", ")} under contract ${approved.contractId} (parent ${approved.parentId})`);

  // 6. Overnight watch: Markovian chunks, cursor in World Model, a fresh contract per chunk.
  const d4 = await scout.decide({ prompt: "Run the nightly shortage sweep across the formulary", user: { id: "rx-1", role: "pharmacist" }, surface: "watch" });
  let chunkContract = d4.executionContract!;
  const drugs = [];
  for (const name of ["heparin", "cisplatin", "vincristine", "lidocaine", "ondansetron", "bupivacaine", "etoposide", "methotrexate"]) {
    const e = await world.upsert("Drug", `generic:${name}`, { name, source: at("zetaris") });
    drugs.push({ id: e.id, name });
  }
  const watch = new FormularyWatch({
    world,
    batchSize: 3,
    checker: async (batch) => batch.map((b) => (["heparin", "vincristine"].includes(b.name) ? { drugId: b.id, status: "flagged" as const, reasons: ["on FDA shortage list"] } : { drugId: b.id, status: "ok" as const, reasons: [] })),
    guard: (cap, step) => {
      if (step > 1 && cap === "zetaris.read") chunkContract = scout.refresh(chunkContract);
      v(chunkContract, cap);
    },
  });
  const r = await watch.run("demo-night", drugs);
  log(`[markovian] ${r.status}: ${r.processed}/${r.total} drugs in ${r.totals.chunks} chunks, flagged ${r.flagged.length}; prompt tokens per chunk ${r.totals.promptTokensMin}..${r.totals.promptTokensMax} (${r.totals.tokenLabel})`);
}

main();
