// Upstream's World Model layer: the shared, provenance-carrying graph of the
// drug supply chain, built on the vendored Meterless World Model reference
// (vendor/meterless/world-model, Apache-2.0, commit 1742dec).
//
// Rules this wrapper enforces (research/METERLESS.md section 6):
//   * External keys only (pitfall 10). Every entity is keyed by a regulatory
//     identifier: NDC labeler code, product NDC, package NDC, FEI, DUNS,
//     inspection id, warning-letter id, import-alert number, recall number,
//     shortage id, hospital item id. Name-keyed upserts are impossible here,
//     so the engine's 0.85 Levenshtein auto-merge can never collapse two
//     labelers with similar names.
//   * requireKnown() (pitfall 9). The engine has no referential integrity:
//     assertFact on an unknown id silently creates an "emerging" entity and
//     relate() to a missing id succeeds. Here both throw UnknownEntityError,
//     so an agent cannot cite an id it invented.
//   * Relation schema. Each relation type declares allowed endpoint types and
//     a cardinality. Engine edges are functional: a new edge with the same
//     (from, type, context) and a different target CLOSES the previous one
//     (bitemporal supersession). That is right for "package-of" but wrong for
//     "product made-at site" (a product can have several sites), so
//     many-valued relations get a per-target context key ("fanout:<to>").
//   * Deferred persistence (pitfall 11). The reference rewrote the whole
//     pretty-printed file on every write (O(n^2)); the vendored store was
//     patched with persist: "deferred" + flush(). Call flush() at the end of
//     each batch; nothing reaches disk before that.
//
// The module also re-exports the engine (WorldModel, entityIdFromName,
// normalizeName, decide, ...) because the Meterless conformance runner loads
// this file; UpstreamWorld composes that same class.

import {
  WorldModel,
  externalId,
  type Entity,
  type Fact,
  type Provenance,
  type Relationship,
  type WorldEvent,
  type WorldModelOptions,
} from "../../vendor/meterless/world-model/reference/src/index.ts";
import { stateDir } from "./text.ts";

export * from "../../vendor/meterless/world-model/reference/src/index.ts";

// ------------------------------------------------------------------ schema

export type EntityType =
  | "Drug" | "Product" | "Package" | "Labeler" | "Site" | "Inspection"
  | "WarningLetter" | "ImportAlert" | "Recall" | "Shortage" | "HospitalItem"
  /** Upstream bookkeeping: one overnight-watch run (cursor, totals, status live here, not in prompts). */
  | "WatchRun";

interface KeySpec {
  /** engine type string (lowercase, used in ids: "<type>:<system>:<id>") */
  engineType: string;
  /** allowed key systems -> validator. Multi-system types take "system:id" keys. */
  systems: Record<string, RegExp>;
  describe: string;
}

