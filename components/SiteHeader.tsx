"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import "./site.css";

const NAV = [
  { href: "/desk", label: "Desk" },
  { href: "/case/carboplatin", label: "Carboplatin case", match: "/case" },
  { href: "/plants", label: "Plants" },
  { href: "/backtest", label: "Back-test" },
  { href: "/how", label: "How it works" },
];

export function Mark({ size = 22 }: { size?: number }) {
  // A lead-time ruler in miniature: small ticks for FDA signals, the tall one for the day the shortage was posted.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mark">
      <path d="M2 18.5H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 18.5V14.5M9 18.5V13M12.5 18.5V15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 18.5V4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="18" cy="4" r="2.4" fill="currentColor" />
    </svg>
  );
}

export function SiteHeader() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="site-header">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <div className="wrap site-header__row">
        <Link href="/" className="wordmark" aria-label="Upstream, home">
          <Mark />
          <span>Upstream</span>
        </Link>
        <nav className={`site-nav${open ? " is-open" : ""}`} aria-label="Main" id="site-nav">
          <ul>
            {NAV.map((n) => {
              const on = n.match ? path.startsWith(n.match) : path === n.href || path.startsWith(n.href + "/");
              return (
                <li key={n.href}>
                  <Link href={n.href} aria-current={on ? "page" : undefined} className={on ? "is-on" : undefined}>
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="site-header__tools">
          <ThemeToggle />
          <button
            type="button"
            className="menu-btn"
            aria-expanded={open}
            aria-controls="site-nav"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              {open ? (
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
