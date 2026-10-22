// Zetaris client: every query Upstream runs goes through here.
// Live mode calls the Zetaris REST API. Each result is recorded under a hash of its SQL, so the hosted
// demo can replay real results (marked "replay") when the local instance is not reachable.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface QueryResult {
  id: string; // short hash of the SQL: the citation id shown in the UI ("Q-3f9a1c")
  sql: string;
  columns: string[];
  rows: Row[];
  ms: number;
  mode: "live" | "replay";
  ranAt: string;
  sources: string[]; // Zetaris sources the SQL reads, e.g. "corvale_general.cg", "fda.inspections"
}

export class ZetarisError extends Error {
  constructor(message: string, readonly sql?: string) {
    super(message);
  }
}

const RECORD_DIR = process.env.ZETARIS_RECORD_DIR ?? path.join(process.cwd(), "data", "replay", "zetaris");

export function queryId(sql: string): string {
  return "Q-" + createHash("sha256").update(normalizeSql(sql)).digest("hex").slice(0, 6);
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/** Qualified names the query reads, for the "which systems answered" strip in the UI. */
export function sourcesOf(sql: string): string[] {
  const found = new Set<string>();
  for (const m of normalizeSql(sql).matchAll(/\b(?:from|join)\s+([a-z_][\w]*(?:\.[a-z_][\w]*){1,2})/gi)) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

function liveConfig() {
  const base = (process.env.ZETARIS_REST_URL ?? "http://localhost:8888/api/v1.0").replace(/\/$/, "");
  const ui = (process.env.ZETARIS_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const key = process.env.ZETARIS_API_KEY;
  const user = process.env.ZETARIS_USERNAME;
  const password = process.env.ZETARIS_PASSWORD;
  if (!key && !(user && password)) return null;
  return { base, ui, key, user, password, org: process.env.ZETARIS_ORG_ID };
}

// Without an API key, sign in the way Zetaris's own scripts do and reuse the token until it expires.
let session: { token: string; org: string; exp: number; margin: number } | null = null;

async function auth(cfg: NonNullable<ReturnType<typeof liveConfig>>, fresh = false): Promise<{ token: string; org: string }> {
  if (cfg.key) return { token: cfg.key, org: cfg.org ?? "1" };
  if (!fresh && session && session.exp > Date.now() + session.margin) return session;
  const res = await fetch(`${cfg.ui}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": randomUUID() },
    body: JSON.stringify({ username: cfg.user, password: cfg.password }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ZetarisError(`Zetaris sign-in failed: HTTP ${res.status}`);
  const j = (await res.json()) as { idToken?: string; orgId?: number };
  if (!j.idToken) throw new ZetarisError("Zetaris sign-in returned no token.");
  const claims = JSON.parse(Buffer.from(j.idToken.split(".")[1], "base64url").toString()) as {
    exp?: number;
    nbf?: number;
    iat?: number;
  };
  const exp = (claims.exp ?? 0) * 1000;
  // The token's "not before" is rounded up to the next second: a call in the same second is refused
  // (JwtNotBeforeException, surfaced only as HTTP 400 "Bad Request"). Wait it out.
  const nbf = (claims.nbf ?? 0) * 1000;
  if (nbf > Date.now()) await new Promise((r) => setTimeout(r, nbf - Date.now() + 250));
  const lifetime = exp - (claims.iat ?? claims.nbf ?? 0) * 1000;
  session = { token: j.idToken, org: String(cfg.org ?? j.orgId ?? 1), exp, margin: Math.min(60_000, lifetime / 4) };
  return session;
}

/** Turn whatever shape the REST API returns into named rows. */
export function toRows(payload: unknown): { columns: string[]; rows: Row[] } {
  const p = payload as Record<string, unknown> | null;
  const data = (p?.data ?? p?.rows ?? p?.result ?? payload) as unknown;
  const colsRaw = (p?.headers ?? p?.columns ?? p?.schema ?? p?.header) as unknown;
  let columns: string[] = Array.isArray(colsRaw)
    ? colsRaw.map((c) => (typeof c === "string" ? c : String((c as Record<string, unknown>).name ?? (c as Record<string, unknown>).label ?? "")))
    : [];
  if (!Array.isArray(data)) return { columns, rows: [] };
  if (data.length && !Array.isArray(data[0]) && typeof data[0] === "object") {
    const rows = data as Row[];
    if (!columns.length) columns = Object.keys(rows[0] ?? {});
    return { columns, rows };
  }
  const arr = data as Cell[][];
  if (!columns.length) columns = arr[0]?.map((_, i) => `c${i}`) ?? [];
  return { columns, rows: arr.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? null]))) };
}

async function runLive(sql: string, limit: number): Promise<{ columns: string[]; rows: Row[] }> {
  const cfg = liveConfig();
  if (!cfg) throw new ZetarisError("Zetaris is not configured (ZETARIS_API_KEY, or ZETARIS_USERNAME and ZETARIS_PASSWORD).", sql);
  for (let attempt = 0; ; attempt++) {
    const { token, org } = await auth(cfg, attempt > 0);
    const res = await fetch(`${cfg.base}/sql-editor/sqls/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Org-ID": org,
        "X-Request-ID": randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit }),
      signal: AbortSignal.timeout(Number(process.env.ZETARIS_TIMEOUT_MS ?? 120_000)),
    });
    const text = await res.text();
    // A bare "Bad Request" is how an auth failure surfaces; sign in again once before giving up.
    if (res.status === 400 && text.includes('"Bad Request"') && attempt === 0 && !cfg.key) continue;
    if (!res.ok) throw new ZetarisError(`Zetaris returned HTTP ${res.status}: ${text.slice(0, 300)}`, sql);
    return toRows(text ? JSON.parse(text) : null);
  }
}

