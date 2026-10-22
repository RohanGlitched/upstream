import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InvalidKeyError, UnknownEntityError, UpstreamWorld, WorldModel, idFor, src } from "../world-model.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "upstream-world-"));
const at = (d: string) => src("dailymed-spl", "investigator", `${d}T00:00:00.000Z`);
const mem = () => new UpstreamWorld({ storage: "memory" });

async function seed(w: UpstreamWorld) {
  const drug = await w.upsert("Drug", "generic:carboplatin", { name: "carboplatin injection", source: at("2026-10-01") });
  const lab = await w.upsert("Labeler", "0703", { name: "Teva Parenteral", source: at("2026-10-01") });
  const prod = await w.upsert("Product", "0703-4244", { name: "Carboplatin 10 mg/mL", source: at("2026-10-01") });
  const pkg = await w.upsert("Package", "0703-4244-01", { source: at("2026-10-01") });
  const item = await w.upsert("HospitalItem", "north:carbo-450", { name: "Carboplatin 450 mg vial", source: src("zetaris", "investigator", "2026-10-01T00:00:00.000Z") });
  const siteA = await w.upsert("Site", "fei:3004567890", { name: "Site A", source: at("2026-10-01") });
  const siteB = await w.upsert("Site", "duns:123456789", { name: "Site B", source: at("2026-10-01") });
  const insp = await w.upsert("Inspection", "1234567", { attrs: { classification: "OAI" }, source: src("fda-inspection", "verifier", "2026-10-02T00:00:00.000Z") });
  const wl = await w.upsert("WarningLetter", "320-26-01", { source: src("fda-warning-letter", "verifier", "2026-10-02T00:00:00.000Z") });
  const ia = await w.upsert("ImportAlert", "66-40", { source: src("fda-import-alert", "verifier", "2026-10-02T00:00:00.000Z") });
  const rc = await w.upsert("Recall", "D-0123-2026", { source: src("fda-recall", "verifier", "2026-10-02T00:00:00.000Z") });
  const sh = await w.upsert("Shortage", "carboplatin-injection", { source: src("fda-shortage-db", "verifier", "2026-10-02T00:00:00.000Z") });
  await w.relate(item.id, "stocks", pkg.id, { source: at("2026-10-01") });
  await w.relate(pkg.id, "package-of", prod.id, { source: at("2026-10-01") });
  await w.relate(prod.id, "of-drug", drug.id, { source: at("2026-10-01") });
  await w.relate(prod.id, "labeled-by", lab.id, { source: at("2026-10-01") });
  await w.relate(prod.id, "made-at", siteA.id, { source: at("2026-10-01") });
  await w.relate(prod.id, "made-at", siteB.id, { source: at("2026-10-01") });
  await w.relate(insp.id, "inspected", siteA.id, { source: at("2026-10-02") });
  await w.relate(wl.id, "issued-to", siteA.id, { source: at("2026-10-02") });
  await w.relate(ia.id, "lists", siteB.id, { source: at("2026-10-02") });
  await w.relate(rc.id, "recalls", pkg.id, { source: at("2026-10-02") });
  await w.relate(sh.id, "affects", drug.id, { source: at("2026-10-02") });
  return { drug, lab, prod, pkg, item, siteA, siteB, insp, wl, ia, rc, sh };
}

test("ids are external keys only and validated", async () => {
  const w = mem();
  assert.equal(idFor("Package", "0409-1234-01"), "package:ndc-package:0409-1234-01");
  assert.equal(idFor("Site", "fei:3004567890"), "site:fei:3004567890");
  assert.throws(() => idFor("Package", "0409-1234"), InvalidKeyError);
  assert.throws(() => idFor("Labeler", "Pfizer"), InvalidKeyError);
  assert.throws(() => idFor("Site", "3004567890"), InvalidKeyError, "multi-system types need system:id");
  await assert.rejects(() => w.upsert("Product", "not-an-ndc", { source: at("2026-10-01") }), InvalidKeyError);
});

test("similar labeler names never merge (external keys bypass the 0.85 name resolver)", async () => {
  const w = mem();
  const a = await w.upsert("Labeler", "63323", { name: "Fresenius Kabi USA LLC", source: at("2026-10-01") });
  const b = await w.upsert("Labeler", "65219", { name: "Fresenius Kabi USA, LLC", source: at("2026-10-01") });
  assert.notEqual(a.id, b.id);
  assert.equal(w.query("Labeler").length, 2);
});

test("requireKnown: assertFact and relate on unknown ids throw (the raw engine silently accepts them)", async () => {
  const w = mem();
  const { drug } = await seed(w);
  await assert.rejects(() => w.assertFact("drug:generic:made-up-drug", "shortage-status", "current", { source: at("2026-10-03") }), UnknownEntityError);
  await assert.rejects(() => w.relate(drug.id, "affects", "shortage:fda-shortage:invented", { source: at("2026-10-03") }), UnknownEntityError);
  assert.throws(() => w.requireKnown(["site:fei:9999999"]), UnknownEntityError);
  assert.deepEqual(w.checkCitations([drug.id, "site:fei:9999999"]), { known: [drug.id], unknown: ["site:fei:9999999"] });
  // contrast: the vendored engine has no referential integrity
  const raw = new WorldModel({ namespace: "raw", storage: "memory" });
  await raw.assertFact({ about: "drug:generic:made-up-drug", predicate: "x", value: 1, source: { kind: "agent", at: "2026-10-03T00:00:00Z" } });
  assert.equal(raw.view("graph").entity("drug:generic:made-up-drug")?.state, "emerging");
});

