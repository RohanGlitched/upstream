// The masthead: the thread mark, the nav, and the overnight watch's status. Server-rendered; the nav's
// current page, the phone menu and the theme switch are a small client island.
import Link from "next/link";
import { readJson } from "../server/data";
import { fmtDate } from "../lib/format";
import { MastNav } from "./MastNav";
import "./chrome.css";

interface WatchLite {
  asOf?: string;
  ranAt: string;
  drugs: number;
  flagged: { state: string }[];
  quiet: number;
}

export function ThreadMark({ size = 26 }: { size?: number }) {
  // Two pins and the red thread between them: the shelf and the plant, joined by FDA's record.
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <path d="M5 20 C 9 9, 15 22, 21 6" fill="none" stroke="var(--fda-red)" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="5" cy="20" r="3.3" fill="url(#rd-pinhead)" stroke="#3e4644" strokeWidth=".5" />
      <circle cx="21" cy="6" r="3.3" fill="url(#rd-pinhead)" stroke="#3e4644" strokeWidth=".5" />
    </svg>
  );
}

export async function Masthead() {
  const w = await readJson<WatchLite>("data/watch/latest.json");
  const act = w ? w.flagged.filter((f) => f.state === "act").length : null;
  const watch = w ? w.flagged.filter((f) => f.state !== "act").length : null;
  const asOf = w?.asOf ?? w?.ranAt?.slice(0, 10) ?? null;

  return (
    <header className="mast">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <div className="mast-row">
        <Link href="/" className="mast-brand" aria-label="Upstream, home">
          <ThreadMark />
          <span>Upstream</span>
        </Link>
        <MastNav
          status={
            w && asOf ? (
              <Link
                href="/desk"
                className="mast-watch"
                title={`The overnight watch read all ${w.drugs} formulary drugs against FDA's files, with stock as of ${fmtDate(asOf)}: ${act} drugs to act on today, ${watch} to watch, ${w.quiet} quiet.`}
                aria-label={`Overnight watch for ${fmtDate(asOf)}: ${act} drugs to act on, ${watch} to watch, ${w.quiet} quiet. Open the Ask page.`}
              >
                <span className="mast-watch__who">
                  <b>Corvale Health</b>, three hospitals
                </span>
                <span className="mast-watch__line">
                  <span className="mast-watch__dot" aria-hidden="true" />
                  <span className="mast-watch__full">
                    {`Overnight watch, ${fmtDate(asOf).replace(/ \d{4}$/, "")}: `}
                    <b className="mast-watch__act">{act} drugs to act on</b>
                    {`, ${watch} to watch`}
                  </span>
                  <span className="mast-watch__short" aria-hidden="true">
                    <span className="mast-watch__date">{`Watch ${fmtDate(asOf).replace(/ \d{4}$/, "")}: `}</span>
                    <b className="mast-watch__act">{act} to act on</b>
                    <span className="mast-watch__more">{`, ${watch} watch`}</span>
                  </span>
                </span>
              </Link>
            ) : (
              <span className="mast-watch">
                <span className="mast-watch__who">
                  <b>Corvale Health</b>, three hospitals
                </span>
              </span>
            )
          }
        />
      </div>
    </header>
  );
}
