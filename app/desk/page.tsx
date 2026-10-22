import type { Metadata } from "next";
import { Investigation } from "@/components/desk/Investigation";
import { flagName, ReportBody, ReportHead, RunStrip, type WatchRun } from "@/components/desk/Printout";
import type { BriefSummary } from "@/components/desk/Investigation";
import { slugFor } from "@/components/lib/drug";
import { isLive, readJson, realCases } from "@/components/server/data";
import { fmtDateLong } from "@/components/lib/format";
import "./desk.css";

export const metadata: Metadata = {
  title: "The buyer's desk",
  description: "The overnight formulary watch as a printed report, and the request slip that starts an investigation.",
};

export const dynamic = "force-dynamic";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function Desk({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.slice(0, 400);
  const [cases, w] = await Promise.all([realCases(), readJson<WatchRun>("data/watch/latest.json")]);
  const live = isLive();
  // The morning is the day the report printed; the data in it is as of the night before.
  const morning = w?.ranAt.slice(0, 10) ?? cases.map((c) => c.askedAt.slice(0, 10)).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  const day = DAYS[new Date(morning + "T00:00:00Z").getUTCDay()];
  const act = w ? w.flagged.filter((f) => f.state === "act") : [];
  // The shortest shelf across every flagged drug, not only the ones to act on (a watch drug can be lower).
  const lowest = w ? [...w.flagged].filter((f) => f.minDays !== null).sort((a, b) => (a.minDays ?? 1e9) - (b.minDays ?? 1e9))[0] : undefined;
  // What the desk says when a buyer asks for the morning brief: the report's counts and its shortest shelves.
  const onFile = new Set(cases.map((c) => c.slug));
  const brief: BriefSummary | null = w
    ? {
        ranAt: w.ranAt, drugs: w.drugs, act: act.length, watch: w.flagged.length - act.length, quiet: w.quiet, brief: w.brief ?? null,
        top: [...act].sort((a, b) => (a.minDays ?? 1e9) - (b.minDays ?? 1e9)).slice(0, 5).map((f) => {
          const slug = [f.slug, slugFor(f.molecule), slugFor(f.molecule).split("-")[0]].find((x) => x && onFile.has(x)) ?? null;
          return { name: flagName(f), days: f.minDays, hospital: f.hospital, slug };
        }),
      }
    : null;

  return (
    <>
      <section className="dk-hero" aria-labelledby="dk-h">
        <div className="dk-in dk-grid">
          <div className="dk-intro">
            <p className="dk-date">
              <b>
                {day}, {fmtDateLong(morning)}
              </b>
              Corvale Health, pharmacy purchasing
            </p>
            <h1 id="dk-h">The buyer&apos;s morning</h1>
            <p className="dk-dek">
              Overnight, Upstream walked every drug on the formulary against our three hospitals&apos; stock and FDA&apos;s
              files. The report came off the printer at {w ? w.ranAt.slice(11, 16) : "dawn"}.
              {lowest ? (
                <>
                  {" "}
                  The shortest shelf is {flagName(lowest)} at {lowest.hospital}: {lowest.minDays} days.
                </>
              ) : null}
            </p>
            <a href="#ask" className="dk-jump">
              File a question
            </a>
          </div>
          {w ? (
            <ReportHead w={w} />
          ) : (
            <div className="notice">
              <span className="notice__mark" aria-hidden="true">i</span>
              <h3>No overnight watch on this copy yet</h3>
              <p>The watch walks the formulary each night in chunks and prints its report here after the first run.</p>
            </div>
          )}
        </div>
      </section>

      <section id="ask" className="dk-sec dk-ask" aria-labelledby="ask-h">
        <div className="dk-in">
          <div className="rec-head">
            <h2 id="ask-h">Ask Upstream</h2>
            <p>
              Type the question the way you would say it. Each step is filed as it finishes, then the whole record is laid out on the desk.{" "}
              <span className={`mode${live ? " mode--live" : ""}`}>{live
                  ? "Live: questions run against Zetaris"
                  : "Replay: Ask replays recorded runs of the live agent (Zetaris and Nemotron run locally); every recording is a real run"}</span>
            </p>
          </div>
        </div>
        <Investigation initial={q} onFile={cases.length} date={morning} brief={brief} />
      </section>

      {w ? (
        <>
          <section className="dk-sec" aria-labelledby="report-h">
            <div className="dk-in">
              <div className="rec-head">
                <h2 id="report-h">The overnight report</h2>
                <p>
                  {w.drugs} drugs checked. Most are quiet; these are not. Every line opens the investigation behind it, or asks for one.
                </p>
              </div>
              <ReportBody w={w} cases={new Set(cases.map((c) => c.slug))} />
            </div>
          </section>

          <section className="dk-sec" aria-labelledby="run-h">
            <div className="dk-in">
              <div className="rec-head">
                <h2 id="run-h">How the watch ran</h2>
                <p>
                  Markovian walks the formulary in fixed-size chunks. The list, the cursor and the findings live in the World
                  Model, not in the prompt, so each chunk&apos;s prompt stays the same size however long the list. Scout issues a
                  fresh contract for every chunk.
                </p>
              </div>
              <RunStrip w={w} />
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
