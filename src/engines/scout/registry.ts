// IntentRegistryService (AGENTS.md section 3): load, compose, validate, version.
// "If an intent is not in the registry, it cannot be acted on."

import fs from "node:fs";
import path from "node:path";
import type { Intent, IntentRegistryData } from "./types.ts";

const ID_GRAMMAR = /^([a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*|GENERAL)$/;

export class RegistryError extends Error {
  constructor(message: string) {
    super(`Scout registry: ${message}`);
    this.name = "RegistryError";
  }
}

export class IntentRegistry {
  readonly version: number;
  readonly name: string;
  private readonly byId: Map<string, Intent>;

  constructor(data: IntentRegistryData) {
    if (!data || !Array.isArray(data.intents)) throw new RegistryError("expected { version, intents[] }");
    this.version = data.version ?? 1;
    this.name = data.name ?? "registry";
    this.byId = new Map();
    for (const i of data.intents) {
      validate(i);
      if (this.byId.has(i.id)) throw new RegistryError(`duplicate intent id ${i.id}`);
      this.byId.set(i.id, Object.freeze({ ...i }) as Intent);
    }
  }

  static fromFile(file: string): IntentRegistry {
    return new IntentRegistry(JSON.parse(fs.readFileSync(file, "utf-8")));
  }

  /** Directory of per-intent JSON files (each one Intent) plus optional registry.json { version, name }. */
  static fromDirectory(dir: string): IntentRegistry {
    const meta = fs.existsSync(path.join(dir, "registry.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "registry.json"), "utf-8")) : {};
    const intents = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && f !== "registry.json")
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as Intent);
    return new IntentRegistry({ version: meta.version ?? 1, name: meta.name ?? path.basename(dir), intents });
  }

  /** Compose registries; later registries may not redefine an id. Version = sum, so any change bumps it. */
  static compose(regs: IntentRegistry[]): IntentRegistry {
    return new IntentRegistry({
      version: regs.reduce((s, r) => s + r.version, 0),
      name: regs.map((r) => r.name).join("+"),
      intents: regs.flatMap((r) => r.all()),
    });
  }

  static load(src: string | IntentRegistry | IntentRegistryData): IntentRegistry {
    if (src instanceof IntentRegistry) return src;
    if (typeof src === "string") return fs.statSync(src).isDirectory() ? IntentRegistry.fromDirectory(src) : IntentRegistry.fromFile(src);
    return new IntentRegistry(src);
  }

  get(id: string): Intent | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Intent[] {
    return [...this.byId.values()];
  }

  /** Every capability any intent declares. */
  capabilities(): string[] {
    return [...new Set(this.all().flatMap((i) => i.capabilities))].sort();
  }
}

function validate(i: Intent): void {
  if (!i || typeof i.id !== "string" || !ID_GRAMMAR.test(i.id)) throw new RegistryError(`bad intent id ${JSON.stringify(i?.id)} (grammar "category.name")`);
  if (!Array.isArray(i.examples) || i.examples.length === 0) throw new RegistryError(`intent ${i.id} has no examples (mandatory)`);
  if (!["low", "medium", "high"].includes(i.riskClass)) throw new RegistryError(`intent ${i.id} has bad riskClass ${i.riskClass}`);
  if (!Array.isArray(i.capabilities)) throw new RegistryError(`intent ${i.id} capabilities must be an array`);
  if (!Array.isArray(i.surfaces) || !i.surfaces.length) throw new RegistryError(`intent ${i.id} needs surfaces`);
  if (!Array.isArray(i.roles) || !i.roles.length) throw new RegistryError(`intent ${i.id} needs roles`);
  if (typeof i.version !== "number") throw new RegistryError(`intent ${i.id} needs a numeric version`);
}
