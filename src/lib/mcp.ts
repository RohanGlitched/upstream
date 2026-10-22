import "server-only";
import crypto from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FORMULARY_DRUGS, createUpstreamScout } from "../engines/scout/upstream";
import { assertContract, ContractRefusedError, type Decision } from "../engines/scout/index";
import { RateLimiter } from "../engines/scout/guard";
import { caseForMolecule, listCases } from "./cases";
import { bearer, clientIp } from "./session";
import { tallMan } from "../agent/util";

/**
 * Upstream for a pharmacy team's AI assistant: an MCP server (Streamable HTTP at /api/mcp). Every tool call goes
 * through Scout first, exactly as a question typed at the desk does: Scout classifies the request and issues an
 * execution contract, and the tool asserts that contract for each capability it reads (zetaris.read, world.read,
 * hmem.read, markovian.chain) before it touches any data. Anything that would place an order, change inventory or
 * give dosing advice is refused with Scout's reason. The server exposes read-only tools only.
 *
 * Access: when UPSTREAM_MCP_TOKEN is set, every request needs "Authorization: Bearer <token>". When it is not set
 * (the hosted demo), the server is open but read-only and rate-limited per address. CORS allows GET and POST from
 * this site and an allow-list of origins (UPSTREAM_MCP_ORIGINS, comma-separated), with explicit headers.
 */
export const SERVER_INSTRUCTIONS = `Upstream explains drug shortages for a hospital pharmacy (the fictional Corvale Health system, joined to real FDA records).
Use investigate_shortage to get the cited "why" for a drug and what to do about it; trace_supply for the plants named on our products' labels and FDA's record of each;
shortage_status for FDA's listing; morning_brief for the overnight watch over the whole formulary; plant_record for one plant by FEI.
Every answer cites evidence ids that map to a Zetaris query and a row. Upstream never places orders, changes inventory or gives dosing advice; ask_upstream shows how Scout handles any other request.
This hosted copy serves recorded investigations; live ones run where Upstream's Zetaris instance runs.`;

const SECRET = process.env.SCOUT_SIGNING_SECRET ?? "upstream-mcp";
const scout = createUpstreamScout({ signingSecret: SECRET });
const both = <T extends Record<string, unknown>>(t: string, data: T) => ({ content: [{ type: "text" as const, text: t }], structuredContent: data });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** The only capabilities an MCP tool may use. Nothing here writes. */
const READ_ONLY = new Set(["zetaris.read", "world.read", "hmem.read", "markovian.chain"]);

type Gate = { d: Decision; ok: true; contractId: string } | { d: Decision; ok: false; reason: string };

/**
 * Scout first: classify the request, refuse if Scout blocks, asks a question or issues no contract, then assert the
 * contract for every capability the tool is about to use (the executor-side check every Upstream tool call passes).
 */
async function gate(prompt: string, uses: string[]): Promise<Gate> {
  for (const cap of uses) if (!READ_ONLY.has(cap)) throw new Error(`MCP tools are read-only; ${cap} is not allowed`);
  const d = await scout.decide({ prompt, user: { id: "mcp-client", role: "buyer" }, surface: "api" });
  if (d.risk.level === "block" || !d.executionContract) return { d, ok: false, reason: d.risk.reason ?? d.clarification?.question ?? "no contract issued" };
  try {
    for (const cap of uses) assertContract(d.executionContract, cap, { secret: SECRET, engine: "mcp" });
  } catch (e) {
    return { d, ok: false, reason: e instanceof ContractRefusedError ? e.message : "the contract did not verify" };
  }
  return { d, ok: true, contractId: d.executionContract.contractId };
}

const refused = (g: { reason: string }) => text(`Scout refused: ${g.reason}`);

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/** Formulary drugs whose name is close to what was asked (typos, partial names), closest first. */
function closeMatches(drug: string, n = 5): string[] {
  const q = drug.toLowerCase().trim();
  const names = [...new Set(FORMULARY_DRUGS.map((x) => x.split(" ")[0]))];
  return names
    .map((x) => ({ x, d: x.startsWith(q) || q.startsWith(x) ? 0 : editDistance(q, x) }))
    .filter((m) => m.d <= Math.max(2, Math.floor(q.length / 3)))
    .sort((a, b) => a.d - b.d || a.x.localeCompare(b.x))
    .slice(0, n)
    .map((m) => m.x);
}

