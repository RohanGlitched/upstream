// Upstream's investigator: fixed moves (one federated query per step), every tool call checked against the
// Scout execution contract, every entity written to World Model with provenance, every row kept as evidence.
// The model never decides a fact here; it only writes the explanation, which a verifier checks (explain.ts).
import { randomUUID } from "node:crypto";
import { query, type QueryResult, type Row } from "../lib/zetaris";
import { tally } from "../lib/nemotron";
import { assertContract, type ExecutionContract } from "../engines/scout/index.ts";
import { createUpstreamScout } from "../engines/scout/upstream.ts";
import { UpstreamWorld, src } from "../engines/world-model.ts";
import { openMemory, type HMEM } from "../engines/hmem.ts";
import * as Q from "./sql";
import { daysBetween, firmKey, num, round, str, tallMan } from "./util";
import { explain } from "./explain";
import type {
  Case, DataQualityNote, Evidence, GateEntry, Health, Hospital, MarketLine, MemoryLine, OptionLine, Plant,
  ProductChain, ShortageStatus, Signal, Step, StockLine, TimelineEvent,
} from "./types";

export const AS_OF = process.env.UPSTREAM_AS_OF ?? "2026-10-21";
const SIGNING_SECRET = process.env.SCOUT_SIGNING_SECRET ?? "upstream-local-dev-secret";

export interface InvestigateOptions {
  question: string;
  user?: { id: string; role: "buyer" | "pharmacist" | "director" | "technician" | "viewer" };
  world?: UpstreamWorld;
  memory?: HMEM;
  onStep?: (step: Step) => void;
  surface?: "chat" | "api" | "watch";
  /** skip the model-written explanation (watch runs and tests) */
  explain?: boolean;
}

class Ledger {
  readonly evidence: Record<string, Evidence> = {};
  readonly queries: Case["queries"] = {};
  private n = 0;
  record(r: QueryResult) {
    this.queries[r.id] = { id: r.id, sql: r.sql, ms: r.ms, mode: r.mode, sources: r.sources, ranAt: r.ranAt, rows: r.rows.length };
  }
  cite(r: QueryResult, row: number, label: string, fields?: Record<string, string | number | null>): string {
    const id = `E${++this.n}`;
    const f = fields ?? (r.rows[row] as Record<string, string | number | null>);
    this.evidence[id] = { id, queryId: r.id, row, label, fields: f };
    return id;
  }
}

function healthOf(insp: Row[], actions: Row[], alerts: Row[], asOf: string): { health: Health; last: Plant["lastClassification"] } {
  const yearsAgo = (d: string) => (Date.parse(asOf) - Date.parse(d)) / (365.25 * 86_400_000);
  const sorted = [...insp].sort((a, b) => str(b.end_date).localeCompare(str(a.end_date)));
  const last = sorted[0] ? { classification: str(sorted[0].classification), endDate: str(sorted[0].end_date) } : null;
  const recentOai = insp.some((r) => str(r.classification) === "OAI" && yearsAgo(str(r.end_date)) <= 3);
  const recentAction = actions.some((r) => yearsAgo(str(r.action_date)) <= 3);
  const recentAlert = alerts.some((r) => yearsAgo(str(r.date_published)) <= 3);
  if (recentOai || recentAction || recentAlert) return { health: "signal", last };
  if (last && last.classification === "VAI" && yearsAgo(last.endDate) <= 2) return { health: "watch", last };
  if (last && yearsAgo(last.endDate) <= 4) return { health: "clear", last };
  return { health: "unknown", last };
}

