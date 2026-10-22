#!/usr/bin/env node
// Runs every Meterless conformance suite against OUR integration modules and
// writes CONFORMANCE.md + conformance.json. Exit 1 if any suite fails.
// Layout assumed (Upstream repo):
//   vendor/meterless/{hmem,world-model,markovian,scout-intent}/   <- degit copies (conformance/ or evals/ inside)
//   src/engines/{hmem,world-model,markovian,scout}.ts             <- OUR modules that re-export / wrap the engine classes
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), process.env.UPSTREAM_ROOT ?? "..");
const V = (p) => path.join(root, "vendor/meterless", p);
const S = (p) => path.join(root, "src/engines", p);
const fwd = (p) => p.split("\\").join("/"); // docs: "On Windows, use forward slashes and an absolute path"
const suites = [
  { engine: "H-MEM",       cwd: V("hmem/reference"),         cmd: ["tsx", fwd(V("hmem/conformance/runner.ts"))],         env: { HMEM_IMPL: fwd(S("hmem.ts")) } },
  { engine: "World Model", cwd: V("world-model/reference"),  cmd: ["tsx", fwd(V("world-model/conformance/runner.ts"))],  env: { WORLD_MODEL_IMPL: fwd(S("world-model.ts")) } },
  { engine: "Markovian",   cwd: V("markovian/reference"),    cmd: ["tsx", fwd(V("markovian/conformance/runner.ts"))],    env: { MARKOVIAN_IMPL: fwd(S("markovian.ts")) } },
  { engine: "Scout Intent",cwd: V("scout-intent"),           cmd: ["tsx", "evals/runner/index.ts", "all"],                env: { SCOUT_IMPL: fwd(S("scout.ts")) } },
];
const results = [];
for (const s of suites) {
  const bin = path.join(s.cwd, "node_modules/.bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const r = spawnSync(fs.existsSync(bin) ? bin : "npx", fs.existsSync(bin) ? s.cmd.slice(1) : s.cmd, { cwd: s.cwd, env: { ...process.env, ...s.env }, encoding: "utf8", shell: process.platform === "win32", timeout: 180_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "") + (r.error ? String(r.error) : "");
  const m = out.match(/(\d+)\/(\d+) checks passed/);
  let summary = m ? `${m[1]}/${m[2]} checks passed` : null;
  if (!summary && s.engine === "Scout Intent") {
    const get = (k) => out.match(new RegExp(k + String.raw`\s*│\s*([\d.]+)`))?.[1];
    summary = r.status === 0 ? `gate PASS (top1 ${get("intent_top1")}, inj P/R ${get("injection_precision")}/${get("injection_recall")}, tool ${get("tool_precision")}, clarif ${get("clarification_rate")})` : `gate FAIL (exit ${r.status})`;
  }
  results.push({ engine: s.engine, exit: r.status, pass: r.status === 0, summary: summary ?? `exit ${r.status}`, tail: out.split("\n").slice(-8).join("\n") });
}
fs.writeFileSync(path.join(root, "conformance.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const md = ["# Meterless conformance", "", `_Run ${new Date().toISOString()} against our integration modules in src/engines/_`, "", "| Engine | Result | Detail |", "|---|---|---|",
  ...results.map((r) => `| ${r.engine} | ${r.pass ? "PASS" : "FAIL"} | ${r.summary} |`), ""].join("\n");
fs.writeFileSync(path.join(root, "CONFORMANCE.md"), md);
console.log(md);
process.exit(results.every((r) => r.pass) ? 0 : 1);