/**
 * When Scout asks which drug is meant (the name is not on Corvale's formulary), that is a clarification, not a
 * refusal: say so, and offer the closest formulary names. A real refusal (orders, dosing, injection) stays one.
 */
async function clarifyOrRefuse(g: Extract<Gate, { ok: false }>, drug: string) {
  if (g.d.risk.level === "block" || !g.d.clarification) return refused(g);
  const onFormulary = FORMULARY_DRUGS.some((x) => x === drug.toLowerCase().trim() || x.split(" ")[0] === drug.toLowerCase().trim());
  const matches = closeMatches(drug);
  const recorded = [...new Set((await listCases()).map((s) => s.molecule.split(/[\s,]+/)[0]))].sort();
  const msg = onFormulary
    ? `Scout needs a clearer request before it acts: ${g.d.clarification.question}`
    : `${drug} is not on Corvale's formulary, so Upstream has no stock or supply chain for it. ${matches.length ? `Closest formulary names: ${matches.join(", ")}.` : `No formulary name is close. Recorded investigations include: ${recorded.slice(0, 12).join(", ")}.`}`;
  return both(msg, { clarification: true, onFormulary, question: g.d.clarification.question, closeMatches: matches });
}

/** FDA's listing in words: a null status with a posting date means FDA posted it before and does not list it now. */
function listing(s: { status: string | null; firstPosting: string | null }): string {
  if (s.status) return `${s.status} since ${s.firstPosting ?? "an unknown date"}`;
  return s.firstPosting ? `not currently listed (resolved); FDA first posted it on ${s.firstPosting}` : "not on FDA's shortage list";
}

