// The footer as the record's colophon: a sitemap, every source with its date, what is fictional and what
// is real, the engines behind it, and the form line every batch record ends on.
import Link from "next/link";
import { fdaManifest, isLive, readJson, realCases } from "../server/data";
import { fmtDate, fmtInt } from "../lib/format";
import { drugTitle } from "../lib/drug";
import { ThreadMark } from "./Masthead";
import "./chrome.css";

const FDA_FILES: { key: string; name: string; href: string }[] = [
  { key: "ndc_packages", name: "NDC directory", href: "https://open.fda.gov/apis/drug/ndc/" },
  { key: "spl_establishments", name: "Label establishments", href: "https://dailymed.nlm.nih.gov/dailymed/" },
  { key: "registrations", name: "Establishment registrations", href: "https://www.fda.gov/drugs/drug-approvals-and-databases/drug-establishments-current-registration-site" },
  { key: "inspections", name: "Inspection classifications", href: "https://datadashboard.fda.gov/ora/cd/inspections.htm" },
  { key: "citations", name: "Form 483 citations", href: "https://datadashboard.fda.gov/ora/cd/inspectioncitations.htm" },
  { key: "compliance_actions", name: "Warning letters and actions", href: "https://datadashboard.fda.gov/ora/cd/complianceactions.htm" },
  { key: "import_alerts", name: "Import alerts", href: "https://www.accessdata.fda.gov/cms_ia/ialist.html" },
  { key: "recalls", name: "Recalls", href: "https://open.fda.gov/apis/drug/enforcement/" },
  { key: "shortage_current", name: "Drug shortages", href: "https://www.accessdata.fda.gov/scripts/drugshortages/" },
  { key: "shortage_episodes", name: "Shortage history", href: "https://www.accessdata.fda.gov/scripts/drugshortages/" },
  { key: "shortage_presentations", name: "Shortage presentations", href: "https://www.accessdata.fda.gov/scripts/drugshortages/" },
  { key: "dmf_api", name: "Drug master files", href: "https://www.fda.gov/drugs/drug-master-files-dmfs/list-drug-master-files-dmfs" },
];

interface WatchLite {
  asOf?: string;
  drugs: number;
  flagged: unknown[];
}