const NDC_PRODUCT = /^(\d{4}-\d{4}|\d{5}-\d{3}|\d{5}-\d{4})$/;
const NDC_PACKAGE = /^(\d{4}-\d{4}-\d{2}|\d{5}-\d{3}-\d{2}|\d{5}-\d{4}-\d{1}|\d{5}-\d{4}-\d{2})$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export const ENTITY_KEYS: Record<EntityType, KeySpec> = {
  Drug: { engineType: "drug", systems: { rxnorm: /^\d{1,10}$/, generic: /^[a-z0-9][a-z0-9 .%/,-]{0,99}$/ }, describe: "rxnorm:<RxCUI> or generic:<lowercase generic name>" },
  Product: { engineType: "product", systems: { "ndc-product": NDC_PRODUCT }, describe: "product NDC labeler-product, e.g. 0409-1234" },
  Package: { engineType: "package", systems: { "ndc-package": NDC_PACKAGE }, describe: "package NDC, e.g. 0409-1234-01" },
  Labeler: { engineType: "labeler", systems: { "ndc-labeler": /^\d{4,5}$/ }, describe: "NDC labeler code (4-5 digits)" },
  Site: { engineType: "site", systems: { fei: /^\d{7,10}$/, duns: /^\d{9}$/ }, describe: "fei:<FEI number> or duns:<9-digit DUNS>" },
  Inspection: { engineType: "inspection", systems: { "fda-inspection": /^\d{3,12}$/ }, describe: "FDA inspection id" },
  WarningLetter: { engineType: "warning-letter", systems: { "fda-warning-letter": SAFE_ID }, describe: "FDA warning letter / MARCS-CMS id" },
  ImportAlert: { engineType: "import-alert", systems: { "fda-import-alert": /^\d{2}-\d{2}$/ }, describe: "import alert number, e.g. 66-40" },
  Recall: { engineType: "recall", systems: { "fda-recall": /^[A-Z]-\d{3,5}-\d{4}$/ }, describe: "FDA recall number, e.g. D-0123-2026" },
  Shortage: { engineType: "shortage", systems: { "fda-shortage": SAFE_ID }, describe: "FDA shortage record id" },
  HospitalItem: { engineType: "hospital-item", systems: { "hospital-item": SAFE_ID }, describe: "<hospital>:<item id>" },
  WatchRun: { engineType: "watch-run", systems: { "upstream-watch": SAFE_ID }, describe: "watch run id" },
};

const ENGINE_TO_TYPE = Object.fromEntries(Object.entries(ENTITY_KEYS).map(([t, s]) => [s.engineType, t])) as Record<string, EntityType>;

export type RelationType =
  | "stocks" | "package-of" | "of-drug" | "labeled-by" | "made-at"
  | "inspected" | "issued-to" | "lists" | "recalls" | "affects";

export const RELATIONS: Record<RelationType, { from: EntityType[]; to: EntityType[]; many: boolean; label: string }> = {
  stocks: { from: ["HospitalItem"], to: ["Package"], many: true, label: "hospital item is stocked as this package NDC" },
  "package-of": { from: ["Package"], to: ["Product"], many: false, label: "package belongs to product" },
  "of-drug": { from: ["Product"], to: ["Drug"], many: false, label: "product is this drug" },
  "labeled-by": { from: ["Product"], to: ["Labeler"], many: false, label: "product's labeler (NDC labeler code)" },
  "made-at": { from: ["Product"], to: ["Site"], many: true, label: "product manufactured at this SPL establishment" },
  inspected: { from: ["Inspection"], to: ["Site"], many: false, label: "FDA inspection of this site" },
  "issued-to": { from: ["WarningLetter"], to: ["Site", "Labeler"], many: false, label: "warning letter recipient" },
  lists: { from: ["ImportAlert"], to: ["Site"], many: true, label: "site is on this import alert" },
  recalls: { from: ["Recall"], to: ["Product", "Package"], many: true, label: "recall covers this product or package" },
  affects: { from: ["Shortage"], to: ["Drug", "Product"], many: true, label: "FDA shortage listing covers this drug or product" },
};

/** Which edges an investigation subgraph follows from each node type (keeps it from exploding through shared sites). */
const EXPAND: Record<EntityType, { via: RelationType; dir: "out" | "in" }[]> = {
  HospitalItem: [{ via: "stocks", dir: "out" }],
  Package: [{ via: "package-of", dir: "out" }, { via: "recalls", dir: "in" }],
  Product: [{ via: "of-drug", dir: "out" }, { via: "labeled-by", dir: "out" }, { via: "made-at", dir: "out" }, { via: "recalls", dir: "in" }, { via: "affects", dir: "in" }],
  Drug: [{ via: "of-drug", dir: "in" }, { via: "affects", dir: "in" }],
  Labeler: [{ via: "issued-to", dir: "in" }],
  Site: [{ via: "inspected", dir: "in" }, { via: "issued-to", dir: "in" }, { via: "lists", dir: "in" }],
  Inspection: [],
  WarningLetter: [],
  ImportAlert: [],
  Recall: [],
  Shortage: [],
  WatchRun: [],
};