function register(server: McpServer) {
  server.registerTool(
    "investigate_shortage",
    {
      title: "Why is this drug short, and what do we do?",
      description: "Upstream's cited explanation for a drug shortage at Corvale Health: FDA status, the plants on our labels and FDA's actions there, our days on hand per hospital, and ranked options.",
      inputSchema: z.object({ drug: z.string().min(3).max(60).describe("Generic name, e.g. carboplatin") }),
      annotations: { readOnlyHint: true },
    },
    async ({ drug }) => {
      const g = await gate(`Why is ${drug} short?`, ["zetaris.read", "world.read", "hmem.read"]);
      if (!g.ok) return clarifyOrRefuse(g, drug);
      const c = await caseForMolecule(drug);
      if (!c) return text(`No recorded investigation for ${drug}. Recorded: ${(await listCases()).map((s) => s.molecule).join(", ")}.`);
      const days = c.stock.map((s) => `${s.hospital} ${s.days ?? "-"} days (${s.description})`);
      const why = (c.explanation?.sentences ?? []).map((s) => `- ${s.text} [${s.cites.join(", ")}]`).join("\n");
      const opts = c.options.slice(0, 4).map((o, i) => `${i + 1}. ${o.title}: ${o.detail} Needs: ${o.needs}.`).join("\n");
      return both(
        `${tallMan(c.molecule)}: ${c.explanation?.headline ?? ""} (${c.explanation?.state ?? "no explanation"})\nFDA: ${listing(c.shortage)}\n\nWhy:\n${why}\n\nStock:\n${days.join("\n")}\n\nOptions:\n${opts}\n\nCase ${c.id}; ${c.usage.zetarisQueries} Zetaris queries; contract ${g.contractId}.`,
        { molecule: c.molecule, state: c.explanation?.state ?? null, headline: c.explanation?.headline ?? null, fdaStatus: c.shortage.status, firstPosting: c.shortage.firstPosting,
          stock: c.stock.map((s) => ({ hospital: s.hospital, ndc11: s.ndc11, days: s.days, onHand: s.onHand })), options: c.options.slice(0, 6).map((o) => ({ title: o.title, needs: o.needs })),
          sentences: c.explanation?.sentences ?? [], contractId: g.contractId },
      );
    },
  );

  server.registerTool(
    "trace_supply",
    {
      title: "Which plants make our supply, and what has FDA found there?",
      description: "The plants named on the FDA label filings of the products Corvale stocks for a drug, placed through FDA's registration file, with each plant's FDA inspections, warning letters and import alerts.",
      inputSchema: z.object({ drug: z.string().min(3).max(60) }),
      annotations: { readOnlyHint: true },
    },
    async ({ drug }) => {
      const g = await gate(`Trace where our ${drug} supply is made`, ["zetaris.read", "world.read"]);
      if (!g.ok) return clarifyOrRefuse(g, drug);
      const c = await caseForMolecule(drug);
      if (!c) return text(`No recorded trace for ${drug}.`);
      const lines = c.chain.flatMap((pc) => pc.plants.map((p) => `${pc.labeler} (NDC ${pc.packageNdc}) -> ${p.name}${p.country ? `, ${p.country}` : ""}${p.fei ? ` FEI ${p.fei}` : ""}: ${p.health}${p.signals.length ? `; ${p.signals.map((s) => `${s.kind} ${s.date}`).join(", ")}` : ""}`));
      return both(lines.join("\n") || "No plants could be placed.", { plants: c.chain.flatMap((pc) => pc.plants.map((p) => ({ labeler: pc.labeler, ndc: pc.packageNdc, plant: p.name, fei: p.fei, country: p.country, health: p.health, signals: p.signals.map((s) => ({ kind: s.kind, date: s.date })) }))), contractId: g.contractId });
    },
  );

  server.registerTool(
    "shortage_status",
    {
      title: "FDA's shortage listing for a drug",
      description: "FDA's current shortage status for a drug, when it was first posted, and each company's status and note.",
      inputSchema: z.object({ drug: z.string().min(3).max(60) }),
      annotations: { readOnlyHint: true },
    },
    async ({ drug }) => {
      const g = await gate(`Is ${drug} on the FDA shortage list?`, ["zetaris.read"]);
      if (!g.ok) return clarifyOrRefuse(g, drug);
      const c = await caseForMolecule(drug);
      if (!c) return text(`No recorded listing for ${drug}.`);
      return both(`${c.molecule}: ${listing(c.shortage)}\n${c.shortage.companies.map((x) => `- ${x.company}: ${x.status} (updated ${x.updated}) ${x.info}`).join("\n")}`,
        { status: c.shortage.status, firstPosting: c.shortage.firstPosting, companies: c.shortage.companies.map(({ company, status, updated, info }) => ({ company, status, updated, info })), contractId: g.contractId });
    },
  );

  server.registerTool(
    "morning_brief",
    {
      title: "The overnight watch over the whole formulary",
      description: "Which formulary drugs need action today and which are on watch, from the overnight Markovian watch. The summary sentence is checked against the watch rows.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(60).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const g = await gate("Run the formulary watch summary", ["zetaris.read", "markovian.chain"]);
      if (!g.ok) return refused(g);
      try {
        const w = JSON.parse(await readFile(path.join(process.cwd(), "data", "watch", "latest.json"), "utf8")) as { brief: string; asOf: string; drugs: number; flagged: { display: string; state: string; systemDays: number | null; signal: string }[] };
        const f = w.flagged.slice(0, limit ?? 15);
        return both(`${w.brief}\n${f.map((x) => `- ${x.state.toUpperCase()} ${x.display}: ${x.systemDays ?? "-"} days across the system; ${x.signal}`).join("\n")}`, { asOf: w.asOf, drugs: w.drugs, flagged: f, contractId: g.contractId });
      } catch {
        return text("The overnight watch has not run yet.");
      }
    },
  );

  server.registerTool(
    "plant_record",
    {
      title: "One plant's FDA record",
      description: "A manufacturing plant behind Corvale's formulary, by FDA FEI number: latest inspection, recent FDA actions, and which of our products it makes.",
      inputSchema: z.object({ fei: z.string().regex(/^\d{5,10}$/) }),
      annotations: { readOnlyHint: true },
    },
    async ({ fei }) => {
      // The plant atlas is the recorded plant graph behind the formulary; Scout routes this as signal.explain.
      const g = await gate(`Show the FDA inspection record for the plant with FEI ${fei}`, ["world.read"]);
      if (!g.ok) return refused(g);
      try {
        const d = JSON.parse(await readFile(path.join(process.cwd(), "data", "plants.json"), "utf8")) as { plants: { name: string; fei: string; country_iso3: string; health: string; last: string | null; signals: number; products: { labeler: string; molecule: string }[] }[] };
        const p = d.plants.find((x) => x.fei === fei.replace(/^0+/, ""));
        if (!p) return text(`FEI ${fei} is not a plant behind Corvale's formulary.`);
        return both(`${p.name} (${p.country_iso3}), FEI ${p.fei}: ${p.health}; last inspection ${p.last ?? "none on record"}; ${p.signals} FDA actions in 3 years.\nMakes: ${p.products.map((x) => `${x.molecule} for ${x.labeler}`).join("; ")}`, { ...p, contractId: g.contractId });
      } catch {
        return text("The plant atlas has not been built yet.");
      }
    },
  );

  server.registerTool(
    "ask_upstream",
    {
      title: "Ask Upstream anything (shows Scout's decision)",
      description: "Runs Scout on a free-text request and returns its intent, risk level and decision. Requests to place orders, change inventory or give dosing advice are refused here, with the reason.",
      inputSchema: z.object({ request: z.string().min(3).max(400) }),
      annotations: { readOnlyHint: true },
    },
    async ({ request }) => {
      // Shows Scout's decision only; it reads and runs nothing, so it asserts no capability.
      const g = await gate(request, []);
      const { d } = g;
      return both(`${d.intent.primary} (${d.intent.band}), risk ${d.risk.level}: ${g.ok ? `allowed under contract ${g.contractId} with ${d.executionContract?.scope.capabilities.join(", ")}` : `refused: ${g.reason}`}`,
        { intent: d.intent.primary, risk: d.risk.level, allowed: g.ok, reason: g.ok ? null : g.reason, scope: d.executionContract?.scope.capabilities ?? [] });
    },
  );
}

