import { test } from "node:test";
import assert from "node:assert/strict";
import { FormularyWatch, type DrugChecker, type WatchDrug } from "../markovian.ts";
import { UpstreamWorld, idFor, src } from "../world-model.ts";

async function formulary(w: UpstreamWorld, n: number): Promise<WatchDrug[]> {
  const out: WatchDrug[] = [];
  for (let i = 0; i < n; i++) {
    const name = `drug-${String(i).padStart(3, "0")}`;
    const e = await w.upsert("Drug", `generic:${name}`, { name, source: src("zetaris", "loader", "2026-10-01T00:00:00.000Z") });
    out.push({ id: e.id, name });
  }
  await w.flush();
  return out;
}

const flagEvery7: DrugChecker = async (batch) =>
  batch.map((d) => {
    const i = Number(d.name.split("-")[1]);
    return i % 7 === 0 ? { drugId: d.id, status: "flagged" as const, reasons: ["listed on FDA shortage list"] } : { drugId: d.id, status: "ok" as const, reasons: [] };
  });

test("watch completes over 70 drugs; cursor, findings and flags live in World Model", async () => {
  const world = new UpstreamWorld({ storage: "memory" });
  const drugs = await formulary(world, 70);
  const watch = new FormularyWatch({ world, checker: flagEvery7 });
  const r = await watch.run("w1", drugs);
  assert.equal(r.status, "completed");
  assert.equal(r.processed, 70);
  assert.equal(r.batchSize, 3, "ceil(70 / 32)");
  assert.equal(r.flagged.length, 10);
  const st = watch.state("w1")!;
  assert.equal(st.cursor, 70);
  assert.equal(st.status, "completed");
  const f = world.facts(drugs[7].id).find((x) => x.predicate === "watch-status")!;
  assert.deepEqual((f.value as { status: string }).status, "flagged");
  assert.equal(f.source.kind, "agent");
  // prompts stay flat: continuation prompts carry the checkpoint, never the drug list
  const cont = r.chunks.slice(1).map((c) => c.promptTokens.value);
  assert.ok(Math.max(...cont) - Math.min(...cont) <= 10, `continuation prompt size should be flat, got ${Math.min(...cont)}..${Math.max(...cont)}`);
  assert.ok(r.chunks.every((c) => c.promptTokens.label === "estimated"));
  assert.ok(!r.chunks.some((c) => c.promptChars > 2000));
});

test("more drugs than one run's 32-chunk cap: runs are chained from the World Model cursor", async () => {
  const world = new UpstreamWorld({ storage: "memory" });
  const drugs = await formulary(world, 100);
  const r = await new FormularyWatch({ world, checker: flagEvery7, batchSize: 2 }).run("w2", drugs);
  assert.equal(r.status, "completed");
  assert.equal(r.chunks.length, 50);
  assert.equal(r.markovianRuns.length, 2);
  assert.equal(r.markovianRuns[0].status, "max-chunks");
  assert.equal(r.markovianRuns[0].chunks, 32);
});

test("a crash mid-watch resumes from World Model without re-checking drugs", async () => {
  const world = new UpstreamWorld({ storage: "memory" });
  const drugs = await formulary(world, 30);
  const seen: string[] = [];
  let calls = 0;
  const flaky: DrugChecker = async (batch, ctx) => {
    calls++;
    if (calls === 3) throw new Error("Zetaris timeout");
    seen.push(...batch.map((b) => b.id));
    return flagEvery7(batch, ctx);
  };
  const watch = new FormularyWatch({ world, checker: flaky, batchSize: 5 });
  const first = await watch.run("w3", drugs);
  assert.equal(first.status, "errored");
  assert.match(first.error!, /Zetaris timeout/);
  assert.equal(watch.state("w3")!.cursor, 10);
  // a fresh process: different instance, empty drug list argument; the stored list wins
  const second = await new FormularyWatch({ world, checker: flaky, batchSize: 5 }).run("w3", []);
  assert.equal(second.status, "completed");
  assert.equal(second.resumedFrom, 10);
  assert.equal(new Set(seen).size, 30);
  assert.equal(seen.length, 30, "no drug checked twice");
});

test("guard refusal (e.g. a Scout contract check) stops the watch before any tool call", async () => {
  const world = new UpstreamWorld({ storage: "memory" });
  const drugs = await formulary(world, 10);
  let checked = 0;
  const r = await new FormularyWatch({
    world,
    checker: async (b, c) => {
      checked += b.length;
      return flagEvery7(b, c);
    },
    batchSize: 5,
    guard: (cap, step) => {
      if (step === 2 && cap === "zetaris.read") throw new Error("contract refused: expired");
    },
  }).run("w4", drugs);
  assert.equal(r.status, "errored");
  assert.equal(checked, 5);
});

test("checker findings may only cite known World Model ids", async () => {
  const world = new UpstreamWorld({ storage: "memory" });
  const drugs = await formulary(world, 3);
  const r = await new FormularyWatch({
    world,
    checker: async (b) => b.map((d) => ({ drugId: d.id, status: "flagged" as const, reasons: ["x"], evidenceIds: ["recall:fda-recall:D-9999-2026"] })),
  }).run("w5", drugs);
  assert.equal(r.status, "errored");
  assert.match(r.error!, /unknown entity/);
});

test("provider usage is reported as measured", async () => {
  const world = new UpstreamWorld({ storage: "memory" });
  const drugs = await formulary(world, 4);
  const r = await new FormularyWatch({
    world,
    checker: flagEvery7,
    batchSize: 2,
    generator: async (i) => ({ text: `checked ${i.batch.length}`, usage: { promptTokens: 123, completionTokens: 7 } }),
  }).run("w6", drugs);
  assert.equal(r.totals.tokenLabel, "measured");
  assert.equal(r.totals.promptTokens, 246);
  assert.equal(world.entity(idFor("WatchRun", "w6"))!.attrs.status, "completed");
});
