import { corsFor, mcpHandler } from "@/src/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A person who opens the endpoint in a browser gets a page that says what it is; MCP clients get the protocol. */
async function get(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/html")) {
    const url = `${new URL(req.url).origin}/api/mcp`;
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Upstream MCP server</title>
<style>body{font:17px/1.6 system-ui,sans-serif;max-width:40em;margin:12vh auto;padding:0 20px;color:#18222c;background:#f6f7f5}code{background:#e6eaec;padding:2px 6px;border-radius:4px}a{color:#1f5fad}</style>
<h1>Upstream's MCP server, for a pharmacy team's assistant</h1>
<p>It speaks the Model Context Protocol over Streamable HTTP. Add this address to an assistant that supports remote MCP servers (Claude, Cursor):</p>
<p><code>${url}</code></p>
<p>Tools: <b>investigate_shortage</b>, <b>trace_supply</b>, <b>shortage_status</b>, <b>morning_brief</b>, <b>plant_record</b>, <b>ask_upstream</b>. All six are read-only. Every call goes through Scout first: Scout issues a signed contract and the tool checks it for each capability it reads before it touches any data. Orders, inventory changes and dosing advice are refused.</p>
<p>${process.env.UPSTREAM_MCP_TOKEN ? "This copy needs a bearer token (<code>Authorization: Bearer ...</code>)." : `This demo copy is open, read-only and limited to 30 requests a minute per address. A hospital deployment sets a bearer token.`}</p>
<p>Then ask: "Why is carboplatin short, and what should Corvale do?"</p>
<p><a href="/">Upstream</a></p>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return mcpHandler(req);
}

const preflight = (req: Request) => new Response(null, { status: 204, headers: corsFor(req) });

export { get as GET, mcpHandler as POST, preflight as OPTIONS };
