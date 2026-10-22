"use client";

import Link from "next/link";
import "./states.css";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="state-page">
      <div className="wrap">
        <p className="state-code">Error</p>
        <h1>This page did not load</h1>
        <p className="lede">
          Upstream hit a problem while building it: {error.message || "an unexpected error"}. The recordings are
          unchanged. Try again, or go back to the desk.
        </p>
        {error.digest ? <p className="small muted num">Reference {error.digest}</p> : null}
        <div className="state-go">
          <button type="button" className="btn btn--primary" onClick={reset}>
            Try again
          </button>
          <Link href="/desk" className="btn">
            Go to the desk
          </Link>
        </div>
      </div>
    </section>
  );
}
