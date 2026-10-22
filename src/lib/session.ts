// The approver's session: a short-lived token the server signs after the demo sign-in (staff member + demo PIN).
// /api/approve takes the approver's name and role only from a token that verifies here, never from the request
// body. HMAC-SHA256 with SCOUT_SIGNING_SECRET under its own purpose prefix, so a session token can never be
// mistaken for (or replayed as) a Scout execution contract, which is signed with the same secret.
import crypto from "node:crypto";
import { RateLimiter } from "../engines/scout/guard";
import { staffById, type StaffRole } from "../agent/staff";

// Without SCOUT_SIGNING_SECRET the secret is random per process: no public fallback can mint a session.
const SECRET = process.env.SCOUT_SIGNING_SECRET ?? crypto.randomBytes(32).toString("hex");
const PURPOSE = "upstream.session.v1";
export const SESSION_TTL_MS = 15 * 60 * 1000;

export interface Session {
  sub: string;
  name: string;
  role: StaffRole;
  iat: number;
  exp: number;
  jti: string;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const mac = (payload: string) => crypto.createHmac("sha256", SECRET).update(`${PURPOSE}\n${payload}`).digest("base64url");

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function issueSession(staffId: string, now = Date.now()): { token: string; session: Session } {
  const s = staffById(staffId);
  if (!s) throw new Error("unknown staff member");
  const session: Session = { sub: s.id, name: s.name, role: s.role, iat: now, exp: now + SESSION_TTL_MS, jti: crypto.randomBytes(9).toString("base64url") };
  const payload = b64(JSON.stringify(session));
  return { token: `${payload}.${mac(payload)}`, session };
}

export type SessionCheck = { ok: true; session: Session } | { ok: false; reason: string };

/** Verify signature, expiry, and that the person is still on the roster with the same role. */
export function verifySession(token: string | null | undefined, now = Date.now()): SessionCheck {
  if (!token) return { ok: false, reason: "not signed in" };
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: "malformed session" };
  if (!sameString(sig, mac(payload))) return { ok: false, reason: "session signature does not verify" };
  let s: Session;
  try {
    s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
  } catch {
    return { ok: false, reason: "malformed session" };
  }
  if (typeof s.exp !== "number" || now >= s.exp) return { ok: false, reason: "session expired; sign in again" };
  const member = staffById(s.sub);
  if (!member || member.name !== s.name || member.role !== s.role) return { ok: false, reason: "session does not match the staff roster" };
  return { ok: true, session: s };
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/** Client address for rate limits (first hop of x-forwarded-for on Vercel). */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

const pinLimiter = new RateLimiter();

/** Demo sign-in: staff id + demo PIN. Five tries a minute per address and person. */
export function signIn(staffId: string, pin: string, ip: string, now = Date.now()): { ok: true; token: string; session: Session } | { ok: false; status: number; reason: string } {
  if (!pinLimiter.take(`${ip}|${staffId}`, 5, now)) return { ok: false, status: 429, reason: "Too many tries; wait a minute." };
  const member = staffById(staffId);
  if (!member) return { ok: false, status: 400, reason: "Pick a name from the Corvale pharmacy roster." };
  if (!sameString(String(pin ?? "").trim(), member.demoPin)) return { ok: false, status: 401, reason: "That PIN does not match. The demo PIN is printed next to the name." };
  const { token, session } = issueSession(member.id, now);
  return { ok: true, token, session };
}
