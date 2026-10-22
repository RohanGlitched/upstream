// Everything the film shows, read from the case, the plant map and the evaluation. No figure is typed in.
import type { Case, Hospital, Plant, Signal } from "../../src/agent/types";
import { tallMan } from "../../src/agent/util";
import type { LabelSpec, Pocket } from "./micro";

/** data/plants.json */
export interface PlantsFile {
  asOf: string;
  queryId: string;
  plants: { name: string; fei: string | null; country_iso3: string; lat: number; lon: number; health: string; address?: string }[];
  counts?: Record<string, number>;
}
/** data/eval/trace.json (only the summary is read) */
export interface EvalFile {
  summary: {
    truthRows: number;
    drugs: number;
    upstream: { plantFound: string; lastInspectionMatch: string };
    baseline: { model: string; pairs: number; dateCorrect: string; inventedDates: number; plantNamed: string; feiCorrect: string };
  };
}

/**
 * Plants whose registered address we have placed on the map ourselves (a geocode of FDA's address, not FDA data),
 * with the base-map names around them. Any other plant falls back to its country's centroid from data/plants.json.
 */
const GAZETTEER: Record<string, { ll: [number, number]; near: string; place: string; labels: { t: string; ll: [number, number]; w: [number, number]; c: string }[] }> = {
  "3004011473": {
    ll: [72.425, 22.935],
    near: "Pharmez, Matoda, near Sanand",
    place: "Sanand, Gujarat, India",
    labels: [
      { t: "India", ll: [79.2, 19.5], w: [5.6, 6.75], c: "region" },
      { t: "Arabian Sea", ll: [65.8, 17.6], w: [5.2, 6.6], c: "region sea" },
      { t: "Gujarat", ll: [71.0, 22.6], w: [4.65, 6.25], c: "region" },
      { t: "Gulf of Khambhat", ll: [72.3, 21.45], w: [4.4, 5.5], c: "region sea" },
      { t: "Ahmedabad", ll: [72.57, 23.03], w: [3.55, 5.25], c: "city" },
      { t: "Sanand", ll: [72.38, 22.99], w: [3.55, 5.0], c: "city" },
    ],
  },
};
const COUNTRY_NAME: Record<string, string> = { IND: "India", USA: "United States", CHN: "China", DEU: "Germany", ITA: "Italy", AUT: "Austria", PRT: "Portugal", ESP: "Spain", CAN: "Canada", CHE: "Switzerland", GRC: "Greece", FRA: "France", GBR: "United Kingdom", TWN: "Taiwan", AUS: "Australia", SWE: "Sweden", NOR: "Norway", DNK: "Denmark" };
const ONCOLOGY = /platin|methotrexate|cyclophosphamide|cytarabine|azacitidine|bleomycin|dacarbazine|doxorubicin|fluorouracil|gemcitabine|paclitaxel|docetaxel|vincristine|vinblastine|etoposide|irinotecan|oxaliplatin|ifosfamide|bendamustine|bortezomib/i;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dms = (s: string) => Date.parse(s.slice(0, 10) + "T00:00:00Z");
const daysBetween = (a: string, b: string) => Math.round((dms(b) - dms(a)) / 864e5);
const shortFirm = (n: string) => n.replace(/,.*$/, "").replace(/\s+(Inc\.?|Corp\.?|LLC|Ltd\.?|Limited|Private|Pharmaceuticals?|Healthcare|Parenteral|Medicines|USA)\b/gi, "").trim();
const num = (n: number) => (n <= 10 ? ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] : String(n));
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const frac = (s: string) => { const m = /(\d+)\/(\d+)/.exec(s); return m ? [+m[1], +m[2]] : [0, 0]; };

export interface Caption { t: string; b: string; e: [string, string][] }
export interface LeadEvent { d: string; t: string; k: "oai" | "post" | "today" | "mark"; row: number; end?: boolean }

