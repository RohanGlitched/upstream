"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

// "Start here" is the judge's path on the front page; it marks the front page as the current one.
const NAV = [
  { href: "/#start", label: "Start here" },
  { href: "/desk", label: "Ask" },
  { href: "/case", label: "Investigations" },
  { href: "/plants", label: "Plants" },
  { href: "/backtest", label: "Proof" },
  { href: "/how", label: "How it works" },
];

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(currentTheme()), []);
  const flip = () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("upstream-theme", next);
    } catch {
      /* private mode: the choice lasts for this page */
    }
    setTheme(next);
  };
  const label = theme === "dark" ? "Use the light desk" : "Use the dark desk";
  return (
    <button type="button" className="mast-icon" onClick={flip} aria-label={label} title={label}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
      </svg>
    </button>
  );
}

export function MastNav({ status }: { status: ReactNode }) {
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
    <>
      <nav className={`mast-nav${open ? " is-open" : ""}`} aria-label="Main" id="mast-nav">
        <ul>
          {NAV.map((n) => {
            const base = n.href.split("#")[0];
            const on = base === "/" ? path === "/" : path === base || path.startsWith(base + "/");
            return (
              <li key={n.href}>
                <Link href={n.href} aria-current={on ? "page" : undefined} onClick={() => setOpen(false)}>
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mast-tools">
        {status}
        <ThemeSwitch />
        <button
          type="button"
          className="mast-icon mast-menu"
          aria-expanded={open}
          aria-controls="mast-nav"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="sr-only">{open ? "Close the menu" : "Open the menu"}</span>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {open ? (
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            ) : (
              <path d="M3 6h14M3 10h14M3 14h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>
    </>
  );
}
