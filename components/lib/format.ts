// Formatting shared by every page: dates, NDCs, days on hand, plain counts.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parts(iso: string | null | undefined): [number, number, number] | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** "2 Dec 2022" */
export function fmtDate(iso: string | null | undefined): string {
  const p = parts(iso);
  if (!p) return iso ?? "";
  return `${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}`;
}

/** "2 December 2022" */
export function fmtDateLong(iso: string | null | undefined): string {
  const p = parts(iso);
  if (!p) return iso ?? "";
  return `${p[2]} ${MONTHS_LONG[p[1] - 1]} ${p[0]}`;
}

/** "Dec 2022" */
export function fmtMonth(iso: string | null | undefined): string {
  const p = parts(iso);
  if (!p) return iso ?? "";
  return `${MONTHS[p[1] - 1]} ${p[0]}`;
}

/** "05:37" in UTC, from an ISO timestamp. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}:${m[3]}` : iso;
}

/** "22 Oct 2026, 05:37 UTC" */
export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return `${fmtDate(iso)}${m ? `, ${m[1]}:${m[2]} UTC` : ""}`;
}

export function dayNumber(iso: string): number {
  return Math.round(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / 86_400_000);
}

export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

export function monthsBetween(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return 0;
  let m = (pb[0] - pa[0]) * 12 + (pb[1] - pa[1]);
  if (pb[2] < pa[2]) m -= 1;
  return m;
}

/** 11-digit NDC to the 5-4-2 billing form, "00703-4239-01". Package NDCs are shown as printed on the carton. */
export function ndc542(ndc11: string): string {
  const d = ndc11.replace(/\D/g, "");
  if (d.length !== 11) return ndc11;
  return `${d.slice(0, 5)}-${d.slice(5, 9)}-${d.slice(9)}`;
}

export function fmtDays(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return "unknown";
  if (days < 10) return `${Math.round(days * 10) / 10}`;
  return `${Math.round(days)}`;
}

export function plural(n: number, one: string, many?: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many ?? one + "s"}`;
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtPct(share: number | null | undefined, digits = 0): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return "n/a";
  return `${(share * 100).toFixed(digits)}%`;
}

/** Sentence case for FDA's capitalised firm names, without touching acronyms of three letters or fewer. */
export function firmCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(/(\s+)/)
    .map((w) => (/^(bv|nv|ag|sa|llc|inc|usa|us|ltd|gmbh|spa|plc|kg)$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

const COUNTRY: Record<string, string> = {
  IND: "India", USA: "United States", CHN: "China", DEU: "Germany", ITA: "Italy", ESP: "Spain", FRA: "France",
  GBR: "United Kingdom", IRL: "Ireland", CHE: "Switzerland", AUT: "Austria", NLD: "Netherlands", BEL: "Belgium",
  KOR: "South Korea", JPN: "Japan", ISR: "Israel", CAN: "Canada", MEX: "Mexico", BRA: "Brazil", PRT: "Portugal",
  HUN: "Hungary", POL: "Poland", SVN: "Slovenia", CZE: "Czechia", DNK: "Denmark", SWE: "Sweden", GRC: "Greece",
  TUR: "Türkiye", ARG: "Argentina", AUS: "Australia", SGP: "Singapore", TWN: "Taiwan", PRI: "Puerto Rico",
  BGD: "Bangladesh", JOR: "Jordan", EGY: "Egypt", ZAF: "South Africa", CYP: "Cyprus", ROU: "Romania",
  HRV: "Croatia", FIN: "Finland", NOR: "Norway", SVK: "Slovakia", LVA: "Latvia", LTU: "Lithuania",
  BGR: "Bulgaria", SRB: "Serbia", ISL: "Iceland", MLT: "Malta", LUX: "Luxembourg", NZL: "New Zealand",
  THA: "Thailand", MYS: "Malaysia", IDN: "Indonesia", VNM: "Vietnam", PHL: "Philippines", PAK: "Pakistan",
  ARE: "United Arab Emirates", SAU: "Saudi Arabia", URY: "Uruguay", CHL: "Chile", COL: "Colombia",
  DOM: "Dominican Republic", CRI: "Costa Rica", EST: "Estonia", UKR: "Ukraine", RUS: "Russia", BLR: "Belarus",
  KAZ: "Kazakhstan", LKA: "Sri Lanka", NPL: "Nepal", VEN: "Venezuela", PER: "Peru", MAR: "Morocco", TUN: "Tunisia",
};

export function countryName(iso3: string | null | undefined): string {
  if (!iso3) return "Country not on file";
  return COUNTRY[iso3.toUpperCase()] ?? iso3.toUpperCase();
}