const CORS_BASE: Record<string, string> = {
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "600",
  vary: "Origin",
};

const ORIGINS = (process.env.UPSTREAM_MCP_ORIGINS ?? "https://claude.ai,http://localhost:6274,http://127.0.0.1:6274").split(",").map((o) => o.trim()).filter(Boolean);

/** CORS for one request: the origin is echoed only when it is this site or on the allow-list (no wildcard). */
export function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const self = new URL(req.url).origin;
  return origin && (origin === self || ORIGINS.includes(origin)) ? { ...CORS_BASE, "access-control-allow-origin": origin } : { ...CORS_BASE };
}

const TOKEN = process.env.UPSTREAM_MCP_TOKEN ?? "";
const limiter = new RateLimiter();
/** Requests a minute per address: the open demo, and a caller holding the token. */
export const RATE = { open: 30, token: 120 };

function sameToken(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

const rpcError = (status: number, code: number, message: string, headers: Record<string, string>) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), { status, headers: { ...headers, "content-type": "application/json" } });

const inner = createMcpHandler(register, { serverInfo: { name: "Upstream", version: "1.1.0" }, instructions: SERVER_INSTRUCTIONS });

export async function mcpHandler(req: Request): Promise<Response> {
  const cors = corsFor(req);
  if (TOKEN) {
    const got = bearer(req);
    if (!got || !sameToken(got, TOKEN)) return rpcError(401, -32001, "Unauthorized: this Upstream MCP server needs a bearer token.", { ...cors, "www-authenticate": 'Bearer realm="upstream-mcp"' });
  }
  const per = TOKEN ? RATE.token : RATE.open;
  if (!limiter.take(`${TOKEN ? "token" : "open"}|${clientIp(req)}`, per, Date.now())) {
    return rpcError(429, -32002, `Rate limited: ${per} requests a minute per address. Try again in a minute.`, { ...cors, "retry-after": "60" });
  }
  const res = await inner(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