export interface FilmData {
  asOf: string;
  molecule: string;
  drug: string;
  question: string;
  hospital: { key: Hospital; short: string; onHand: number; use: number; days: number; unit: string };
  pockets: Pocket[];
  cabinet: string;
  totalLine: string;
  callout: { big: string; small: string };
  focus: { ndc: string; labeler: string; labelerShort: string; codes: [string, string, string]; product: string; pkg: string; setId: string; listedInfo: string };
  lanes: { g: "ns" | "lab" | "prod" | "pkg" | "chk"; d: string; r: string; rs: string }[];
  plant: {
    name: string; fei: string; duns: string | null; countryName: string; address: string; ops: string; quality: string;
    ll: [number, number]; placed: boolean; near: string; place: string;
    history: { date: string; cls: "OAI" | "VAI"; id: string }[];
  };
  mapLabels: { t: string; s?: string; ll: [number, number] | null; w: [number, number]; c: string }[];
  corvale: [number, number];
  rings: { lon: number; lat: number; n: number; signal: number }[];
  totalPlants: number;
  inCountry: number;
  oai: { id: string; end: string; letter: string; obs: number; areas: { k: string; v: string }[] } | null;
  lead: { days: number; letter: string; posted: string; months: number; events: LeadEvent[]; zoomA: [string, string]; zoomB: [string, string] } | null;
  answer: { title: string; why: string; rows: { key: string; src: string; a: number; b: number; low: boolean }[]; note: string; needs: string } | null;
  proof: { plant: [number, number]; last: [number, number]; nemDates: [number, number]; invented: number; model: string } | null;
  caps: Caption[];
  dateNotes: Record<string, string>;
}

function parseStrength(desc: string) {
  const conc = /(\d+(?:\.\d+)?)\s*mg\s*\/\s*m?l/i.exec(desc);
  const vol = /(\d+(?:\.\d+)?)\s*ml\b/i.exec(desc.replace(/mg\s*\/\s*ml/i, ""));
  const c = conc ? +conc[1] : null, v = vol ? +vol[1] : null;
  return {
    conc: c !== null ? `(${c} mg/mL)` : "",
    dose: c !== null && v !== null ? `${Math.round(c * v)} mg/${v} mL` : v !== null ? `${v} mL` : "",
    volume: v,
    concText: c !== null ? `${c} mg/mL` : "",
  };
}

