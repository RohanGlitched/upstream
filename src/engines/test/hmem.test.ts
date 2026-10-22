import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HMEM,
  RECALL_THRESHOLD,
  activeEmbedder,
  cachedEmbedder,
  hashEmbed,
  openAICompatibleEmbedder,
  pharmaEmbedder,
  setEmbedder,
} from "../hmem.ts";
import { DAY, DECISIONS, INVESTIGATIONS, QUERIES, T0 } from "./fixtures/hmem-calibration.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "upstream-hmem-"));
const carbo = { drug: "carboplatin", decision: "use cisplatin as the interim substitute", approvedBy: "J. Patel, PharmD", rationale: "FDA shortage", ndcs: ["0703-4244-01"], evidenceRefs: ["fda-shortage:carboplatin"] };

test("pharmaEmbedder is installed process-wide by importing hmem.ts", () => {
  assert.equal(activeEmbedder().id, pharmaEmbedder.id);
  assert.equal(pharmaEmbedder.embed("carboplatin shortage").length, 256);
});

test("supersede links both directions, sends wrong feedback, and recall drops the old record", async () => {
  const mem = new HMEM({ clock: () => T0 });
  const old = await mem.rememberDecision(carbo);
  const before = old.confidence;
  const { old: o, replacement: r } = await mem.reviseDecision(old.id, { ...carbo, decision: "revoked: cisplatin substitution stopped, use carboplatin from the Mercy West transfer", approvedBy: "S. Lee, Director of Pharmacy" });
  assert.equal(r.supersedes, old.id);
  assert.equal(o.supersededBy, r.id);
  assert.ok(Math.abs(o.confidence - (before - 0.2)) < 1e-9, "wrong feedback subtracts 0.20");
  assert.ok(o.tags.includes("review"));
  const recall = await mem.recallForDrug("carboplatin");
  assert.deepEqual(recall.memories.map((m) => m.memory.id), [r.id], "superseded record is dropped by default");
  assert.ok(!recall.context.includes(`<${old.id}>`));
  const withOld = await mem.recallForDrug("carboplatin", { includeSuperseded: true });
  const oldRow = withOld.memories.find((m) => m.memory.id === old.id)!;
  assert.equal(oldRow.superseded, true);
  assert.equal(oldRow.supersededBy, r.id);
  assert.ok(withOld.memories[0].memory.id === r.id, "replacement outranks the revoked decision");
  assert.throws(() => mem.supersede(old.id, { content: "x", source: "y" }), /already superseded/);
  assert.throws(() => mem.supersede("mem-999", { content: "x", source: "y" }), /unknown memory/);
});

test("the reference add({supersedes}) alone does not mark the old record (pitfall reproduced)", () => {
  const mem = new HMEM({ clock: () => T0 });
  const a = mem.add({ content: "approved carboplatin substitution", source: "t" });
  mem.add({ content: "revoked carboplatin substitution", source: "t", supersedes: a.id });
  assert.equal(mem.store.get(a.id)!.supersededBy, undefined);
});

test("per-approver attribution: ledger actor, provenance label and refs", async () => {
  const mem = new HMEM({ clock: () => T0, actor: "upstream-agent" });
  const d = await mem.rememberDecision(carbo);
  const create = mem.ledger.history(d.id).find((e) => e.action === "create")!;
  assert.equal(create.actor, "J. Patel, PharmD");
  assert.equal(d.provenance.label, "Decision approved by J. Patel, PharmD");
  assert.ok(d.provenance.refs!.includes("approver:J. Patel, PharmD"));
  assert.ok(d.provenance.refs!.includes("ndc:0703-4244-01"));
  mem.forActor("S. Lee").feedback(d.id, "helpful");
  const fb = mem.ledger.history(d.id).find((e) => e.action === "feedback")!;
  assert.equal(fb.actor, "S. Lee");
  // the default actor is restored after a scoped write
  const plain = mem.add({ content: "note", source: "t" });
  assert.equal(mem.ledger.history(plain.id)[0].actor, "upstream-agent");
  const trail = mem.auditTrail(d.id);
  assert.deepEqual(trail.actors.sort(), ["J. Patel, PharmD", "S. Lee"]);
  assert.equal(trail.approvedBy, "J. Patel, PharmD");
});

test("a decision without a named approver is rejected", async () => {
  const mem = new HMEM({ clock: () => T0 });
  await assert.rejects(() => mem.rememberDecision({ ...carbo, approvedBy: "  " }), /named human approver/);
});

test("plain-word tags match query tokens", async () => {
  const mem = new HMEM({ clock: () => T0 });
  const d = await mem.rememberDecision({ ...carbo, drug: "Sodium Bicarbonate 8.4%" });
  assert.ok(d.tags.includes("sodium") && d.tags.includes("bicarbonate") && d.tags.includes("decision"));
  assert.ok(!d.tags.some((t) => t.includes(":")), "no prefixed tags like drug:x");
});

