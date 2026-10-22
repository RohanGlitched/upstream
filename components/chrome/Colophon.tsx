// The footer as the record's colophon, kept to one band: what Upstream is and what is fictional, the pages,
// what it is built with, and the form line every batch record ends on. Sources and their dates live on /how.
import Link from "next/link";
import { isLive, readJson } from "../server/data";
import { ThreadMark } from "./Masthead";
import "./chrome.css";

interface WatchLite {
  asOf?: string;
  drugs: number;
  flagged: unknown[];
}

const PAGES: [string, string][] = [
  ["/#start", "Start here"],
  ["/desk", "Ask"],
  ["/case", "Investigations"],
  ["/plants", "Plants"],
  ["/backtest", "Accuracy"],
  ["/how", "How it works"],
  ["/how#sources", "Sources and dates"],
];

const BUILT: [string, string][] = [
  ["https://www.zetaris.com", "Zetaris"],
  ["https://github.com/Meterless/Meterless", "Meterless"],
  ["https://build.nvidia.com", "NVIDIA Nemotron"],
  ["https://github.com/RohanGlitched/upstream/tree/main/docs/cursor", "Cursor"],
];

export async function Colophon() {
  const watch = await readJson<WatchLite>("data/watch/latest.json");
  const live = isLive();

  return (
    <footer className="colo">
      <div className="colo-in">
        <div className="colo-top">
          <div className="colo-brand">
            <Link href="/" className="mast-brand mast-brand--foot">
              <ThreadMark size={26} />
              <span>Upstream</span>
            </Link>
            <p className="colo-say">Why a drug is short, from our shelf to the plant on its label, every claim one click from its FDA row.</p>
          </div>
          <p className="colo-note">
            <b>A fictional health system, real FDA data.</b> Corvale Health and its three hospitals are invented; every FDA record is real,
            public and dated. {live ? "This copy runs live against Zetaris." : "This copy replays recorded runs of the live agent."}
          </p>
        </div>

        <nav className="colo-links" aria-label="Pages">
          <ul>
            {PAGES.map(([href, label]) => (
              <li key={href}>
                <Link href={href}>{label}</Link>
              </li>
            ))}
            <li>
              <a href="https://github.com/RohanGlitched/upstream" rel="noopener noreferrer">
                GitHub
              </a>
            </li>
          </ul>
        </nav>

        <p className="colo-stack">
          <span>Built with</span>{" "}
          {BUILT.map(([href, name], i) => (
            <span key={name}>
              {i ? <span aria-hidden="true"> · </span> : null}
              <a href={href} rel="noopener noreferrer">
                {name}
              </a>
            </span>
          ))}
          <span aria-hidden="true"> · </span>
          <a href="https://open.fda.gov" rel="noopener noreferrer">
            openFDA
          </a>
        </p>

        <div className="colo-form">
          <span>Form UP-1, rev. 2026-10. Not medical advice: Upstream informs buyers; pharmacists and the P&amp;T committee decide.</span>
          <span>
            {watch ? `Watch ${watch.asOf ?? ""}: ${watch.flagged.length} of ${watch.drugs} drugs flagged. ` : ""}Open Agent Hackathon 2026.
          </span>
        </div>
      </div>
    </footer>
  );
}