export function buildFilm(c: Case, plantsFile: PlantsFile | null, ev: EvalFile | null): FilmData {
  const E = c.evidence;
  const drug = tallMan(c.molecule.split(" ")[0]);
  // the hospital with the fewest days, and the NDC there that leads to an FDA finding
  // With presentations on record, the film follows one presentation (the best transfer's, else the shortest),
  // with the same days the desk prints; older recordings pool every line at a hospital.
  const bestT = c.options.filter((o) => o.kind === "transfer").sort((a, b) => a.rank - b.rank)[0];
  const minDays = (p: NonNullable<Case["presentations"]>[number]) => Math.min(...p.hospitals.map((h) => h.days ?? Infinity));
  const pres = (c.presentations ?? []).find((p) => p.label === bestT?.transfer?.presentation) ?? [...(c.presentations ?? [])].sort((a, b) => minDays(a) - minDays(b))[0];
  const hosps = ["Corvale General", "Corvale East", "Corvale Lakeside"].map((k) => {
    const at = pres?.hospitals.find((h) => h.hospital === k);
    if (pres) {
      const lines = c.stock.filter((s) => s.hospital === k && (at?.lines.includes(s.itemKey) ?? false));
      return { key: k as Hospital, short: k.replace("Corvale ", ""), lines, onHand: at?.onHand ?? 0, use: at?.dailyUse ?? 0, days: at?.days ?? 0 };
    }
    const lines = c.stock.filter((s) => s.hospital === k);
    const onHand = lines.reduce((a, s) => a + s.onHand, 0), use = lines.reduce((a, s) => a + s.dailyUse, 0);
    return { key: k as Hospital, short: k.replace("Corvale ", ""), lines, onHand, use, days: use ? onHand / use : 0 };
  }).filter((h) => h.lines.length);
  const presWord = pres ? (pres.label.split(",").pop()?.trim() ?? pres.short) : null; // "60 mL vial"
  const H = [...hosps].sort((a, b) => a.days - b.days)[0];
  const redPlant = (p: Plant) => p.signals.some((s) => s.kind === "inspection_oai");
  const listed = new Set(c.shortage.ourNdcsListed);
  const chains = [...c.chain].sort((a, b) =>
    (b.plants.some(redPlant) ? 2 : 0) + (listed.has(b.packageNdc) ? 1 : 0) - ((a.plants.some(redPlant) ? 2 : 0) + (listed.has(a.packageNdc) ? 1 : 0)));
  const chain = chains.find((ch) => H.lines.some((s) => s.ndc11 === ch.ndc11) && ch.plants.length) ?? chains[0];
  const plant = chain.plants.find(redPlant) ?? chain.plants[0];

  // the drawer
  const formOf = (ndc11: string) => {
    const evRow = Object.values(E).find((x) => x.fields?.ndc11 === ndc11 && x.fields?.dosage_form);
    const f = String(evRow?.fields?.dosage_form ?? "INJECTION").split(",")[0].toLowerCase();
    return cap(f);
  };
  const vialKind = (ndc11: string) => {
    const ds = c.stock.filter((s) => s.ndc11 === ndc11).map((s) => s.description.toUpperCase()).join(" ");
    return /MDV|MULTI/.test(ds) ? "Multiple-dose vial" : /SDV|SINGLE/.test(ds) ? "Single-dose vial" : "Vial";
  };
  const hazard = ONCOLOGY.test(c.molecule) ? "Cytotoxic agent. Handle with care." : null;
  const specOf = (s: Case["stock"][number]): LabelSpec => {
    const ch = c.chain.find((x) => x.ndc11 === s.ndc11);
    const st = parseStrength(s.description);
    return {
      ndc: ch?.packageNdc ?? s.ndc11, drug, form: formOf(s.ndc11), dose: st.dose, conc: st.conc, vial: vialKind(s.ndc11), hazard,
      labeler: s.labeler ?? "",
    };
  };
  const pockets: Pocket[] = H.lines.map((s) => {
    const st = parseStrength(s.description);
    return {
      itemKey: s.itemKey, desc: s.description, labeler: shortFirm(s.labeler ?? "unlabelled"), onHand: s.onHand,
      large: (st.volume ?? 0) >= 20, spec: specOf(s), focus: s.ndc11 === chain.ndc11,
    };
  });
  const focusLine = H.lines.find((s) => s.ndc11 === chain.ndc11)!;
  const fst = parseStrength(focusLine.description);
  const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1); // a tenth of a day, as on the desk
  const unit = H.lines[0].unit === "vial" ? "vials" : `${H.lines[0].unit}s`;
  const stockQ = E[H.lines[0].evidence]?.queryId ?? "";
  const derivedH = Object.values(E).find((x) => x.queryId === "derived" && x.fields?.hospital === H.key);
  const others = hosps.filter((h) => h.key !== H.key);

  // codes on the package NDC
  const codes = chain.packageNdc.split("-") as [string, string, string];
  const listRow = c.shortage.companies.find((r) => shortFirm(r.company).split(" ")[0].toLowerCase() === shortFirm(chain.labeler).split(" ")[0].toLowerCase());
  const rec = listRow ? /recovery:?\s*([^/;.]+)/i.exec(listRow.info)?.[1]?.trim() : undefined;
  const listedInfo = listed.has(chain.packageNdc) ? (rec ? (/tbd/i.test(rec) ? "recovery date to be decided" : `recovery ${rec}`) : "") : "";
  const pocketNo = H.lines.findIndex((s) => s.ndc11 === chain.ndc11) + 1;

  // where the plant is
  const pf = plantsFile?.plants.find((p) => p.fei && p.fei === plant.fei);
  const gz = plant.fei ? GAZETTEER[plant.fei] : undefined;
  const ll: [number, number] = gz ? gz.ll : pf ? [pf.lon, pf.lat] : [0, 20];
  const usa = plantsFile?.plants.find((p) => p.country_iso3 === "USA");
  const corvale: [number, number] = usa ? [usa.lon, usa.lat] : [-98.6, 39.8];
  const byC: Record<string, { lon: number; lat: number; n: number; signal: number }> = {};
  for (const p of plantsFile?.plants ?? []) {
    const k = p.country_iso3;
    (byC[k] ||= { lon: p.lon, lat: p.lat, n: 0, signal: 0 }).n++;
    if (p.health === "signal") byC[k].signal++;
  }
  const countryName = COUNTRY_NAME[plant.country ?? ""] ?? plant.country ?? "";
  const inCountry = plant.country ? byC[plant.country]?.n ?? 0 : 0;
  const hist = plant.signals
    .filter((s) => s.kind === "inspection_oai" || s.kind === "inspection_vai")
    .map((s) => ({ date: s.date, cls: (s.kind === "inspection_oai" ? "OAI" : "VAI") as "OAI" | "VAI", id: /inspection (\d+)/.exec(s.text)?.[1] ?? "" }));
  const near = gz?.near ?? countryName;
  const place = gz?.place ?? countryName;
  const placeEv = plant.evidence[0] ?? chain.evidence;
  const placeQ = E[placeEv]?.queryId ?? "";

  // the OAI
  const oaiS = plant.signals.filter((s) => s.kind === "inspection_oai").slice(-1)[0] as Signal | undefined;
  let oai: FilmData["oai"] = null;
  const f483 = Object.values(E).filter((x) => x.label.startsWith("Form 483 at inspection"));
  if (oaiS) {
    const id = /inspection (\d+)/.exec(oaiS.text)?.[1] ?? "";
    const n = +(/\((\d+) observations\)/.exec(oaiS.text)?.[1] ?? 0);
    const areasTxt = /Form 483: ([^(]+)\(/.exec(oaiS.text)?.[1] ?? "";
    const areas = areasTxt.split(";").map((x) => x.trim()).filter(Boolean).map((a) => {
      const row = f483.find((r) => String(r.fields.inspection_id) === id && String(r.fields.short_description).toLowerCase() === a.toLowerCase());
      return { k: row ? String(row.fields.cfr) : "", v: a.replace(/\//g, " and ").replace(/^./, (x) => x.toUpperCase()).replace(/\b(Of|And)\b/g, (w) => w.toLowerCase()) };
    });
    oai = { id, end: oaiS.date, letter: oaiS.knownDate, obs: n, areas };
  }

  // the lead time
  let lead: FilmData["lead"] = null;
  const posted = c.shortage.firstPosting;
  if (oai && posted) {
    const days = daysBetween(oai.letter, posted);
    const months = Math.round(daysBetween(posted, c.asOf) / 30.44);
    const evs: LeadEvent[] = [{ d: oai.end, t: "Inspection ends, later OAI", k: "oai", row: -1 }, { d: oai.letter, t: "OAI classification letter", k: "oai", row: 0 }, { d: posted, t: "FDA posts the shortage", k: "post", row: 0 }];
    let ia = 0;
    for (const s of plant.signals) {
      if (s.date <= oai.end) continue;
      if (s.kind === "import_alert") { const a = /alert ([\d-]+)/i.exec(s.text)?.[1]; evs.push({ d: s.date, t: ia++ ? "Second import alert listing" : `Import alert${a ? " " + a : ""}`, k: "oai", row: 0 }); }
      else if (s.kind === "warning_letter") evs.push({ d: s.date, t: `Warning letter${/case (\d+)/.exec(s.text) ? " " + /case (\d+)/.exec(s.text)![1] : ""}`, k: "oai", row: 0 });
    }
    evs.push({ d: c.asOf, t: c.shortage.listed ? "Today, still listed" : "Today", k: "today", row: -1, end: true });
    evs.sort((a, b) => dms(a.d) - dms(b.d));
    // stack the labels for the events from the letter to a quarter after the posting; the rest hang below
    const lim = dms(posted) + 100 * 864e5;
    const up = evs.filter((e) => dms(e.d) >= dms(oai!.letter) && dms(e.d) <= lim);
    up.forEach((e, i) => (e.row = up.length - 1 - i));
    evs.filter((e) => !up.includes(e)).forEach((e) => (e.row = -1));
    const pad = (d: string, n: number) => new Date(dms(d) + n * 864e5).toISOString().slice(0, 10);
    lead = { days, letter: oai.letter, posted, months, events: evs, zoomA: [pad(oai.letter, -10), pad(posted, 10)], zoomB: [pad(oai.end, -78), pad(c.asOf, 70)] };
  }

  // the answer
  let answer: FilmData["answer"] = null;
  const opt = bestT;
  if (opt) {
    const m = opt.transfer
      ? (["", String(opt.transfer.qty), opt.transfer.from, opt.transfer.to] as unknown as RegExpExecArray)
      : /Transfer\s+([\d.]+)\s+from\s+(Corvale \w+)\s+to\s+(Corvale \w+)/i.exec(opt.title);
    if (m) {
      const n = +m[1];
      const rows = [...hosps].sort((a, b) => a.days - b.days).map((h) => {
        const b = h.key === m[2] ? (h.onHand - n) / h.use : h.key === m[3] ? (h.onHand + n) / h.use : h.days;
        return { key: h.key, src: h.key === "Corvale Lakeside" ? "CSV cabinet exports" : "Postgres", a: h.days, b, low: h.days < 7 };
      });
      const to = rows.find((r) => r.key === m[3])!, from = rows.find((r) => r.key === m[2])!;
      answer = {
        title: `Transfer ${n} ${unit} from ${m[2]} to ${m[3]}.`,
        why: opt.why,
        rows,
        note: `${presWord ? `In ${presWord}s, ` : ""}${m[3].replace("Corvale ", "")} goes from ${fmt1(to.a)} days to ${fmt1(to.b)}. ${m[2].replace("Corvale ", "")} keeps ${fmt1(from.b)} days.`,
        needs: opt.needs,
      };
    }
  }
  const optEv = Object.values(E).find((x) => x.queryId === "derived" && x.fields?.kind === "transfer")?.id ?? "";

  // the proof
  let proof: FilmData["proof"] = null;
  if (ev) {
    const S = ev.summary;
    proof = { plant: frac(S.upstream.plantFound) as [number, number], last: frac(S.upstream.lastInspectionMatch) as [number, number], nemDates: frac(S.baseline.dateCorrect) as [number, number], invented: S.baseline.inventedDates, model: S.baseline.model };
  }

  const dist = 0; // set by the globe once d3 has measured it
  void dist;
  const vaiN = hist.filter((h) => h.cls === "VAI").length;
  const firstY = hist[0]?.date.slice(0, 4) ?? "";
  const insEv = plant.signals.filter((s) => s.kind.startsWith("inspection")).map((s) => s.evidence);
  const lettersEv = plant.signals.filter((s) => s.kind === "warning_letter").map((s) => s.evidence);
  const alertsEv = plant.signals.filter((s) => s.kind === "import_alert").map((s) => s.evidence);
  const qOf = (id: string) => E[id]?.queryId ?? "";
  const postEv = c.timeline.find((t) => t.kind === "shortage_posted")?.evidence ?? "";
  const dEv = (pred: (f: Record<string, unknown>) => boolean) => Object.values(E).find((x) => x.queryId === "derived" && pred(x.fields))?.id ?? "";
  const leadEv = dEv((f) => f.letter !== undefined && f.posted !== undefined);
  const monthsEv = dEv((f) => f.months !== undefined);
  const f483Ev = f483.find((r) => oai && String(r.fields.inspection_id) === oai.id);
  const oaiEv = oaiS?.evidence ?? "";
  const caps: Caption[] = [
    {
      t: `${H.key}’s cabinet drawer`,
      b: `${cap(num(Math.round(H.onHand)))} ${presWord ? `${presWord}s` : unit} of ${drug} under ${num(H.lines.length)} ${H.lines.length === 1 ? "NDC" : "NDCs"}, used at ${fmt1(H.use)} a day: ${fmt1(H.days)} days. ${others.map((o, i) => `${o.key} ${i ? "" : "has "}${fmt1(o.days)}${i ? "" : " days"}`).join(" and ")}.`,
      e: [["Zetaris query", stockQ], ["Rows", H.lines.map((s) => s.evidence).join(" ")], ...(derivedH ? [["Derived", derivedH.id] as [string, string]] : [])],
    },
    {
      t: "The label",
      b: `The ${shortFirm(chain.labeler)} vial in pocket ${pocketNo}: NDC ${chain.packageNdc}${fst.concText ? ", " + fst.concText : ""}${fst.volume ? `, ${fst.volume} mL` : ""}. ${listed.has(chain.packageNdc) ? `FDA lists this exact NDC as short${listedInfo ? ", " + listedInfo : ""}.` : "FDA does not list this NDC as short."}`,
      e: [["Stock", `${qOf(focusLine.evidence)} ${focusLine.evidence}`], ...(listRow ? [["FDA shortage list", `${qOf(listRow.evidence)} ${listRow.evidence}`] as [string, string]] : [])],
    },
    {
      t: "The barcode",
      b: `UPC number system 3 marks a drug. The next ${codes[0].length} digits are the labeler. The label behind the labeler names the plant.`,
      e: [["Zetaris query", placeQ], ["Evidence", placeEv]],
    },
    {
      t: "__DIST__ km upstream",
      b: `The plant is in ${place}. The rings are the ${plantsFile?.plants.length ?? "named"} plants named on the labels of Corvale’s formulary; ${inCountry} are in ${countryName}.`,
      e: [["Plant link", `${placeQ} ${placeEv}`], ["Plant map", plantsFile?.queryId ?? ""]],
    },
    {
      t: "The registration record",
      b: `FDA knows the plant as FEI ${plant.fei}, registered for ${plant.operations.toLowerCase().split(";").join(" and ")}. ${cap(num(vaiN))} VAI inspection${vaiN === 1 ? "" : "s"} since ${firstY}, then ${hist.some((h) => h.cls === "OAI") ? "one OAI" : "no OAI"}. ${gz ? "Map position comes from the registered address." : "Map position is the country's centre."}`,
      e: [["Registration", `${placeQ} ${placeEv}`], ["Inspections", `${qOf(insEv[0] ?? "")} ${insEv[0] ?? ""}${insEv.length > 1 ? " to " + insEv[insEv.length - 1] : ""}`]],
    },
    {
      t: "The inspection record",
      b: oai ? `Inspection ${oai.id} ended ${oai.end}. FDA classified it Official Action Indicated in a letter dated ${oai.letter}.${oai.obs ? ` Form 483 lists ${oai.obs} observations.` : ""}` : "FDA's file holds no OAI for this plant.",
      e: [["Inspection", `${qOf(oaiEv)} ${oaiEv}`], ...(f483Ev ? [["Form 483", `${f483Ev.queryId} ${f483Ev.id}`] as [string, string]] : [])],
    },
    {
      t: "The lead time",
      b: lead ? `${lead.days} days after the OAI letter, FDA posted the ${c.molecule} shortage.${alertsEv.length || lettersEv.length ? ` ${[alertsEv.length ? "An import alert" : "", lettersEv.length ? "a warning letter" : ""].filter(Boolean).join(" and ")} followed.` : ""} ${c.shortage.listed ? `${lead.months} months on, it is still listed.` : ""}` : "",
      e: [["Derived", [leadEv, monthsEv].filter(Boolean).join(" ")], ["Shortage", `${qOf(postEv)} ${postEv}`], ...(alertsEv.length ? [["Alerts", `${qOf(alertsEv[0])} ${alertsEv.join(" ")}`] as [string, string]] : []), ...(lettersEv.length ? [["Letter", `${qOf(lettersEv[0])} ${lettersEv.join(" ")}`] as [string, string]] : [])],
    },
    { t: "Back at the shelf", b: "", e: [["Option ranked first by rule", optEv], ["Stock", `${stockQ} ${(opt?.evidence ?? []).join(" ")}`]] },
  ];

  const dateNotes: Record<string, string> = { [c.asOf]: "today" };
  if (oai) { dateNotes[oai.end] = "inspection ends"; dateNotes[oai.letter] = "OAI letter"; }
  if (posted) dateNotes[posted] = "shortage posted";

  const mapLabels: FilmData["mapLabels"] = [
    ...(gz?.labels ?? [{ t: countryName, ll: ll, w: [5.2, 6.8], c: "region" }]),
    { t: "Corvale Health", s: `${hosps.length} hospitals, United States`, ll: corvale, w: [6.0, 9], c: "pin" },
    { t: shortFirm(plant.name) + (/pharma/i.test(plant.name) ? " Pharmaceuticals" : ""), s: near, ll, w: [-9, 9], c: "pin" },
    { t: "", ll: null, w: [6, 9], c: "dist" },
  ];

  return {
    asOf: c.asOf, molecule: c.molecule, drug, question: c.question,
    hospital: { key: H.key, short: H.short, onHand: H.onHand, use: H.use, days: H.days, unit },
    pockets, cabinet: `${H.key}, ${hazard ? "oncology cabinet" : "pharmacy cabinet"}`, totalLine: `${drug}, ${Math.round(H.onHand)} ${unit} on hand`,
    callout: { big: `${fmt1(H.days)} days left`, small: `${H.key}: ${Math.round(H.onHand)} ${presWord ? `${presWord}s` : unit}, used at ${fmt1(H.use)} a day` },
    focus: {
      ndc: chain.packageNdc, labeler: chain.labeler, labelerShort: shortFirm(chain.labeler), codes,
      product: `${drug} ${formOf(chain.ndc11).toLowerCase()}${fst.concText ? ", " + fst.concText : ""}`,
      pkg: `the ${fst.volume ? fst.volume + " mL " : ""}${vialKind(chain.ndc11).toLowerCase()} in ${H.short}’s pocket ${pocketNo}`,
      setId: (chain.setId ?? "").slice(0, 8), listedInfo,
    },
    lanes: [
      { g: "ns", d: "3", r: "a drug, by UPC rule", rs: "drug" },
      { g: "lab", d: codes[0], r: "labeler", rs: "labeler" },
      { g: "prod", d: codes[1], r: "product", rs: "product" },
      { g: "pkg", d: codes[2], r: "package", rs: "package" },
      { g: "chk", d: "", r: "check digit", rs: "check" },
    ],
    plant: {
      name: plant.name, fei: plant.fei ?? "", duns: plant.duns, countryName, address: (plant.address ?? "").replace(/\s*\([A-Z]{3}\)\s*$/, ""),
      ops: plant.operations.toLowerCase().split(";").map((x, i) => (i ? x : cap(x))).join(", "), quality: plant.linkQuality,
      ll, placed: !!gz, near, place, history: hist,
    },
    mapLabels, corvale,
    rings: Object.values(byC), totalPlants: plantsFile?.plants.length ?? 0, inCountry,
    oai, lead, answer, proof, caps, dateNotes,
  };
}

export function fmtMonthDay(d: string) { const t = new Date(dms(d)); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${t.getUTCFullYear()}`; }
