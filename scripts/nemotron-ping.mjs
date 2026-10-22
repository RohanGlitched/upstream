// Ping each candidate Nemotron model with the live key: latency and whether strict JSON comes back.
//   node scripts/nemotron-ping.mjs
import { readFileSync } from "node:fs";

const key = readFileSync(new URL("../../keys/nvidia.env", import.meta.url), "utf8").match(/NVIDIA_API_KEY=(\S+)/)[1];
const models = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3.5-lightning-30b-a3b", "nvidia/nemotron-nano-3-30b-a3b"];

for (const model of models) {
  const t0 = Date.now();
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: 'Reply with exactly this JSON and nothing else: {"ok": true, "word": "carboplatin"}' }],
        max_tokens: 60,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 160);
    console.log(`${model}  ${res.status}  ${Date.now() - t0} ms  ${text.replace(/\s+/g, " ").slice(0, 100)}  usage=${JSON.stringify(j.usage ?? {})}`);
  } catch (e) {
    console.log(`${model}  ERROR ${Date.now() - t0} ms  ${e.message}`);
  }
}
