import "server-only";
import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createUpstreamScout } from "../engines/scout/upstream";
import { caseForMolecule, listCases } from "./cases";
import { tallMan } from "../agent/util";

/**
 * Upstream for a pharmacy team's AI assistant: an MCP server (Streamable HTTP at /api/mcp). Every call goes through
 * Scout first, exactly as a question typed at the desk does: read-only tools run under a contract, and anything
 * that would place an order, change inventory or give dosing advice is refused with Scout's reason.
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

async function gate(prompt: string) {
  const d = await scout.decide({ prompt, user: { id: "mcp-client", role: "buyer" }, surface: "api" });
  return { d, ok: d.risk.level !== "block" && !!d.executionContract, reason: d.risk.reason ?? d.clarification?.question ?? "no contract issued" };
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
      const g = await gate(`Why is ${drug} short?`);
      if (!g.ok) return text(`Scout refused: ${g.reason}`);
      const c = await caseForMolecule(drug);
      if (!c) return text(`No recorded investigation for ${drug}. Recorded: ${(await listCases()).map((s) => s.molecule).join(", ")}.`);
      const days = c.stock.map((s) => `${s.hospital} ${s.days ?? "-"} days (${s.description})`);
      const why = (c.explanation?.sentences ?? []).map((s) => `- ${s.text} [${s.cites.join(", ")}]`).join("\n");
      const opts = c.options.slice(0, 4).map((o, i) => `${i + 1}. ${o.title}: ${o.detail} Needs: ${o.needs}.`).join("\n");
      return both(
        `${tallMan(c.molecule)}: ${c.explanation?.headline ?? ""} (${c.explanation?.state ?? "no explanation"})\nFDA: ${c.shortage.status ?? "not listed"} since ${c.shortage.firstPosting ?? "-"}\n\nWhy:\n${why}\n\nStock:\n${days.join("\n")}\n\nOptions:\n${opts}\n\nCase ${c.id}; ${c.usage.zetarisQueries} Zetaris queries; contract ${g.d.executionContract?.contractId}.`,
        { molecule: c.molecule, state: c.explanation?.state ?? null, headline: c.explanation?.headline ?? null, fdaStatus: c.shortage.status, firstPosting: c.shortage.firstPosting,
          stock: c.stock.map((s) => ({ hospital: s.hospital, ndc11: s.ndc11, days: s.days, onHand: s.onHand })), options: c.options.slice(0, 6).map((o) => ({ title: o.title, needs: o.needs })),
          sentences: c.explanation?.sentences ?? [], contractId: g.d.executionContract?.contractId ?? null },
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
      const g = await gate(`Trace where our ${drug} supply is made`);
      if (!g.ok) return text(`Scout refused: ${g.reason}`);
      const c = await caseForMolecule(drug);
      if (!c) return text(`No recorded trace for ${drug}.`);
      const lines = c.chain.flatMap((pc) => pc.plants.map((p) => `${pc.labeler} (NDC ${pc.packageNdc}) -> ${p.name}${p.country ? `, ${p.country}` : ""}${p.fei ? ` FEI ${p.fei}` : ""}: ${p.health}${p.signals.length ? `; ${p.signals.map((s) => `${s.kind} ${s.date}`).join(", ")}` : ""}`));
      return both(lines.join("\n") || "No plants could be placed.", { plants: c.chain.flatMap((pc) => pc.plants.map((p) => ({ labeler: pc.labeler, ndc: pc.packageNdc, plant: p.name, fei: p.fei, country: p.country, health: p.health, signals: p.signals.map((s) => ({ kind: s.kind, date: s.date })) }))) });
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
      const g = await gate(`Is ${drug} on the FDA shortage list?`);
      if (!g.ok) return text(`Scout refused: ${g.reason}`);
      const c = await caseForMolecule(drug);
      if (!c) return text(`No recorded listing for ${drug}.`);
      return both(`${c.molecule}: ${c.shortage.status ?? "not listed"} since ${c.shortage.firstPosting ?? "-"}\n${c.shortage.companies.map((x) => `- ${x.company}: ${x.status} (updated ${x.updated}) ${x.info}`).join("\n")}`,
        { status: c.shortage.status, firstPosting: c.shortage.firstPosting, companies: c.shortage.companies.map(({ company, status, updated, info }) => ({ company, status, updated, info })) });
    },
  );

  server.registerTool(
    "morning_brief",
    {
      title: "The overnight watch over the whole formulary",
      description: "Which formulary drugs need action today and which are on watch, from the overnight Markovian watch.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(60).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const g = await gate("Run the formulary watch summary");
      if (!g.ok) return text(`Scout refused: ${g.reason}`);
      try {
        const w = JSON.parse(await readFile(path.join(process.cwd(), "data", "watch", "latest.json"), "utf8")) as { brief: string; asOf: string; drugs: number; flagged: { display: string; state: string; systemDays: number | null; signal: string }[] };
        const f = w.flagged.slice(0, limit ?? 15);
        return both(`${w.brief}\n${f.map((x) => `- ${x.state.toUpperCase()} ${x.display}: ${x.systemDays ?? "-"} days across the system; ${x.signal}`).join("\n")}`, { asOf: w.asOf, drugs: w.drugs, flagged: f });
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
      try {
        const d = JSON.parse(await readFile(path.join(process.cwd(), "data", "plants.json"), "utf8")) as { plants: { name: string; fei: string; country_iso3: string; health: string; last: string | null; signals: number; products: { labeler: string; molecule: string }[] }[] };
        const p = d.plants.find((x) => x.fei === fei.replace(/^0+/, ""));
        if (!p) return text(`FEI ${fei} is not a plant behind Corvale's formulary.`);
        return both(`${p.name} (${p.country_iso3}), FEI ${p.fei}: ${p.health}; last inspection ${p.last ?? "none on record"}; ${p.signals} FDA actions in 3 years.\nMakes: ${p.products.map((x) => `${x.molecule} for ${x.labeler}`).join("; ")}`, { ...p });
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
      const { d, ok, reason } = await gate(request);
      return both(`${d.intent.primary} (${d.intent.band}), risk ${d.risk.level}: ${ok ? `allowed under contract ${d.executionContract?.contractId} with ${d.executionContract?.scope.capabilities.join(", ")}` : `refused: ${reason}`}`,
        { intent: d.intent.primary, risk: d.risk.level, allowed: ok, reason: ok ? null : reason, scope: d.executionContract?.scope.capabilities ?? [] });
    },
  );
}

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

const inner = createMcpHandler(register, { serverInfo: { name: "Upstream", version: "1.0.0" }, instructions: SERVER_INSTRUCTIONS });

export async function mcpHandler(req: Request): Promise<Response> {
  const res = await inner(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