export class UnknownEntityError extends Error {
  constructor(readonly ids: string[]) {
    super(`World Model: unknown entity id(s): ${ids.join(", ")}. Upsert them with an external key first; ids may not be invented.`);
    this.name = "UnknownEntityError";
  }
}

export class InvalidKeyError extends Error {
  constructor(type: string, key: string, expected: string) {
    super(`World Model: invalid ${type} key "${key}". Expected ${expected}.`);
    this.name = "InvalidKeyError";
  }
}

/** Resolve (type, key) to the engine's external key; validates the identifier format. */
export function keyFor(type: EntityType, key: string): { system: string; id: string } {
  const spec = ENTITY_KEYS[type];
  if (!spec) throw new Error(`World Model: unknown entity type ${type}`);
  const systems = Object.keys(spec.systems);
  let system: string;
  let id: string;
  const prefixed = systems.find((s) => key.startsWith(`${s}:`));
  if (prefixed) {
    system = prefixed;
    id = key.slice(prefixed.length + 1);
  } else if (systems.length === 1) {
    system = systems[0];
    id = key;
  } else {
    throw new InvalidKeyError(type, key, spec.describe);
  }
  if (type === "Drug" && system === "generic") id = id.toLowerCase().replace(/\s+/g, " ").trim();
  if (!spec.systems[system].test(id)) throw new InvalidKeyError(type, key, spec.describe);
  return { system, id };
}

/** Deterministic engine id for (type, key) without writing anything. */
export function idFor(type: EntityType, key: string): string {
  const k = keyFor(type, key);
  return externalId(ENTITY_KEYS[type].engineType, k.system, k.id);
}

export function typeOfId(id: string): EntityType | undefined {
  return ENGINE_TO_TYPE[id.split(":")[0]];
}

// ------------------------------------------------------------------ wrapper

export interface SubgraphNode {
  id: string;
  type: EntityType;
  key: string;
  label: string;
  attrs: Record<string, unknown>;
  facts: Fact[];
  depth: number;
}
export interface SubgraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  validFrom?: string;
  validTo?: string;
  source: Relationship["source"];
}
export interface Subgraph {
  roots: string[];
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  counts: Record<string, number>;
}

export interface UpstreamWorldOptions {
  namespace?: string;
  storage?: "memory" | "local";
  /** directory for local storage; the engine writes <directory>/.world/<namespace>.json. Default <repo>/.state */
  directory?: string;
  persist?: "immediate" | "deferred";
  conflictPolicy?: WorldModelOptions["conflictPolicy"];
  sourcePriority?: string[];
  clock?: () => Date;
}

/** Source systems in priority order for the "source-priority" conflict policy. */
export const DEFAULT_SOURCE_PRIORITY = ["fda-shortage-db", "fda-recall", "fda-inspection", "fda-warning-letter", "fda-import-alert", "dailymed-spl", "zetaris", "agent", "manual"];

export class UpstreamWorld {
  private readonly engine: WorldModel;

  constructor(opts: UpstreamWorldOptions = {}) {
    this.engine = new WorldModel({
      namespace: opts.namespace ?? "upstream",
      storage: opts.storage ?? "local",
      directory: opts.directory ?? stateDir(),
      persist: opts.persist ?? "deferred",
      conflictPolicy: opts.conflictPolicy ?? "source-priority",
      sourcePriority: opts.sourcePriority ?? DEFAULT_SOURCE_PRIORITY,
      clock: opts.clock,
    });
  }

  // ---------------------------------------------------------- guards

  known(id: string): boolean {
    return !!this.engine.view("graph").entity(id);
  }

  /** Throws UnknownEntityError unless every id exists. Use on any id that came from a model. */
  requireKnown(ids: string | string[]): void {
    const list = Array.isArray(ids) ? ids : [ids];
    const bad = list.filter((i) => !this.known(i));
    if (bad.length) throw new UnknownEntityError(bad);
  }

