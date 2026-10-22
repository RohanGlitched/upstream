import Link from "next/link";
import { fdaManifest, isLive, realCases } from "./server/data";
import { fmtDate, fmtInt } from "./lib/format";
import { drugTitle } from "./lib/drug";
import { Mark } from "./SiteHeader";
import "./site.css";

const FDA_FILES: { key: string; name: string }[] = [
  { key: "ndc_packages", name: "NDC directory, packages" },
  { key: "spl_establishments", name: "Label establishments (SPL)" },
  { key: "registrations", name: "Establishment registrations" },
  { key: "inspections", name: "Inspection classifications" },
  { key: "citations", name: "Form 483 citations" },
  { key: "compliance_actions", name: "Warning letters and actions" },
  { key: "import_alerts", name: "Import alerts" },
  { key: "recalls", name: "Recalls" },
  { key: "shortage_current", name: "Drug shortages, current" },
  { key: "shortage_episodes", name: "Drug shortages, history" },
  { key: "shortage_presentations", name: "Drug shortages, presentations" },
  { key: "dmf_api", name: "Drug master files, API" },
];

export async function SiteFooter() {
  const [manifest, cases] = await Promise.all([fdaManifest(), realCases()]);
  const built = manifest?.built ? fmtDate(manifest.built) : null;
  const live = isLive();

  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <Link href="/" className="wordmark wordmark--footer">
              <Mark />
              <span>Upstream</span>
            </Link>
            <p>
              Why a drug is short, traced from our shelf to the factory, with every claim one click from the FDA row
              behind it.
            </p>
            <p className="footer-note">
              Corvale Health is a fictional health system: its three hospitals, stock, usage, decisions and people are
              invented for this demonstration. Every FDA record is real and public.
            </p>
            <p className={`mode${live ? " mode--live" : ""}`}>
              {live ? "This copy runs live investigations" : "This copy replays recorded investigations"}
            </p>
          </div>

          <nav className="footer-col" aria-label="Pages">
            <h2>Pages</h2>
            <ul>
              <li><Link href="/">Home</Link></li>
              <li><Link href="/desk">Buyer&apos;s desk</Link></li>
              <li><Link href="/plants">Plant atlas</Link></li>
              <li><Link href="/backtest">Back-test</Link></li>
              <li><Link href="/how">How it works</Link></li>
            </ul>
          </nav>

          <nav className="footer-col" aria-label="Recorded cases">
            <h2>Recorded cases</h2>
            <ul>
              {cases.length ? (
                cases.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/case/${c.slug}`}>{drugTitle(c.molecule)}</Link>
                  </li>
                ))
              ) : (
                <li className="muted">No recordings yet</li>
              )}
            </ul>
          </nav>

          <div className="footer-col footer-col--wide">
            <h2>Data sources</h2>
            <ul className="footer-sources">
              <li>
                <span>Corvale General pharmacy</span>
                <span className="muted">Postgres, read in place</span>
              </li>
              <li>
                <span>Corvale East pharmacy</span>
                <span className="muted">Postgres, its own schema</span>
              </li>
              <li>
                <span>Corvale Lakeside cabinets</span>
                <span className="muted">Nightly CSV exports</span>
              </li>
              <li>
                <span>Stock and usage as of</span>
                <span className="muted">21 Oct 2026</span>
              </li>
            </ul>
            <details className="footer-fda">
              <summary>
                FDA&apos;s 12 files{built ? `, built ${built}` : ""}
              </summary>
              <ul className="footer-sources">
                {FDA_FILES.map((f) => (
                  <li key={f.key}>
                    <span>{f.name}</span>
                    <span className="muted num">
                      {manifest?.counts?.[f.key] !== undefined ? `${fmtInt(manifest.counts[f.key])} rows` : "public file"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>

        <div className="footer-credits">
          <h2>Built with</h2>
          <p>
            <a href="https://www.zetaris.com" rel="noopener noreferrer">Zetaris</a> federates the three hospitals and
            FDA&apos;s files where they live, through one semantic layer. The H-MEM, World Model and Markovian engines
            are Meterless code (Apache-2.0); Scout Intent is our implementation of the Meterless spec.{" "}
            <a href="https://build.nvidia.com" rel="noopener noreferrer">NVIDIA Nemotron</a> writes the explanation,
            and a deterministic verifier keeps only sentences its evidence supports. FDA data comes from{" "}
            <a href="https://open.fda.gov" rel="noopener noreferrer">openFDA</a>, the{" "}
            <a href="https://www.accessdata.fda.gov/scripts/drugshortages/" rel="noopener noreferrer">
              FDA Drug Shortages
            </a>{" "}
            database and FDA&apos;s Data Dashboard. Type is{" "}
            <a href="https://public-sans.digital.gov" rel="noopener noreferrer">Public Sans</a>; map outlines are
            Natural Earth.
          </p>
        </div>

        <div className="footer-base">
          <p>Not medical advice. Upstream informs buyers; pharmacists and the P&amp;T committee decide.</p>
          <p>Open Agent Hackathon 2026, Track 2: the agent that can explain why.</p>
        </div>
      </div>
    </footer>
  );
}
