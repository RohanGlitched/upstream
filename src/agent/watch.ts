// The overnight watch: every drug on Corvale's formulary, checked in Markovian chunks. Each chunk is one
// federated Zetaris query (stock + FDA shortage list + FDA actions at the plants on our labels); the cursor
// and findings live in World Model, so a crashed run resumes where it stopped. Nemotron Lightning writes the
// morning brief from the flagged drugs only.
import { query, type Row } from "../lib/zetaris";
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
  /** The presentation the day counts are for (the shortest shelf), e.g. "10 mg/mL injection, 60 mL vial". */
  presentation?: string;
  /** Every presentation of the drug, shortest shelf first. Days are never pooled across presentations. */
  presentations?: WatchPresentation[];
  /** No FDA signal: flagged only because a presentation's shelf is under LOW_SHELF days somewhere (a reorder). */
  lowShelfOnly?: boolean;
  /** Set when the presentation whose figures make the drug "act" is not the shortest shelf (its label). */
  actBy?: string;
}

export interface WatchPresentation {
  key: string;
  label: string;
  short: string;
  /** Days on hand at this presentation's shortest hospital, and which hospital. */
  minDays: number | null;
  hospital: string | null;
  /** Days on hand for this presentation across all three hospitals. */
  systemDays: number | null;
  hospitals: { hospital: string; days: number | null }[];
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


/** Under this many days at any hospital, a presentation is on watch even with nothing on FDA's record (a reorder). */
const LOW_SHELF = 3;

/** Stock per hospital and presentation: what makes a presentation (strength, form, the content of one unit and the
 *  unit it is counted in) is grouped on here, so 60 mL and 5 mL vials are never pooled. */
function rosterSql(): string {
  return `SELECT lower(p.generic_name) AS molecule, s.hospital, p.strength, p.dosage_form, p.unit_content, s.unit,
       sum(s.on_hand) AS on_hand, sum(s.daily_use) AS daily_use, concat_ws('|', collect_set(s.ndc11)) AS ndc11s
FROM (SELECT * FROM ${USL}.stock_general UNION ALL SELECT * FROM ${USL}.stock_east UNION ALL SELECT * FROM ${USL}.stock_lakeside) s
JOIN ${USL}.product p ON p.ndc11 = s.ndc11
GROUP BY lower(p.generic_name), s.hospital, p.strength, p.dosage_form, p.unit_content, s.unit`;
}

/** The case pipeline's presentation (src/agent/investigate.ts presentationOf), kept in step with it so the watch
 *  and a drug's case show the same days: ingredient, strength, form, unit content and unit. */
function presentationOf(r: Row): { key: string; label: string; short: string } {
  const unit = str(r.unit) || "each";
  const strength = [...str(r.strength).matchAll(/(\.?\d[\d.,]*)\s*([a-z%]+)(?:\s*\/\s*(\.?\d[\d.]*)?\s*([a-z]+))?/gi)]
    .map((m) => {
      const per = m[4] ? `/${m[3] && m[3] !== "1" ? `${m[3].replace(/^\./, "0.")} ` : ""}${m[4]}` : "";
      return `${m[1].replace(/^\./, "0.")} ${m[2]}${per}`;
    })
    .join(" + ");
  const form = str(r.dosage_form).toLowerCase().split(/[ ,]/)[0] || "";
  const content = str(r.unit_content).replace(/^\./, "0.");
  return {
    key: [str(r.molecule).toLowerCase().trim(), strength.toLowerCase().replace(/\s+/g, ""), form, content.toLowerCase().replace(/\s+/g, ""), unit].join("|"),
    label: `${strength}${form ? ` ${form}` : ""}${content ? `, ${content} ${unit}` : ""}`.trim(),
    short: [strength, content].filter(Boolean).join(", ") || str(r.molecule),
  };
}

const daysOf = (onHand: number, daily: number) => (daily > 0 ? round(onHand / daily, 1) : null);

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
  // Days on hand are computed per presentation and hospital, never pooled across presentations: the drug's
  // figures are its shortest presentation's (minDays at its shortest hospital, systemDays across all three).
  type Pres = { key: string; label: string; short: string; perHospital: Map<string, { onHand: number; daily: number }> };
  const byMol = new Map<string, { ndc11s: Set<string>; names: Set<string>; pres: Map<string, Pres>; presentations: WatchPresentation[]; lead: WatchPresentation | null }>();
  for (const r of roster.rows) {
    const m = baseMolecule(str(r.molecule));
    const e = byMol.get(m) ?? { ndc11s: new Set<string>(), names: new Set<string>(), pres: new Map(), presentations: [], lead: null };
    str(r.ndc11s).split("|").filter(Boolean).forEach((n) => e.ndc11s.add(n));
    e.names.add(str(r.molecule));
    const pr = presentationOf(r);
    const p = e.pres.get(pr.key) ?? { ...pr, perHospital: new Map() };
    const h = p.perHospital.get(str(r.hospital)) ?? { onHand: 0, daily: 0 };
    h.onHand += num(r.on_hand);
    h.daily += num(r.daily_use);
    p.perHospital.set(str(r.hospital), h);
    e.pres.set(pr.key, p);
    byMol.set(m, e);
  }
  for (const e of byMol.values()) {
    e.presentations = [...e.pres.values()].map((p): WatchPresentation => {
      const hospitals = [...p.perHospital.entries()].map(([hospital, h]) => ({ hospital, days: daysOf(h.onHand, h.daily) })).sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
      const tot = [...p.perHospital.values()].reduce((a, h) => ({ onHand: a.onHand + h.onHand, daily: a.daily + h.daily }), { onHand: 0, daily: 0 });
      const low = hospitals.find((h) => h.days !== null) ?? null;
      return { key: p.key, label: p.label, short: p.short, minDays: low?.days ?? null, hospital: low?.hospital ?? null, systemDays: daysOf(tot.onHand, tot.daily), hospitals };
    });
    e.presentations.sort((a, b) => (a.minDays ?? 1e9) - (b.minDays ?? 1e9) || (a.systemDays ?? 1e9) - (b.systemDays ?? 1e9));
    e.lead = e.presentations.find((p) => p.minDays !== null) ?? e.presentations[0] ?? null;
  }
  log(`roster: ${byMol.size} molecules, ${[...byMol.values()].reduce((a, e) => a + e.presentations.length, 0)} presentations across ${new Set(roster.rows.map((r) => r.hospital)).size} hospitals`);

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
        const lead = byMol.get(d.name)!.lead;
        const minDays = lead?.minDays ?? Infinity;
        const reasons: string[] = [];
        if (sig.some((s) => s.kind === "shortage")) reasons.push("on FDA's shortage list");
        const plantActs = sig.filter((s) => s.kind !== "shortage");
        if (plantActs.length) reasons.push(`${plantActs.length} FDA actions at plants on our labels since ${Number(AS_OF.slice(0, 4)) - 3}`);
        if (minDays < 10) reasons.push(`${round(minDays, 1)} days on hand of ${lead!.label} at ${lead!.hospital}, ${lead!.systemDays ?? "-"} across the system`);
        // A signal flags the drug. Low stock alone is a reorder, not a shortage, but a shelf under LOW_SHELF days
        // still goes on watch so it never files as quiet.
        return { drugId: d.id, status: sig.length > 0 || minDays < LOW_SHELF ? "flagged" : "ok", reasons };
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
    const lead = e.lead;
    const listed = sig.some((s) => s.kind === "shortage");
    const plantActs = sig.filter((s) => s.kind !== "shortage");
    const minDays = lead?.minDays ?? null;
    const systemDays = lead?.systemDays ?? null;
    // The tier reads each presentation's own figures, never a pool of vial sizes: a listed drug is "act" when any
    // presentation is under 14 days across the system, or under 3 days at a hospital and under 21 across the system.
    const actsOn = (p: WatchPresentation) => {
      const sys = p.systemDays ?? Infinity;
      return sys < 14 || ((p.minDays ?? Infinity) < 3 && sys < 21);
    };
    const actBy = listed ? e.presentations.find(actsOn) : undefined;
    const act = !!actBy;
    const lowShelfOnly = sig.length === 0;
    flagged.push({
      molecule: name, display: [...e.names].sort((a, b) => a.length - b.length)[0].slice(0, 60), minDays, hospital: lead?.hospital ?? null, systemDays,
      state: act ? "act" : "watch",
      signal: lowShelfOnly
        ? `low shelf, nothing on FDA's record`
        : [listed ? "FDA shortage list" : null, plantActs.length ? `${[...new Set(plantActs.map((s) => s.kind === "oai" ? "OAI inspection" : s.kind === "action" ? s.detail : "import alert"))].join(", ")} at ${[...new Set(plantActs.map((s) => s.firm))].slice(0, 2).join(", ")}` : null].filter(Boolean).join("; "),
      headline: "", slug: opts.knownCases?.includes(baseMolecule(name).replace(/ /g, "-")) ? baseMolecule(name).replace(/ /g, "-") : undefined,
      presentation: lead?.label, presentations: e.presentations, ...(lowShelfOnly ? { lowShelfOnly } : {}),
      ...(actBy && actBy.key !== lead?.key ? { actBy: actBy.label } : {}),
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
  // The presentation label stays out of the headline: headlines are grounded against the brief's lines, which
  // carry the day counts but not the strengths. The label rides on f.presentation for the pages.
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
