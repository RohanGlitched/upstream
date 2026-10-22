// The overnight watch: every drug on Corvale's formulary, checked in Markovian chunks. Each chunk is one
// federated Zetaris query (stock + FDA shortage list + FDA actions at the plants on our labels); the cursor
// and findings live in World Model, so a crashed run resumes where it stopped. Nemotron Lightning writes the
// morning brief from the flagged drugs only.
import { query } from "../lib/zetaris";
import { chat, MODELS, tally } from "../lib/nemotron";
import { FormularyWatch, type DrugFinding, type WatchDrug } from "../engines/markovian.ts";
import { UpstreamWorld, src } from "../engines/world-model.ts";
import { USL } from "./sql";
import { baseMolecule, inList, num, round, str } from "./util";
export { baseMolecule };
import { groundWatch, watchHeader, watchLine, type Grounding } from "./ground";

export interface WatchFlag {
  molecule: string;
  /** The product name a buyer would recognise (shortest generic name in this group). */
  display: string;
  minDays: number | null;
  systemDays: number | null;
  hospital: string | null;
  state: "act" | "watch";
  signal: string;
  headline: string;
  slug?: string;
}

export interface WatchLatest {
  ranAt: string;
  asOf: string;
  drugs: number;
  chunks: number;
  ms: number;
  queries: number;
  tokens: { estimated: number; measured: number };
  brief: string;
  briefModel: string | null;
  /** The grounding check on the model's brief and headlines: every date and number must be in the watch rows. */
  briefCheck?: Grounding;
  flagged: WatchFlag[];
  quiet: number;
  markovian: { runs: number; batchSize: number; promptTokensMin: number; promptTokensMax: number };
}

const AS_OF = process.env.UPSTREAM_AS_OF ?? "2026-10-21";


function rosterSql(): string {
  return `SELECT lower(p.generic_name) AS molecule, s.hospital, sum(s.on_hand) AS on_hand, sum(s.daily_use) AS daily_use,
       concat_ws('|', collect_set(s.ndc11)) AS ndc11s
FROM (SELECT * FROM ${USL}.stock_general UNION ALL SELECT * FROM ${USL}.stock_east UNION ALL SELECT * FROM ${USL}.stock_lakeside) s
JOIN ${USL}.product p ON p.ndc11 = s.ndc11
GROUP BY lower(p.generic_name), s.hospital`;
}

function chunkSql(ndc11s: string[]): string {
  return `WITH ours AS (SELECT ndc11, package_ndc, lower(generic_name) AS molecule, spl_set_id FROM ${USL}.product WHERE ndc11 IN (${inList(ndc11s)})),
plants AS (SELECT o.molecule, st.fei, st.firm_name FROM ours o
           JOIN ${USL}.product_site ps ON ps.set_id = o.spl_set_id
           JOIN ${USL}.site st ON st.duns = ps.est_duns)
SELECT 'shortage' AS kind, o.molecule, sc.company_name AS firm, sc.status AS detail, sc.initial_posting_date AS dt
FROM ours o JOIN fda.shortage_current sc ON sc.package_ndc = o.package_ndc WHERE sc.status = 'Current'
UNION ALL
SELECT 'oai', p.molecule, p.firm_name, i.inspection_id, i.end_date
FROM plants p JOIN ${USL}.inspection i ON i.fei = p.fei
WHERE i.classification = 'OAI' AND i.end_date >= '${Number(AS_OF.slice(0, 4)) - 3}${AS_OF.slice(4)}'
UNION ALL
SELECT 'action', p.molecule, p.firm_name, ca.action_type, ca.action_date
FROM plants p JOIN fda.compliance_actions ca ON ca.fei = p.fei
WHERE ca.action_date >= '${Number(AS_OF.slice(0, 4)) - 3}${AS_OF.slice(4)}'
UNION ALL
SELECT 'import_alert', p.molecule, p.firm_name, ia.alert, ia.date_published
FROM plants p JOIN fda.import_alerts ia ON ia.fei = p.fei
WHERE ia.date_published >= '${Number(AS_OF.slice(0, 4)) - 3}${AS_OF.slice(4)}'`;
}

