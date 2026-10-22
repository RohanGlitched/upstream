"use client";

import { useEffect, useState } from "react";

export type ApiState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "missing" } // the endpoint or its file is not there yet
  | { status: "error"; message: string };

/** GET a JSON endpoint that may not exist yet. A 404 or a non-JSON reply is "missing", not a crash. */
export function useApi<T>(url: string, validate: (x: unknown) => x is T): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    const ctl = new AbortController();
    (async () => {
      try {
        const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
        if (r.status === 404 || r.status === 501) return alive && setState({ status: "missing" });
        const type = r.headers.get("content-type") ?? "";
        if (!type.includes("json")) return alive && setState({ status: "missing" });
        const body = (await r.json()) as unknown;
        if (!r.ok) {
          const msg = (body as { error?: string })?.error ?? `The server answered ${r.status}.`;
          return alive && setState({ status: "error", message: msg });
        }
        if (!validate(body)) return alive && setState({ status: "missing" });
        if (alive) setState({ status: "ready", data: body });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (alive) setState({ status: "error", message: "The request did not reach the server. Check the connection and reload." });
      }
    })();
    return () => {
      alive = false;
      ctl.abort();
    };
  }, [url, validate]);
  return state;
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ ok: true; data: T } | { ok: false; missing: boolean; message: string }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const type = r.headers.get("content-type") ?? "";
    if (r.status === 404 || r.status === 405 || !type.includes("json")) {
      return { ok: false, missing: true, message: "This copy of Upstream does not have that service yet." };
    }
    const data = (await r.json()) as T & { error?: string };
    if (!r.ok) return { ok: false, missing: false, message: data?.error ?? `The server answered ${r.status}.` };
    return { ok: true, data };
  } catch {
    return { ok: false, missing: false, message: "The request did not reach the server. Check the connection and try again." };
  }
}
