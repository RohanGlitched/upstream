// Probe the local Zetaris instance: sign in through the UI proxy, report response shapes (never values
// of secrets), then run SELECT 1 through both SQL routes.   node scripts/zetaris-probe.mjs
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const ui = env.ZETARIS_BASE_URL ?? "http://localhost:3000";
const shape = (v, d = 0) =>
  v === null || typeof v !== "object" ? typeof v
  : Array.isArray(v) ? `[${v.length}] ${v.length ? shape(v[0], d + 1) : ""}`
  : d > 2 ? "{…}" : `{ ${Object.entries(v).map(([k, x]) => `${k}: ${/token|secret|password/i.test(k) ? "<redacted>" : shape(x, d + 1)}`).join(", ")} }`;

const login = await fetch(`${ui}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Request-ID": randomUUID() },
  body: JSON.stringify({ username: env.ZETARIS_USERNAME, password: env.ZETARIS_PASSWORD }),
});
const lj = await login.json().catch(() => null);
console.log("login", login.status, shape(lj));
const token = lj?.idToken ?? lj?.token ?? lj?.accessToken ?? JSON.stringify(lj ?? "").match(/[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/)?.[0];
if (!token) process.exit(1);
// Org id: look in the JWT claims (printed as claim names only, plus the org-looking values).
const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
console.log("claims", Object.keys(claims).join(", "));
for (const [k, v] of Object.entries(claims)) if (/org/i.test(k)) console.log(" ", k, "=", JSON.stringify(v));
const org = String(process.env.ORG ?? claims.orgId ?? claims.org_id ?? claims.organizationId ?? "1");

for (const [label, url, body] of [
  ["proxy", `${ui}/api/proxy/sql-editor/sqls/run-query`, { sql: "SELECT 1 AS one", limit: 10 }],
  ["rest", `${env.ZETARIS_REST_URL}/sql-editor/sqls/run`, { queryId: randomUUID(), sql: "SELECT 1 AS one", source: "SqlEditor", limit: 10 }],
]) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-Org-ID": org, "X-Request-ID": randomUUID(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  console.log(label, r.status, t.slice(0, 600));
}
