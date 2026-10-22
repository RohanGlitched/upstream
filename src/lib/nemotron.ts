// NVIDIA Nemotron through NVIDIA's OpenAI-compatible endpoint. Every response is cached under a hash of the
// exact request, so a replay or a re-score never pays twice and the hosted demo can replay recorded answers.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const MODELS = {
  // Measured Oct 22 with the live key: Ultra 2.9 s, Lightning 0.5 s for a strict-JSON ping.
  // nemotron-3-super-120b-a12b is listed in the catalogue but returns 404, so it is not used.
  reason: process.env.NEMOTRON_REASON_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b",
  fast: process.env.NEMOTRON_FAST_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
} as const;

const BASE = process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const CACHE_DIR = process.env.NEMOTRON_CACHE_DIR ?? path.join(process.cwd(), "data", "replay", "nemotron");

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  ms: number;
  cached: boolean;
}

export const tally = { calls: 0, cachedCalls: 0, tokensIn: 0, tokensOut: 0 };

export class ModelError extends Error {}

export async function chat(
  messages: ChatMessage[],
  opts: { model?: string; maxTokens?: number; temperature?: number; json?: boolean } = {},
): Promise<ChatResult> {
  const body = {
    model: opts.model ?? MODELS.reason,
    messages,
    max_tokens: opts.maxTokens ?? 1200,
    temperature: opts.temperature ?? 0.1,
    // Strict-JSON calls with thinking on spend the budget thinking (playbook N3).
    chat_template_kwargs: { enable_thinking: false },
  };
  const key = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 24);
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    const hit = JSON.parse(await readFile(file, "utf8")) as ChatResult;
    tally.cachedCalls++;
    return { ...hit, cached: true };
  } catch {
    // not cached
  }
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || process.env.UPSTREAM_MODE === "replay") {
    throw new ModelError("No recorded model answer for this request, and the live model is not available here.");
  }
  const t0 = performance.now();
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.NEMOTRON_TIMEOUT_MS ?? 90_000)),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      detail?: string;
    };
    if (!res.ok) throw new ModelError(`Nemotron returned HTTP ${res.status}: ${j.detail ?? ""}`.trim());
    const out: ChatResult = {
      text: j.choices?.[0]?.message?.content ?? "",
      model: body.model,
      tokensIn: j.usage?.prompt_tokens ?? 0,
      tokensOut: j.usage?.completion_tokens ?? 0,
      ms: Math.round(performance.now() - t0),
      cached: false,
    };
    tally.calls++;
    tally.tokensIn += out.tokensIn;
    tally.tokensOut += out.tokensOut;
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(out));
    return out;
  }
  throw new ModelError(`Nemotron unavailable after retries (${lastErr}).`);
}

/** The first JSON object or array in a model reply (models sometimes wrap JSON in prose or fences). */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start < 0) throw new ModelError("The model reply contained no JSON.");
  const open = raw[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(raw.slice(start, i + 1)) as T;
  }
  throw new ModelError("The model reply had unbalanced JSON.");
}
