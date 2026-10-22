// The back-test's finding as sentences. Kept out of the client component so server pages can write it too.

interface ArmLike {
  episodesWithSignal?: string;
  caseProducts?: string;
  controlProducts?: string;
  liftVsControl?: number;
  lift?: number;
  p: number;
}

/** "13 of 209 products (6.2%)" -> {n, d} */
function ofText(s: string | undefined): { n: number; d: number } | null {
  const m = s ? /(\d+)\s+of\s+(\d+)/.exec(s) : null;
  return m ? { n: Number(m[1]), d: Number(m[2]) } : null;
}

function fmtP(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "p not computed";
  if (p < 0.001) return "p < 0.001";
  return `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(p < 0.1 ? 3 : 2)}`;
}

const pct1 = (x: { n: number; d: number } | null) => (x ? `${((x.n / x.d) * 100).toFixed(1)}%` : "n/a");
/** "1 in 8" for 12 of 92. */
const oneIn = (x: { n: number; d: number }) => `1 in ${Math.round(x.d / Math.max(1, x.n))}`;

/** The finding, said only as strongly as the numbers allow: the strict count shows no lift over products that never
 *  went short, and the close-dated count leans on hindsight (the OAI label came after the inspection closed). */
export function findingOf(b: { strict: ArmLike; endDated: ArmLike }): { strict: string; close: string; close2: string; end: string } | null {
  const eS = ofText(b.strict.episodesWithSignal);
  const eE = ofText(b.endDated.episodesWithSignal);
  if (!eS || !eE) return null;
  const lE = b.endDated.liftVsControl ?? b.endDated.lift ?? null;
  return {
    strict:
      `In ${oneIn(eS)} recent shortages (${eS.n} of ${eS.d}), dated strictly by what FDA had published, FDA had acted at a named plant ` +
      `in the two years before; no more often than for products that never went short (${pct1(ofText(b.strict.caseProducts))} of shortage ` +
      `products against ${pct1(ofText(b.strict.controlProducts))}, ${fmtP(b.strict.p)}).`,
    close: `Dated by when the inspection closed, it is ${oneIn(eE)} (${eE.n} of ${eE.d})`,
    close2:
      `${typeof lE === "number" ? `, about ${lE.toFixed(1)} times the controls (${pct1(ofText(b.endDated.caseProducts))} against ${pct1(ofText(b.endDated.controlProducts))}, ${fmtP(b.endDated.p)})` : ""}, ` +
      "but with hindsight: the OAI label came after the inspection, sometimes after the posting.",
    end: "The trail can explain a shortage after the fact, with every row cited. It is not a forecast.",
  };
}