  /** Filter a model's cited ids into known and unknown without throwing (for draft review UIs). */
  checkCitations(ids: string[]): { known: string[]; unknown: string[] } {
    const uniq = [...new Set(ids)];
    return { known: uniq.filter((i) => this.known(i)), unknown: uniq.filter((i) => !this.known(i)) };
  }

  // ---------------------------------------------------------- writes

  async upsert(type: EntityType, key: string, input: { name?: string; attrs?: Record<string, unknown>; source: Provenance }): Promise<Entity> {
    const k = keyFor(type, key);
    return this.engine.upsertEntity({
      type: ENTITY_KEYS[type].engineType,
      externalKey: k,
      name: input.name,
      attrs: { ...(input.attrs ?? {}), key: `${k.system}:${k.id}` },
      source: input.source,
    });
  }

  async relate(from: string, type: RelationType, to: string, input: { source: Provenance; validFrom?: string; validTo?: string; attrs?: Record<string, unknown> }): Promise<Relationship> {
    this.requireKnown([from, to]);
    const spec = RELATIONS[type];
    if (!spec) throw new Error(`World Model: unknown relation type ${type}`);
    const ft = typeOfId(from), tt = typeOfId(to);
    if (!ft || !spec.from.includes(ft) || !tt || !spec.to.includes(tt)) {
      throw new Error(`World Model: relation ${type} must go ${spec.from.join("|")} -> ${spec.to.join("|")}, got ${ft} -> ${tt}`);
    }
    return this.engine.relate({
      from,
      type,
      to,
      context: spec.many ? `fanout:${to}` : undefined,
      validFrom: input.validFrom,
      validTo: input.validTo,
      attrs: input.attrs,
      source: input.source,
    });
  }

  async assertFact(about: string, predicate: string, value: unknown, input: { source: Provenance; confidence?: number }): Promise<Fact> {
    this.requireKnown(about);
    return this.engine.assertFact({ about, predicate, value, confidence: input.confidence, source: input.source });
  }

  /** Write everything queued so far to disk (one file write). Returns true if a write happened. */
  flush(): Promise<boolean> {
    return this.engine.flush();
  }

  persistWrites(): number {
    return this.engine.persistWrites();
  }

  // ---------------------------------------------------------- reads

  entity(id: string): Entity | undefined {
    return this.engine.view("graph").entity(id);
  }

  facts(id: string, opts: { current?: boolean } = {}): Fact[] {
    const all = this.engine.view("facts").about(id);
    return opts.current ? all.filter((f) => !f.supersededBy) : all;
  }

  neighbors(id: string, via?: RelationType, at?: string): Entity[] {
    return this.engine.view("graph").neighborsOf(id, { via, at });
  }

  query(type: EntityType, where?: (e: Entity) => boolean): Entity[] {
    return this.engine.view("graph").query({ type: ENTITY_KEYS[type].engineType, where });
  }

  entityAt(id: string, at: string): Entity | undefined {
    return this.engine.view("snapshot").entityAt(id, at);
  }

  audit() {
    return this.engine.audit();
  }

  events(): readonly WorldEvent[] {
    return this.engine.events();
  }

  subscribe(fn: (e: WorldEvent) => void): () => void {
    return this.engine.subscribeEvents(fn);
  }

  stateShapeCanonical(): string {
    return this.engine.stateShapeCanonical();
  }