test("auditTrail collapses reads and follows the supersede chain", async () => {
  const mem = new HMEM({ clock: () => T0 });
  const a = await mem.rememberDecision(carbo);
  const b = (await mem.reviseDecision(a.id, { ...carbo, decision: "second" })).replacement;
  const c = (await mem.reviseDecision(b.id, { ...carbo, decision: "third" })).replacement;
  await mem.recallForDrug("carboplatin");
  await mem.recallForDrug("carboplatin");
  const t = mem.auditTrail(c.id);
  assert.deepEqual(t.supersedes, [b.id, a.id]);
  assert.equal(t.reads, 2);
  assert.ok(t.entries.every((e) => e.action !== "read"));
  assert.deepEqual(mem.auditTrail(a.id).supersededBy, [b.id, c.id]);
});

test("recall threshold calibration: Upstream recall finds every labelled decision; reference default finds few", async () => {
  const mem = new HMEM({ clock: () => T0 + DAY });
  const keyOf: Record<string, string> = {};
  for (const d of DECISIONS) keyOf[(await mem.rememberDecision(d)).id] = d.key;
  for (const i of INVESTIGATIONS) keyOf[(await mem.rememberInvestigation(i)).id] = i.key;
  let found = 0, total = 0, rawFound = 0;
  for (const q of QUERIES) {
    const r = await mem.recall(q.q);
    const keys = r.memories.map((m) => keyOf[m.memory.id]);
    if (!q.relevant.length) {
      assert.equal(keys.length, 0, `distractor "${q.q}" should return nothing, got ${keys}`);
      continue;
    }
    total += q.relevant.length;
    found += q.relevant.filter((k) => keys.includes(k)).length;
    rawFound += mem.query(q.q).memories.filter((m) => q.relevant.includes(keyOf[m.memory.id])).length;
  }
  assert.equal(RECALL_THRESHOLD, 0.25);
  assert.ok(found / total >= 0.9, `recall ${found}/${total}`);
  assert.ok(rawFound < found, `reference default threshold should find fewer (${rawFound} vs ${found})`);
});

test("persistence: reload from disk keeps records, ledger and embedder metadata", async () => {
  const dir = tmp();
  const a = new HMEM({ clock: () => T0, persistDir: dir });
  const d = await a.rememberDecision(carbo);
  const b = new HMEM({ clock: () => T0, persistDir: dir });
  assert.equal(b.store.get(d.id)!.content, d.content);
  assert.equal(b.ledger.history(d.id)[0].actor, "J. Patel, PharmD");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "embedder.json"), "utf-8")).id, pharmaEmbedder.id);
});

test("switching embedders re-embeds persisted records", async () => {
  const dir = tmp();
  const a = new HMEM({ clock: () => T0, persistDir: dir });
  const d = await a.rememberDecision(carbo);
  assert.equal(a.store.get(d.id)!.embedding.length, 256);
  try {
    const b = new HMEM({ clock: () => T0, persistDir: dir, embedder: { id: "fnv1a-64", dim: 64, embed: hashEmbed } });
    assert.equal(b.store.get(d.id)!.embedding.length, 64);
  } finally {
    setEmbedder(pharmaEmbedder);
  }
});

test("cachedEmbedder refuses unprimed text and works once primed; the OpenAI-compatible adapter calls /embeddings", async () => {
  const calls: { url: string; body: { input: string[]; model: string } }[] = [];
  const fakeFetch = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    return { ok: true, status: 200, json: async () => ({ data: body.input.map((t: string, i: number) => ({ index: i, embedding: [t.length, 1, 0, 0] })) }) };
  }) as unknown as typeof fetch;
  const remote = openAICompatibleEmbedder({ model: "nvidia/test-embed", dim: 4, apiKey: "test", fetchFn: fakeFetch });
  const cached = cachedEmbedder(remote);
  assert.throws(() => cached.embed("not primed"), /not primed/);
  await cached.prime(["hello", "hello", "world!"]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/embeddings"));
  assert.deepEqual(calls[0].body.input, ["hello", "world!"]);
  const v = cached.embed("hello");
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9, "vectors are normalised");
  try {
    const mem = new HMEM({ clock: () => T0 });
    await mem.useEmbedder(cached);
    const d = await mem.rememberDecision(carbo);
    assert.equal(d.embedding.length, 4);
    const r = await mem.recall("carboplatin", { threshold: 0 });
    assert.ok(r.memories.length >= 1);
  } finally {
    setEmbedder(pharmaEmbedder);
  }
});