export async function Colophon() {
  const [manifest, cases, watch, plants] = await Promise.all([
    fdaManifest(),
    realCases(),
    readJson<WatchLite>("data/watch/latest.json"),
    readJson<{ plants: unknown[] }>("data/plants.json"),
  ]);
  const built = manifest?.built ? manifest.built.slice(0, 10) : null;
  const live = isLive();
  const fdaRows = manifest ? Object.values(manifest.counts).reduce((a, b) => a + b, 0) : null;
  const lowest = cases.slice(0, 6);

  return (
    <footer className="colo">
      <div className="colo-in">
        <div className="colo-top">
          <div className="colo-brand">
            <Link href="/" className="mast-brand mast-brand--foot">
              <ThreadMark size={30} />
              <span>Upstream</span>
            </Link>
            <p className="colo-say">
              Why a drug is short, followed from our shelf upstream to the plant on its label, with every claim one
              click from the FDA row behind it.
            </p>
            <p className="colo-note">
              <b>A fictional health system, real FDA data.</b> Corvale Health, its three hospitals, their stock, usage,
              people and past decisions are invented. Every inspection, warning letter, import alert, recall and
              shortage posting is real, public and dated.
            </p>
            <p className={`mode${live ? " mode--live" : ""}`}>{live ? "This copy runs live investigations against Zetaris" : "This copy replays recorded investigations, and says so on each one"}</p>
          </div>

          <nav className="colo-col" aria-label="Pages">
            <h2>The record</h2>
            <ul>
              <li><Link href="/">The front page</Link></li>
              <li><Link href="/desk">The buyer&apos;s desk</Link></li>
              <li><Link href="/case">Every investigation</Link></li>
              <li><Link href="/plants">The plants behind our shelf</Link></li>
              <li><Link href="/backtest">Proof: the back-test</Link></li>
              <li><Link href="/how">How it works</Link></li>
            </ul>
          </nav>

          <nav className="colo-col" aria-label="Shortest shelves">
            <h2>Shortest shelves</h2>
            <ul>
              {lowest.map((c) => (
                <li key={c.slug}>
                  <Link href={`/case/${c.slug}`}>{drugTitle(c.molecule).slice(0, 34)}</Link>
                  {c.minDays !== null ? <span className="colo-num"> {c.minDays < 10 ? c.minDays.toFixed(1) : Math.round(c.minDays)} d</span> : null}
                </li>
              ))}
              <li>
                <Link href="/case">All {cases.length} investigations</Link>
              </li>
            </ul>
          </nav>

          <div className="colo-col colo-col--src">
            <h2>Sources, with dates</h2>
            <dl className="colo-src">
              <div>
                <dt>Corvale General pharmacy</dt>
                <dd>Postgres, read in place</dd>
              </div>
              <div>
                <dt>Corvale East pharmacy</dt>
                <dd>Postgres, its own schema</dd>
              </div>
              <div>
                <dt>Corvale Lakeside cabinets</dt>
                <dd>Nightly CSV exports</dd>
              </div>
              <div>
                <dt>Stock and usage</dt>
                <dd>as of {fmtDate(watch?.asOf ?? "2026-10-21")}</dd>
              </div>
              <div>
                <dt>FDA&apos;s files, {FDA_FILES.length} registered</dt>
                <dd>{built ? `cleaned into CSVs ${fmtDate(built)}` : "public files"}{fdaRows ? `, ${fmtInt(fdaRows)} rows` : ""}, read as file tables</dd>
              </div>
            </dl>
            <ul className="colo-fda">
              {FDA_FILES.map((f) => (
                <li key={f.key}>
                  <a href={f.href} rel="noopener noreferrer">
                    {f.name}
                  </a>
                  <span className="colo-num">{manifest?.counts?.[f.key] !== undefined ? fmtInt(manifest.counts[f.key]) : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="colo-stack" aria-label="Built with">
          <h2>Built with</h2>
          <ul>
            <li>
              <a href="https://www.zetaris.com" rel="noopener noreferrer">Zetaris</a>
              <span>reads three hospital systems in place and FDA&apos;s cleaned files as file tables, through one semantic layer</span>
            </li>
            <li>
              <a href="https://build.nvidia.com" rel="noopener noreferrer">NVIDIA Nemotron</a>
              <span>writes the explanation; a deterministic verifier keeps only what its rows support</span>
            </li>
            <li>
              <b>Meterless engines</b>
              <span>Scout Intent signs a contract for every action; H-MEM remembers signed decisions; the World Model keeps the chain; Markovian walks the formulary overnight</span>
            </li>
            <li>
              <a href="https://github.com/RohanGlitched/upstream/tree/main/docs/cursor" rel="noopener noreferrer">Cursor</a>
              <span>Cursor&apos;s agent wrote the generator behind Corvale&apos;s three hospital systems; its sessions are logged in the repo</span>
            </li>
            <li>
              <a href="https://open.fda.gov" rel="noopener noreferrer">openFDA</a> and FDA&apos;s Data Dashboard
              <span>the public record, every row cited</span>
            </li>
          </ul>
        </div>

        <div className="colo-form">
          <span>Form UP-1, rev. 2026-10. Not medical advice: Upstream informs buyers; pharmacists and the P&amp;T committee decide.</span>
          <span>
            Watch list {watch?.asOf ?? ""}: {watch ? `${watch.flagged.length} of ${watch.drugs} formulary drugs flagged` : "not run"}
            {plants ? `, ${plants.plants.length} plants on file` : ""}. Open Agent Hackathon 2026.
          </span>
        </div>
      </div>
    </footer>
  );
}