test("relation schema: endpoint types are enforced", async () => {
  const w = mem();
  const { drug, siteA } = await seed(w);
  await assert.rejects(() => w.relate(drug.id, "made-at", siteA.id, { source: at("2026-10-03") }), /must go Product -> Site/);
});

test("many-valued relations keep every target open; one-valued relations supersede", async () => {
  const w = mem();
  const { prod, pkg, siteA, siteB } = await seed(w);
  const sites = w.neighbors(prod.id, "made-at").map((e) => e.id).sort();
  assert.deepEqual(sites, [siteB.id, siteA.id].sort(), "a product made at two sites keeps both edges open");
  const prod2 = await w.upsert("Product", "0703-4245", { source: at("2026-10-05") });
  await w.relate(pkg.id, "package-of", prod2.id, { source: at("2026-10-05"), validFrom: "2026-10-05T00:00:00.000Z" });
  assert.deepEqual(w.neighbors(pkg.id, "package-of").map((e) => e.id), [prod2.id], "the newer package-of edge closes the old one");
  assert.deepEqual(w.neighbors(pkg.id, "package-of", "2026-10-03T00:00:00.000Z").map((e) => e.id), [prod.id], "point-in-time view still sees the old edge");
});

test("facts keep provenance and source-priority picks the FDA value", async () => {
  const w = mem();
  const { drug } = await seed(w);
  await w.assertFact(drug.id, "shortage-status", "resolved", { source: src("agent", "investigator", "2026-10-04T00:00:00.000Z") });
  await w.assertFact(drug.id, "shortage-status", "current", { source: src("fda-shortage-db", "verifier", "2026-10-03T00:00:00.000Z", "https://api.fda.gov/drug/shortages.json") });
  assert.equal(w.entity(drug.id)!.attrs["shortage-status"], "current");
  assert.equal(w.facts(drug.id).length, 2);
  assert.equal(w.facts(drug.id, { current: true }).length, 1);
});

test("deferred persistence: nothing on disk before flush, one write per flush, reload is identical", async () => {
  const dir = tmp();
  const file = path.join(dir, ".world", "t.json");
  const w = new UpstreamWorld({ namespace: "t", storage: "local", directory: dir, persist: "deferred" });
  await seed(w);
  assert.equal(fs.existsSync(file), false, "deferred mode must not write before flush");
  assert.equal(w.persistWrites(), 0);
  assert.equal(await w.flush(), true);
  assert.equal(w.persistWrites(), 1);
  assert.equal(await w.flush(), false, "a clean store does not rewrite");
  const shape = w.stateShapeCanonical();
  const reloaded = new UpstreamWorld({ namespace: "t", storage: "local", directory: dir, persist: "deferred" });
  assert.equal(reloaded.stateShapeCanonical(), shape);
  assert.equal(reloaded.audit().length, w.audit().length);
  // writes after a flush are not on disk until the next flush
  await w.upsert("Labeler", "12345", { source: at("2026-10-06") });
  const again = new UpstreamWorld({ namespace: "t", storage: "local", directory: dir });
  assert.equal(again.known(idFor("Labeler", "12345")), false);
  await w.flush();
  const third = new UpstreamWorld({ namespace: "t", storage: "local", directory: dir });
  assert.equal(third.known(idFor("Labeler", "12345")), true);
});

test("immediate mode (reference behaviour) rewrites the file on every mutation", async () => {
  const dir = tmp();
  const w = new UpstreamWorld({ namespace: "i", storage: "local", directory: dir, persist: "immediate" });
  await seed(w);
  assert.ok(w.persistWrites() > 40, `expected one write per event and audit line, got ${w.persistWrites()}`);
});

test("exportSubgraph follows the investigation shape and does not leak through shared sites", async () => {
  const w = mem();
  const s = await seed(w);
  // an unrelated product made at the same site must not appear
  const other = await w.upsert("Product", "0409-9999", { name: "Unrelated", source: at("2026-10-01") });
  await w.relate(other.id, "made-at", s.siteA.id, { source: at("2026-10-01") });
  const g = w.exportSubgraph([s.item.id]);
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of [s.item, s.pkg, s.prod, s.drug, s.lab, s.siteA, s.siteB, s.insp, s.wl, s.ia, s.rc, s.sh]) assert.ok(ids.has(e.id), `missing ${e.id}`);
  assert.ok(!ids.has(other.id), "unrelated product leaked through the shared site");
  assert.ok(g.edges.every((e) => ids.has(e.from) && ids.has(e.to)));
  assert.equal(g.counts.Site, 2);
  assert.equal(g.nodes.find((n) => n.id === s.item.id)!.depth, 0);
  assert.throws(() => w.exportSubgraph(["drug:generic:nope"]), UnknownEntityError);
});