  /**
   * The subgraph for one investigation, for the UI graph: breadth-first from
   * the roots along the investigation-shaped edges in EXPAND (hospital item ->
   * package -> product -> drug / labeler / sites -> inspections, warning
   * letters, import alerts; recalls and shortages pointing in). It does not
   * walk from a site back out to unrelated products. Open edges only, unless
   * `at` is given (point-in-time).
   */
  exportSubgraph(rootIds: string[], opts: { maxDepth?: number; at?: string; maxNodes?: number } = {}): Subgraph {
    this.requireKnown(rootIds);
    const maxDepth = opts.maxDepth ?? 6;
    const maxNodes = opts.maxNodes ?? 500;
    const rels = this.allRelationships(opts.at);
    const outBy = new Map<string, Relationship[]>();
    const inBy = new Map<string, Relationship[]>();
    for (const r of rels) {
      (outBy.get(r.from) ?? outBy.set(r.from, []).get(r.from)!).push(r);
      (inBy.get(r.to) ?? inBy.set(r.to, []).get(r.to)!).push(r);
    }
    const depthOf = new Map<string, number>(rootIds.map((id) => [id, 0]));
    const edges = new Map<string, Relationship>();
    let frontier = [...rootIds];
    for (let d = 0; d < maxDepth && frontier.length && depthOf.size < maxNodes; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const t = typeOfId(id);
        if (!t) continue;
        for (const rule of EXPAND[t]) {
          const list = rule.dir === "out" ? outBy.get(id) ?? [] : inBy.get(id) ?? [];
          for (const r of list) {
            if (r.type !== rule.via) continue;
            const other = rule.dir === "out" ? r.to : r.from;
            edges.set(r.id, r);
            if (!depthOf.has(other) && depthOf.size < maxNodes) {
              depthOf.set(other, d + 1);
              next.push(other);
            }
          }
        }
      }
      frontier = next;
    }
    const nodes: SubgraphNode[] = [];
    for (const [id, depth] of depthOf) {
      const e = opts.at ? this.entityAt(id, opts.at) : this.entity(id);
      if (!e) continue;
      const type = typeOfId(id)!;
      const key = String(e.attrs.key ?? id.split(":").slice(1).join(":"));
      nodes.push({ id, type, key, label: e.name ?? key, attrs: e.attrs, facts: this.facts(id), depth });
    }
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edgeList: SubgraphEdge[] = [...edges.values()]
      .filter((r) => nodeIds.has(r.from) && nodeIds.has(r.to))
      .map((r) => ({ id: r.id, from: r.from, to: r.to, type: r.type, validFrom: r.validFrom, validTo: r.validTo, source: r.source }));
    const counts: Record<string, number> = {};
    for (const n of nodes) counts[n.type] = (counts[n.type] ?? 0) + 1;
    nodes.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
    return { roots: rootIds, nodes, edges: edgeList, counts };
  }

  private allRelationships(at?: string): Relationship[] {
    // Rebuild the edge set from the event log (the read views do not expose a raw edge list).
    const byId = new Map<string, Relationship>();
    for (const e of this.engine.events()) {
      if (e.kind !== "relate") continue;
      const r = e.payload as Relationship;
      byId.set(r.id, { ...r });
    }
    // Apply the engine's supersession (store.ts fold): a new edge with the same
    // (from, type, context) and a different target closes every earlier open one.
    const ordered = [...byId.values()];
    const groups = new Map<string, Relationship[]>();
    for (const r of ordered) {
      const g = `${r.from}|${r.type}|${r.context ?? ""}`;
      const prior = groups.get(g) ?? [];
      for (const p of prior) if (p.to !== r.to && !p.validTo) p.validTo = r.validFrom ?? r.createdAt;
      prior.push(r);
      groups.set(g, prior);
    }
    return ordered.filter((r) => (at ? (!r.validFrom || at >= r.validFrom) && (!r.validTo || at < r.validTo) : !r.validTo));
  }
}

/** Open the app's persistent world (default <repo>/.state/.world/upstream.json, deferred writes). */
export function openWorld(opts: UpstreamWorldOptions = {}): UpstreamWorld {
  return new UpstreamWorld({ storage: "local", ...opts });
}

/** Provenance helper: source system kind + agent id + observation time (+ url). */
export function src(kind: string, by: string, at: string | Date, url?: string): Provenance {
  return { kind, by, at, url };
}