async function readRecord(id: string): Promise<QueryResult | null> {
  try {
    return JSON.parse(await readFile(path.join(RECORD_DIR, `${id}.json`), "utf8")) as QueryResult;
  } catch {
    return null;
  }
}

async function writeRecord(r: QueryResult): Promise<void> {
  await mkdir(RECORD_DIR, { recursive: true });
  await writeFile(path.join(RECORD_DIR, `${r.id}.json`), JSON.stringify({ ...r, mode: "replay" }, null, 1));
}

export interface QueryOptions {
  limit?: number;
  /** "auto": live when configured, else replay. "replay": never call Zetaris. */
  mode?: "auto" | "live" | "replay";
}

// Batch runs: statements whose result is the same for every case (RUN DQ over the whole system) run once per process.
const memo = new Map<string, QueryResult>();

export async function query(sql: string, opts: QueryOptions = {}): Promise<QueryResult> {
  const id = queryId(sql);
  if (process.env.ZETARIS_MEMO_DQ === "1" && /^\s*RUN DQ/i.test(sql) && memo.has(id)) return memo.get(id)!;
  const mode = opts.mode ?? (process.env.UPSTREAM_MODE as QueryOptions["mode"]) ?? "auto";
  if (mode === "replay" || (mode === "auto" && !liveConfig())) {
    const rec = await readRecord(id);
    if (!rec) throw new ZetarisError(`No recorded result for ${id}, and Zetaris is not reachable from here.`, sql);
    return { ...rec, mode: "replay" };
  }
  const t0 = performance.now();
  const { columns, rows } = await runLive(sql, opts.limit ?? 1000);
  const result: QueryResult = {
    id,
    sql: normalizeSql(sql),
    columns,
    rows,
    ms: Math.round(performance.now() - t0),
    mode: "live",
    ranAt: new Date().toISOString(),
    sources: sourcesOf(sql),
  };
  if (process.env.ZETARIS_RECORD !== "0") await writeRecord(result);
  if (process.env.ZETARIS_MEMO_DQ === "1" && /^\s*RUN DQ/i.test(sql)) memo.set(id, result);
  return result;
}

/** SQL string literal: Zetaris Lightning SQL uses single quotes, doubled to escape. */
export function lit(v: string | number): string {
  return typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
}