export async function investigate(opts: InvestigateOptions): Promise<Case> {
  const t0 = Date.now();
  const question = opts.question.trim();
  const user = opts.user ?? { id: "buyer-1", role: "buyer" as const };
  const ledger = new Ledger();
  const gate: GateEntry[] = [];
  const steps: Step[] = [];
  const world = opts.world ?? new UpstreamWorld({ storage: "memory" });
  const memory = opts.memory ?? openMemory();
  const caseId = `case-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`;
  const tallyStart = { ...tally };

  // ---- Scout: what is being asked, how risky, and what the agent may touch ------------------------------
  const scout = createUpstreamScout({ signingSecret: SIGNING_SECRET });
  const d = await scout.decide({ prompt: question, user, surface: opts.surface ?? "chat" });
  const contract: ExecutionContract | undefined = d.executionContract;
  const blank = (clarification: string | null): Case => ({
    id: caseId, question, askedAt: new Date().toISOString(), asOf: AS_OF, molecule: "",
    intent: { name: d.intent.primary, risk: d.risk.level, contractId: contract?.contractId ?? null, clarification },
    steps, stock: [], chain: [], shortage: { listed: false, status: null, firstPosting: null, companies: [], reasons: [], ourNdcsListed: [] },
    market: [], options: [], timeline: [], explanation: null, dataQuality: [], memory: [], memo: null, gate,
    evidence: {}, queries: {}, usage: { zetarisQueries: 0, zetarisMs: 0, modelCalls: 0, tokensIn: 0, tokensOut: 0, mode: "live" },
  });
  if (d.risk.level === "block" || !contract) {
    gate.push({ at: new Date().toISOString(), action: question.slice(0, 80), capability: "-", decision: "refused", reason: d.risk.reason ?? d.clarification?.question ?? "no contract issued" });
    return blank(d.clarification?.question ?? d.risk.reason ?? null);
  }
  const READ_INTENTS = new Set(["shortage.investigate", "supply.trace", "stock.check", "stock.days_on_hand", "stock.sister_surplus", "therapy.alternatives", "signal.explain"]);
  if (!READ_INTENTS.has(d.intent.primary)) {
    return blank(`That request maps to "${d.intent.primary}", which the investigation desk does not run. Ask why a drug is short, or what to do about it.`);
  }

  /** Every tool call: verify the contract for its capability first, and log the decision. */
  const guard = (capability: string, action: string): boolean => {
    try {
      assertContract(contract, capability, { secret: SIGNING_SECRET, engine: capability.split(".")[0] });
      gate.push({ at: new Date().toISOString(), action, capability, decision: "allowed", reason: `in contract ${contract.contractId.slice(-8)} scope` });
      return true;
    } catch (e) {
      gate.push({ at: new Date().toISOString(), action, capability, decision: "refused", reason: (e as Error).message.slice(0, 160) });
      return false;
    }
  };
  const canWrite = guard("world.write", "record the supply chain in World Model");
  const prov = (kind: string) => src(kind, "upstream-investigator", new Date().toISOString());

  const term = String(d.intent.parameters.drug ?? "").toLowerCase().split(/\s+/)[0] || question.toLowerCase().match(/[a-z]{5,}/)?.[0] || "";

  async function run(key: Step["key"], title: string, purpose: string, sqls: string[], finding: (rs: QueryResult[]) => string, limit = 2000) {
    const s0 = Date.now();
    const step: Step = { key, title, purpose, queryIds: [], sources: [], ms: 0, rows: 0, finding: "", status: "ok" };
    const results: QueryResult[] = [];
    if (!guard("zetaris.read", title)) {
      step.status = "failed";
      step.error = "refused by the Scout contract";
      steps.push(step);
      return results;
    }
    try {
      for (const sql of sqls) {
        const r = await query(sql, { limit });
        ledger.record(r);
        results.push(r);
        step.queryIds.push(r.id);
        step.sources.push(...r.sources);
        step.rows += r.rows.length;
      }
      step.finding = finding(results);
      if (!step.rows) step.status = "empty";
    } catch (e) {
      step.status = "failed";
      step.error = (e as Error).message.slice(0, 300);
      step.finding = "This step could not run, so the brief says less here.";
    }
    step.sources = [...new Set(step.sources)];
    step.ms = Date.now() - s0;
    steps.push(step);
    opts.onStep?.(step);
    return results;
  }

  // ---- 1. Our stock, in three systems --------------------------------------------------------------------
  const [stockR] = await run("stock", "Our stock in three hospitals", "Read on-hand stock and 28-day use where each hospital keeps it.",
    [Q.stockSql(term)], (rs) => `${rs[0].rows.length} stock lines across ${new Set(rs[0].rows.map((r) => r.hospital)).size} hospitals.`);
  const stock: StockLine[] = (stockR?.rows ?? []).map((r, i) => {
    const onHand = num(r.on_hand);
    const daily = num(r.daily_use);
    return {
      hospital: str(r.hospital) as Hospital, itemKey: str(r.item_key), ndc11: str(r.ndc11), description: str(r.description),
      labeler: r.labeler_name ? str(r.labeler_name) : null, onHand, dailyUse: daily, days: daily > 0 ? round(onHand / daily, 1) : null,
      unit: str(r.unit), ndcMatch: str(r.ndc_match),
      evidence: ledger.cite(stockR, i, `${r.hospital}: ${r.description}`.slice(0, 90)),
    };
  });
  const generics = new Map<string, number>();
  for (const r of stockR?.rows ?? []) if (r.generic_name) generics.set(str(r.generic_name).toLowerCase(), (generics.get(str(r.generic_name).toLowerCase()) ?? 0) + 1);
  const molecule = [...generics.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? term;
  const dosageWord = /inject/i.test(str(stockR?.rows.find((r) => r.dosage_form)?.dosage_form)) ? "inject" : str(stockR?.rows.find((r) => r.dosage_form)?.dosage_form).toLowerCase().split(/[ ,]/)[0] || "";

  if (canWrite) {
    const drug = await world.upsert("Drug", `generic:${molecule.slice(0, 90)}`, { name: molecule, source: prov("zetaris") });
    for (const [i, s] of stock.entries()) {
      const row = stockR.rows[i];
      if (!row.package_ndc) continue;
      const item = await world.upsert("HospitalItem", `${s.itemKey}`, { name: `${s.hospital}: ${s.description}`.slice(0, 120), source: prov("zetaris") });
      const pkg = await world.upsert("Package", str(row.package_ndc), { source: prov("zetaris") });
      const prodNdc = str(row.package_ndc).split("-").slice(0, 2).join("-");
      const prod = await world.upsert("Product", prodNdc, { name: str(row.generic_name), source: prov("zetaris") });
      const lab = await world.upsert("Labeler", prodNdc.split("-")[0], { name: str(row.labeler_name), source: prov("zetaris") });
      await world.relate(item.id, "stocks", pkg.id, { source: prov("zetaris") });
      await world.relate(pkg.id, "package-of", prod.id, { source: prov("zetaris") });
      await world.relate(prod.id, "of-drug", drug.id, { source: prov("zetaris") });
      await world.relate(prod.id, "labeled-by", lab.id, { source: prov("zetaris") });
    }
  }

  // ---- 2. Where it comes from: the plants named on our products' labels ---------------------------------
  const ourProducts = new Map<string, Row>();
  for (const r of stockR?.rows ?? []) if (r.ndc11 && r.package_ndc && !ourProducts.has(str(r.ndc11))) ourProducts.set(str(r.ndc11), r);
  const setIds = [...new Set([...ourProducts.values()].map((r) => str(r.spl_set_id)).filter(Boolean))];
  const [chainR] = await run("chain", "Where our supply is made", "Follow each product's label to the plants it names, and place each plant in FDA's registration file.",
    [Q.chainSql(setIds)], (rs) => {
      const placed = rs[0].rows.filter((r) => r.fei).length;
      return `${rs[0].rows.length} plant links on ${setIds.length} labels; ${placed} placed in FDA's registration file.`;
    });

  // ---- 3. FDA's shortage list, today and since it began --------------------------------------------------
  const [curR, histR] = await run("fda_shortage", "What FDA says about this shortage", "Read FDA's current shortage list and its history for this drug.",
    [Q.shortageCurrentSql(molecule.split(" ")[0]), Q.shortageHistorySql(molecule.split(" ")[0])],
    (rs) => {
      const cur = rs[0].rows.filter((r) => str(r.status) === "Current");
      return cur.length ? `On FDA's list as Current for ${new Set(cur.map((r) => r.company_name)).size} companies.` : "Not on FDA's current shortage list.";
    });

  // ---- 4. Who else makes it ---------------------------------------------------------------------------
  const [marketR] = await run("market", "Who else makes it", "List every labeler of this drug in the same form, and the plants their labels name.",
    [Q.marketSql(molecule.split(" ")[0], dosageWord)], (rs) => `${new Set(rs[0].rows.map((r) => r.labeler_name)).size} labelers make it in this form.`);

  // ---- 5. Plant signals: inspections, 483s, warning letters, import alerts, recalls ------------------------
  const ourFeis = new Set((chainR?.rows ?? []).map((r) => str(r.fei)).filter(Boolean));
  const marketFeis = new Set((marketR?.rows ?? []).map((r) => str(r.fei)).filter(Boolean));
  const allFeis = [...new Set([...ourFeis, ...marketFeis])];
  const plantFirmKeys = [...new Set((chainR?.rows ?? []).flatMap((r) => [firmKey(str(r.establishment)), firmKey(str(r.firm_name))]).filter(Boolean))];
  const labelerKeys = [...new Set((stockR?.rows ?? []).map((r) => firmKey(str(r.labeler_name))).filter(Boolean))];
  const [inspR, actR, iaR, recR] = await run("signals", "What FDA found at those plants", "Read every FDA drug inspection, warning letter, import alert and recall for these plants.",
    [Q.inspectionsSql(allFeis), Q.actionsSql(allFeis), Q.importAlertsSql([...ourFeis], plantFirmKeys), Q.recallsSql(molecule.split(" ")[0], [...plantFirmKeys, ...labelerKeys])],
    (rs) => {
      const oai = rs[0].rows.filter((r) => str(r.classification) === "OAI" && ourFeis.has(str(r.fei))).length;
      return `${rs[0].rows.length} inspections (${oai} OAI at our plants), ${rs[1].rows.length} compliance actions, ${rs[2].rows.length} import-alert listings, ${rs[3].rows.length} recalls.`;
    });
  const oaiIds = (inspR?.rows ?? []).filter((r) => str(r.classification) === "OAI" && ourFeis.has(str(r.fei))).map((r) => str(r.inspection_id));
  let citR: QueryResult | undefined;
  if (oaiIds.length) {
    [citR] = await run("signals", "What FDA wrote at the OAI inspections", "Read the Form 483 observations recorded at those inspections.",
      [Q.citationsSql(oaiIds)], (rs) => `${rs[0].rows.length} Form 483 observations recorded.`);
  }

  // Build plants with evidence and health.
  const byFei = <T extends Row>(rows: T[] | undefined, fei: string) => (rows ?? []).filter((r) => str(r.fei) === fei);
  const chain: ProductChain[] = [];
  const plantSeen = new Map<string, Plant>();
  for (const [ndc11, prod] of ourProducts) {
    const stockIdx = (stockR?.rows ?? []).findIndex((r) => str(r.ndc11) === ndc11);
    const plants: Plant[] = [];
    (chainR?.rows ?? []).forEach((r, i) => {
      if (str(r.set_id) !== str(prod.spl_set_id)) return;
      const fei = r.fei ? str(r.fei) : null;
      const key = str(r.est_duns) || firmKey(str(r.establishment));
      const cached = plantSeen.get(key);
      if (cached) {
        plants.push(cached);
        return;
      }
      const insp = fei ? byFei(inspR?.rows, fei) : [];
      const acts = fei ? byFei(actR?.rows, fei) : [];
      const alerts = (iaR?.rows ?? []).filter((a) => (fei && str(a.fei) === fei) || (!str(a.fei) && plantFirmKeys.includes(str(a.firm_key)) && firmKey(str(a.firm)) === firmKey(str(r.establishment))));
      const { health, last } = fei ? healthOf(insp, acts, alerts.filter((a) => str(a.fei) === fei), AS_OF) : { health: "unknown" as Health, last: null };
      const signals: Signal[] = [];
      for (const x of insp) {
        const c = str(x.classification);
        if (c !== "OAI" && c !== "VAI") continue;
        signals.push({
          kind: c === "OAI" ? "inspection_oai" : "inspection_vai", date: str(x.end_date), knownDate: str(x.known_date), knownBasis: str(x.known_date_basis),
          fei, firm: str(x.legal_name), text: `FDA inspection ${x.inspection_id} ended ${x.end_date}, classified ${c}${x.known_date_basis === "fmd145_letter" ? `; classification letter ${x.known_date}` : ""}`,
          evidence: ledger.cite(inspR, inspR.rows.indexOf(x), `FDA inspection ${x.inspection_id} (${c})`),
        });
      }
      for (const x of acts) {
        const kind = /warning/i.test(str(x.action_type)) ? "warning_letter" : /injunction/i.test(str(x.action_type)) ? "injunction" : "seizure";
        signals.push({ kind, date: str(x.action_date), knownDate: str(x.action_date), knownBasis: "action date", fei, firm: str(x.legal_name),
          text: `${x.action_type} issued ${x.action_date} (case ${x.case_id})`, evidence: ledger.cite(actR, actR.rows.indexOf(x), `${x.action_type} ${x.action_date}`) });
      }
      for (const x of alerts) {
        signals.push({ kind: "import_alert", date: str(x.date_published), knownDate: str(x.date_published), knownBasis: "date published",
          fei: x.fei ? str(x.fei) : null, firm: str(x.firm), text: `Import alert ${x.alert} listing published ${x.date_published}${x.fei ? "" : " (matched by firm name; FDA gives no FEI)"}`,
          evidence: ledger.cite(iaR, iaR.rows.indexOf(x), `Import alert ${x.alert}, ${x.date_published}`) });
      }
      const plant: Plant = {
        key, name: str(r.establishment), duns: r.est_duns ? str(r.est_duns) : null, fei, country: r.country_iso3 ? str(r.country_iso3) : null,
        address: r.address ? str(r.address) : null, operations: str(r.est_operations), linkSource: str(r.site_source),
        linkQuality: fei ? "registered plant" : str(r.site_source) === "drugsfda_sponsor" ? "sponsor only" : "named on label, not placed",
        health, lastClassification: last, signals: signals.sort((a, b) => a.date.localeCompare(b.date)),
        evidence: [ledger.cite(chainR, i, `Label ${str(r.set_id).slice(0, 8)} names ${str(r.establishment)}`.slice(0, 90))],
      };
      plantSeen.set(key, plant);
      plants.push(plant);
    });
    chain.push({
      ndc11, packageNdc: str(prod.package_ndc), labeler: str(prod.labeler_name), generic: str(prod.generic_name), setId: prod.spl_set_id ? str(prod.spl_set_id) : null,
      plants, evidence: stockIdx >= 0 ? stock[stockIdx].evidence : "",
    });
  }
  // Recalls belong to the product or labeler, not a plant: attach as signals on the chain's first plant of that labeler.
  const recallSignals: Signal[] = (recR?.rows ?? []).map((x, i) => ({
    kind: "recall" as const, date: str(x.initiation_date), knownDate: str(x.report_date) || str(x.initiation_date), knownBasis: "recall report date",
    fei: null, firm: str(x.recalling_firm), text: `${x.classification} recall ${x.recall_number} by ${x.recalling_firm} started ${x.initiation_date}: ${str(x.reason).slice(0, 120)}`,
    evidence: ledger.cite(recR, i, `Recall ${x.recall_number}`),
  }));

  if (canWrite) {
    for (const pc of chain) {
      const prodId = `product:ndc-product:${pc.packageNdc.split("-").slice(0, 2).join("-")}`;
      for (const p of pc.plants) {
        if (!p.fei && !p.duns) continue;
        const site = await world.upsert("Site", p.fei ? `fei:${p.fei}` : `duns:${p.duns}`, { name: p.name, source: prov("dailymed-spl") });
        if (world.known(prodId)) await world.relate(prodId, "made-at", site.id, { source: prov("dailymed-spl") });
        for (const sgn of p.signals) {
          if (sgn.kind.startsWith("inspection")) {
            const insp = await world.upsert("Inspection", sgn.text.match(/inspection (\d+)/)?.[1] ?? "0", { source: prov("fda-inspection") });
            await world.relate(insp.id, "inspected", site.id, { source: prov("fda-inspection") });
            await world.assertFact(insp.id, "classification", sgn.kind === "inspection_oai" ? "OAI" : "VAI", { source: prov("fda-inspection") });
          } else if (sgn.kind === "warning_letter") {
            const wl = await world.upsert("WarningLetter", sgn.text.match(/case (\S+)\)/)?.[1] ?? sgn.date, { source: prov("fda-warning-letter") });
            await world.relate(wl.id, "issued-to", site.id, { source: prov("fda-warning-letter") });
          } else if (sgn.kind === "import_alert" && sgn.fei) {
            const ia = await world.upsert("ImportAlert", sgn.text.match(/alert (\d{2}-\d{2})/)?.[1] ?? "66-40", { source: prov("fda-import-alert") });
            await world.relate(ia.id, "lists", site.id, { source: prov("fda-import-alert") });
          }
        }
      }
    }
  }

  // ---- Shortage status ------------------------------------------------------------------------------------
  const curRows = curR?.rows ?? [];
  const ourPkgs = new Set([...ourProducts.values()].map((r) => str(r.package_ndc)));
  const currentRows = curRows.filter((r) => str(r.status) === "Current");
  const firstPosting = currentRows.map((r) => str(r.initial_posting_date)).filter(Boolean).sort()[0]
    ?? (histR?.rows ?? []).map((r) => str(r.first_posting)).filter(Boolean).sort()[0] ?? null;
  const companies = new Map<string, ShortageStatus["companies"][number]>();
  curRows.forEach((r, i) => {
    const k = str(r.company_name);
    const prev = companies.get(k);
    if (!prev || str(r.update_date) > prev.updated) {
      companies.set(k, { company: k, status: str(r.status), updated: str(r.update_date), info: str(r.related_info), evidence: ledger.cite(curR, i, `FDA shortage list: ${k}, ${r.status}`) });
    }
  });
  const reasons = [...new Set((histR?.rows ?? []).flatMap((r) => str(r.reasons).split("|")).map((s) => s.trim()).filter(Boolean))];
  const shortage: ShortageStatus = {
    listed: currentRows.length > 0, status: currentRows.length ? "Current" : curRows[0] ? str(curRows[0].status) : null,
    firstPosting, companies: [...companies.values()].sort((a, b) => a.company.localeCompare(b.company)), reasons,
    ourNdcsListed: curRows.filter((r) => ourPkgs.has(str(r.package_ndc))).map((r) => str(r.package_ndc)),
  };
  let postingEvidence: string | null = null;
  if (firstPosting && curR) {
    const idx = curR.rows.findIndex((r) => str(r.initial_posting_date) === firstPosting);
    if (idx >= 0) postingEvidence = ledger.cite(curR, idx, `FDA first posted the shortage ${firstPosting}`);
  }
  if (canWrite && shortage.listed) {
    const sh = await world.upsert("Shortage", `${molecule.split(" ")[0]}-${firstPosting ?? "current"}`, { name: `${molecule} shortage`, source: prov("fda-shortage-db") });
    await world.relate(sh.id, "affects", `drug:generic:${molecule.slice(0, 90)}`, { source: prov("fda-shortage-db") });
  }

  // ---- Market ------------------------------------------------------------------------------------------
  const marketBy = new Map<string, MarketLine>();
  for (const r of marketR?.rows ?? []) {
    const k = str(r.labeler_name);
    const m = marketBy.get(k) ?? { labeler: k, ndc11: str(r.ndc11), dosageForm: str(r.dosage_form), plants: [], onShortageList: false, inOurStock: false };
    if (ourProducts.has(str(r.ndc11))) m.inOurStock = true;
    if (r.establishment && !m.plants.some((p) => p.name === str(r.establishment))) {
      const fei = r.fei ? str(r.fei) : null;
      const h = fei ? healthOf(byFei(inspR?.rows, fei), byFei(actR?.rows, fei), [], AS_OF) : { health: "unknown" as Health, last: null };
      m.plants.push({ name: str(r.establishment), fei, country: r.country_iso3 ? str(r.country_iso3) : null, health: h.health, last: h.last ? `${h.last.classification} ${h.last.endDate}` : null });
    }
    marketBy.set(k, m);
  }
  const listedKeys = new Set(currentRows.map((r) => firmKey(str(r.company_name))));
  const listedMatch = (name: string) => {
    const f = firmKey(name);
    return !!f && [...listedKeys].some((k) => k && (f.startsWith(k) || k.startsWith(f)));
  };
  // A labeler counts as short if it, or any plant its label names, is a company on FDA's current list
  // (BPI Labs distributes Gland Pharma's product; Natco markets Teyro Labs').
  const market = [...marketBy.values()].map((m) => ({ ...m, onShortageList: listedMatch(m.labeler) || m.plants.some((p) => listedMatch(p.name)) }));

  // ---- 6. Interchanges the P&T committee already approved ------------------------------------------------
  const [ixR] = await run("interchange", "What our P&T committee already approved", "Read Corvale General's approved interchanges for these items.",
    [Q.interchangeSql([...ourProducts.keys()])], (rs) => `${rs[0].rows.length} approved interchanges on file.`);

  // ---- 7. Data quality: the semantic layer's own rules --------------------------------------------------
  const dataQuality: DataQualityNote[] = [];
  const dqResults = await run("data_quality", "Which links can't be trusted", "Run the semantic layer's foreign-key rules over each hospital's stock, and name the rows they reject.",
    [Q.dqSql("stock_general"), Q.dqSql("stock_east"), Q.dqSql("stock_lakeside"), Q.dqLakesideRowsSql(molecule.split(" ")[0])],
    (rs) => {
      const bad = rs.slice(0, 3).reduce((n, r) => n + num(r.rows.find((x) => str(x.type).startsWith("Foreign"))?.invalid_record), 0);
      return `${bad} stock rows across the system fail the NDC rule; ${rs[3]?.rows.length ?? 0} of them are this drug.`;
    }, 200);
  for (const r of dqResults.slice(0, 3)) {
    for (const x of r.rows) {
      dataQuality.push({ table: str(x.table), rule: str(x.type), total: num(x.total_record), invalid: num(x.invalid_record),
        note: num(x.invalid_record) ? `${num(x.invalid_record)} of ${num(x.total_record)} rows break this rule` : "every row passes" });
    }
  }
  const lakesideBad = dqResults[3]?.rows ?? [];

  // ---- 8. Memory: what we decided last time --------------------------------------------------------------
  const memLines: MemoryLine[] = [];
  if (guard("hmem.read", "recall past decisions on this drug")) {
    const s0 = Date.now();
    const past = await memory.recallForDrug(molecule.split(" ")[0]);
    for (const m of past.memories.slice(0, 5)) {
      memLines.push({ id: m.memory.id, text: m.memory.content, approvedBy: m.approvedBy ?? null, when: m.memory.provenance?.learnedAt ? new Date(m.memory.provenance.learnedAt).toISOString().slice(0, 10) : null, score: round(m.relevance, 3) });
    }
    steps.push({ key: "memory", title: "What we decided last time", purpose: "Recall past decisions on this drug from H-MEM, with who approved them.", queryIds: [], sources: ["meterless.hmem"], ms: Date.now() - s0, rows: memLines.length, finding: memLines.length ? `${memLines.length} past decisions recalled.` : "No past decisions on this drug.", status: memLines.length ? "ok" : "empty" });
  }

  // ---- Timeline (the lead-time ruler) -----------------------------------------------------------------
  const ourSignals = [...plantSeen.values()].flatMap((p) => p.signals.map((s) => ({ ...s, plant: p.name })));
  const timeline: TimelineEvent[] = [];
  const seenEvt = new Set<string>();
  for (const s of [...ourSignals, ...recallSignals]) {
    const k = `${s.kind}|${s.date}|${s.fei ?? s.firm}`;
    if (seenEvt.has(k) || !s.date) continue;
    seenEvt.add(k);
    const before = firstPosting ? daysBetween(s.date, firstPosting) : null;
    if (before !== null && (before > 365 * 3 || before < -365 * 2)) continue; // keep the ruler to the shortage's own story
    timeline.push({ date: s.date, kind: s.kind, label: s.text, daysBeforePosting: before, evidence: s.evidence });
  }
  if (firstPosting) timeline.push({ date: firstPosting, kind: "shortage_posted", label: `FDA posts the ${molecule} shortage`, daysBeforePosting: 0, evidence: postingEvidence });
  timeline.push({ date: AS_OF, kind: "today", label: shortage.listed ? `Still on FDA's list (${Math.round(daysBetween(firstPosting ?? AS_OF, AS_OF) / 30.4)} months)` : "Today", daysBeforePosting: firstPosting ? daysBetween(AS_OF, firstPosting) : null, evidence: null });
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  // ---- Options, ranked by rule (no clinical change first) ------------------------------------------------
  const options: OptionLine[] = [];
  const byHospital = new Map<Hospital, { onHand: number; daily: number; ev: string[] }>();
  for (const s of stock) {
    const h = byHospital.get(s.hospital) ?? { onHand: 0, daily: 0, ev: [] };
    h.onHand += s.onHand;
    h.daily += s.dailyUse;
    h.ev.push(s.evidence);
    byHospital.set(s.hospital, h);
  }
  const days = (h: { onHand: number; daily: number }) => (h.daily > 0 ? h.onHand / h.daily : Infinity);
  // Transfer rule: a donor keeps at least 14 days; a recipient under 10 days is brought toward 14.
  const short = [...byHospital.entries()].filter(([, h]) => days(h) < 10).sort((a, b) => days(a[1]) - days(b[1]));
  const long = [...byHospital.entries()].filter(([, h]) => days(h) > 14).sort((a, b) => days(b[1]) - days(a[1]));
  const spareLeft = new Map(long.map(([h, v]) => [h, Math.floor(v.onHand - 14 * v.daily)]));
  for (const [to, th] of short) {
    for (const [from, fh] of long) {
      const spare = spareLeft.get(from) ?? 0;
      if (spare <= 0) continue;
      const need = Math.max(1, Math.ceil(14 * th.daily - th.onHand));
      const qty = Math.min(spare, need);
      spareLeft.set(from, spare - qty);
      options.push({
        kind: "transfer", rank: 1, title: `Transfer ${qty} from ${from} to ${to}`,
        detail: `${from} has ${round(days(fh), 0)} days on hand and can spare ${qty} while keeping two weeks; ${to} has ${round(days(th), 1)} days and would reach ${round((th.onHand + qty) / th.daily, 0)}.`,
        why: "Same product, no clinical change, no new supplier.", needs: "pharmacy director (transfer request)", evidence: [...fh.ev, ...th.ev],
      });
    }
  }
  for (const m of market) {
    if (m.inOurStock || m.onShortageList) continue;
    const worst = m.plants.some((p) => p.health === "signal") ? "signal" : m.plants.some((p) => p.health === "watch") ? "watch" : m.plants.length ? "clear" : "unknown";
    if (worst === "signal") continue;
    options.push({
      kind: "alternate_manufacturer", rank: worst === "clear" ? 2 : 3, title: `Buy from ${m.labeler}`,
      detail: `Not on FDA's shortage list today. ${m.plants.length ? `Plants: ${m.plants.map((p) => `${p.name}${p.last ? ` (last inspection ${p.last})` : ""}`).join("; ")}.` : "Its label names no plant we could place."}`,
      why: worst === "clear" ? "Same product, no clinical change, plant record clear." : "Same product, but the plant record is thin or recent.", needs: "buyer", evidence: [],
    });
  }
  (ixR?.rows ?? []).forEach((r, i) => {
    const rule = str(r.rule);
    options.push({
      kind: rule.startsWith("same product") ? "alternate_manufacturer" : rule.startsWith("IV-to-PO") ? "iv_to_po" : rule.startsWith("protocol") ? "interchange" : "alternate_concentration",
      rank: rule.startsWith("same product") ? 2 : rule.startsWith("same molecule") ? 3 : 4,
      title: `${rule.charAt(0).toUpperCase()}${rule.slice(1)}: ${tallMan(str(r.alternative))} ${str(r.alt_strength)}${r.alt_labeler ? ` from ${str(r.alt_labeler)}` : ""}`,
      detail: `${str(r.notes)} Approved by ${str(r.approved_by)} on ${str(r.approved_on)}.`,
      why: rule.startsWith("protocol") ? "A different drug; only per the treating oncologist." : "Already approved by the P&T committee.",
      needs: rule.startsWith("protocol") ? "treating oncologist" : "pharmacist", evidence: [ledger.cite(ixR, i, `P&T interchange: ${str(r.rule)}`)],
    });
  });
  options.sort((a, b) => a.rank - b.rank);

  const c: Case = {
    id: caseId, question, askedAt: new Date().toISOString(), asOf: AS_OF, molecule,
    intent: { name: d.intent.primary, risk: d.risk.level, contractId: contract.contractId, clarification: null },
    steps, stock, chain, shortage, market, options, timeline, explanation: null, dataQuality, memory: memLines, memo: null, gate,
    evidence: ledger.evidence, queries: ledger.queries,
    usage: { zetarisQueries: Object.keys(ledger.queries).length, zetarisMs: Object.values(ledger.queries).reduce((n, q) => n + q.ms, 0), modelCalls: 0, tokensIn: 0, tokensOut: 0,
      mode: [...new Set(Object.values(ledger.queries).map((q) => q.mode))].length > 1 ? "mixed" : (Object.values(ledger.queries)[0]?.mode ?? "live") },
  };
  if (lakesideBad.length) {
    c.dataQuality.push({ table: "stock_lakeside", rule: `${molecule} rows the NDC rule rejects`, total: lakesideBad.length, invalid: lakesideBad.length,
      note: lakesideBad.map((r) => `${r.item_key} "${r.description}" (NDC ${str(r.ndc_as_recorded) || "blank"}: ${r.ndc_match})`).join("; ") });
  }
  if (canWrite) await world.flush();

  if (opts.explain !== false && guard("world.read", "write the explanation from recorded evidence")) {
    c.explanation = await explain(c);
  }
  c.usage.modelCalls = tally.calls - tallyStart.calls + (tally.cachedCalls - tallyStart.cachedCalls);
  c.usage.tokensIn = tally.tokensIn - tallyStart.tokensIn;
  c.usage.tokensOut = tally.tokensOut - tallyStart.tokensOut;
  void t0;
  return c;
}