export async function runWatch(opts: { world?: UpstreamWorld; knownCases?: string[]; log?: (s: string) => void } = {}): Promise<WatchLatest> {
  const t0 = Date.now();
  const log = opts.log ?? (() => {});
  const world = opts.world ?? new UpstreamWorld({ storage: "memory" });
  const tallyStart = { ...tally };
  let queries = 0;

  const roster = await query(rosterSql(), { limit: 5000 });
  queries++;
  // One line per base molecule ("lidocaine hydrochloride anhydrous" and "lidocaine hydrochloride" are one drug to a buyer).
  const byMol = new Map<string, { ndc11s: Set<string>; names: Set<string>; perHospital: Map<string, { onHand: number; daily: number }>; hospitals: { hospital: string; days: number | null }[]; systemDays: number | null }>();
  for (const r of roster.rows) {
    const m = baseMolecule(str(r.molecule));
    const e = byMol.get(m) ?? { ndc11s: new Set<string>(), names: new Set<string>(), perHospital: new Map(), hospitals: [], systemDays: null };
    str(r.ndc11s).split("|").filter(Boolean).forEach((n) => e.ndc11s.add(n));
    e.names.add(str(r.molecule));
    const h = e.perHospital.get(str(r.hospital)) ?? { onHand: 0, daily: 0 };
    h.onHand += num(r.on_hand);
    h.daily += num(r.daily_use);
    e.perHospital.set(str(r.hospital), h);
    byMol.set(m, e);
  }
  for (const e of byMol.values()) {
    e.hospitals = [...e.perHospital.entries()].map(([hospital, h]) => ({ hospital, days: h.daily > 0 ? round(h.onHand / h.daily, 1) : null }));
    const tot = [...e.perHospital.values()].reduce((a, h) => ({ onHand: a.onHand + h.onHand, daily: a.daily + h.daily }), { onHand: 0, daily: 0 });
    e.systemDays = tot.daily > 0 ? round(tot.onHand / tot.daily, 1) : null;
  }
  log(`roster: ${byMol.size} molecules across ${new Set(roster.rows.map((r) => r.hospital)).size} hospitals`);

  const drugs: WatchDrug[] = [];
  for (const m of [...byMol.keys()].sort()) {
    const e = await world.upsert("Drug", `generic:${m.replace(/[^a-z0-9 .%/,-]/g, " ").trim().slice(0, 90) || "unknown"}`, { name: m, source: src("zetaris", "upstream-watch", new Date().toISOString()) });
    drugs.push({ id: e.id, name: m });
  }

  const signalsByMol = new Map<string, { kind: string; firm: string; detail: string; dt: string }[]>();
  const watch = new FormularyWatch({
    world,
    batchSize: 12,
    checker: async (batch) => {
      const ndcs = batch.flatMap((d) => [...(byMol.get(d.name)?.ndc11s ?? [])]);
      const r = await query(chunkSql(ndcs), { limit: 5000 });
      queries++;
      for (const row of r.rows) {
        const m = baseMolecule(str(row.molecule));
        const list = signalsByMol.get(m) ?? [];
        list.push({ kind: str(row.kind), firm: str(row.firm), detail: str(row.detail), dt: str(row.dt) });
        signalsByMol.set(m, list);
      }
      return batch.map((d): DrugFinding => {
        const sig = signalsByMol.get(d.name) ?? [];
        const e = byMol.get(d.name)!;
        const minDays = Math.min(...e.hospitals.map((h) => h.days ?? Infinity));
        const reasons: string[] = [];
        if (sig.some((s) => s.kind === "shortage")) reasons.push("on FDA's shortage list");
        const plantActs = sig.filter((s) => s.kind !== "shortage");
        if (plantActs.length) reasons.push(`${plantActs.length} FDA actions at plants on our labels since ${Number(AS_OF.slice(0, 4)) - 3}`);
        if (minDays < 10) reasons.push(`${round(minDays, 1)} days on hand at the lowest hospital, ${e.systemDays ?? "-"} across the system`);
        // A signal is needed to flag; low stock alone is a reorder, not a shortage.
        return { drugId: d.id, status: sig.length > 0 ? "flagged" : "ok", reasons };
      });
    },
  });
  const report = await watch.run(`watch-${AS_OF}`, drugs);
  log(`watch: ${report.processed}/${report.total} drugs in ${report.totals.chunks} chunks, ${report.flagged.length} flagged`);

  const flagged: WatchFlag[] = [];
  for (const id of report.flagged) {
    const name = drugs.find((d) => d.id === id)?.name ?? id;
    const e = byMol.get(name)!;
    const sig = signalsByMol.get(name) ?? [];
    const low = [...e.hospitals].sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9))[0];
    const listed = sig.some((s) => s.kind === "shortage");
    const plantActs = sig.filter((s) => s.kind !== "shortage");
    const minDays = low?.days ?? null;
    const sys = e.systemDays ?? Infinity;
    const act = listed && (sys < 14 || ((minDays ?? Infinity) < 3 && sys < 21));
    flagged.push({
      molecule: name, display: [...e.names].sort((a, b) => a.length - b.length)[0].slice(0, 60), minDays, hospital: low?.hospital ?? null, systemDays: e.systemDays,
      state: act ? "act" : "watch",
      signal: [listed ? "FDA shortage list" : null, plantActs.length ? `${[...new Set(plantActs.map((s) => s.kind === "oai" ? "OAI inspection" : s.kind === "action" ? s.detail : "import alert"))].join(", ")} at ${[...new Set(plantActs.map((s) => s.firm))].slice(0, 2).join(", ")}` : null].filter(Boolean).join("; "),
      headline: "", slug: opts.knownCases?.includes(baseMolecule(name).replace(/ /g, "-")) ? baseMolecule(name).replace(/ /g, "-") : undefined,
    });
  }
  flagged.sort((a, b) => (a.state === b.state ? (a.minDays ?? 1e9) - (b.minDays ?? 1e9) : a.state === "act" ? -1 : 1));

  let brief = "";
  let briefModel: string | null = null;
  try {
    const r = await chat(
      [
        { role: "system", content: 'You write a hospital pharmacy buyer\'s morning shortage brief. Use only the lines given. Reply with JSON: {"brief": "2-3 plain sentences overall", "headlines": {"<molecule>": "one short plain sentence"}}. Every day count is days of stock on hand: write "N days on hand", never "an N-day shortage". Do not call a drug short unless its line says it is on the FDA list. No advice on dosing. Calm, specific.' },
        { role: "user", content: `${watchHeader(AS_OF, report.total, flagged.length)}\n` + flagged.slice(0, 30).map(watchLine).join("\n") },
      ],
      { model: MODELS.fast, maxTokens: 1400 },
    );
    const j = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)) as { brief?: string; headlines?: Record<string, string> };
    brief = j.brief ?? "";
    briefModel = r.model;
    for (const f of flagged) f.headline = j.headlines?.[f.molecule] ?? "";
  } catch {
    brief = `${flagged.length} of ${report.total} formulary drugs need attention this morning.`;
  }
  const ruleHeadline = (f: WatchFlag) => `${f.signal}${f.minDays !== null ? `; ${f.minDays} days at ${f.hospital}` : ""}.`;
  for (const f of flagged) if (!f.headline) f.headline = ruleHeadline(f);
  // The model's brief and headlines are checked against the rows it was given: failing sentences are dropped and
  // a failing headline falls back to the rule-written line.
  const checked = groundWatch({ asOf: AS_OF, drugs: report.total, quiet: report.total - flagged.length, brief, flagged }, ruleHeadline);
  brief = checked.brief || `${flagged.length} of ${report.total} formulary drugs need attention this morning.`;

  return {
    ranAt: new Date().toISOString(), asOf: AS_OF, drugs: report.total, chunks: report.totals.chunks, ms: Date.now() - t0, queries,
    tokens: { estimated: report.totals.promptTokens + report.totals.outputTokens, measured: tally.tokensIn - tallyStart.tokensIn + (tally.tokensOut - tallyStart.tokensOut) },
    brief, briefModel, briefCheck: checked.grounding, flagged: checked.flagged, quiet: report.total - flagged.length,
    markovian: { runs: report.markovianRuns.length, batchSize: report.batchSize, promptTokensMin: report.totals.promptTokensMin, promptTokensMax: report.totals.promptTokensMax },
  };
}
