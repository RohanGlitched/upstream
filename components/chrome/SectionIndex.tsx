"use client";

// A slim index of a long page's sections, stuck under the masthead. The section being read is marked: the last
// one whose top has passed a reading line a third of the way down. IntersectionObserver only, no scroll handler.
import { useEffect, useRef, useState, type MouseEvent } from "react";

export interface SectionLink {
  id: string;
  label: string;
}

export function SectionIndex({ items, label = "On this page" }: { items: SectionLink[]; label?: string }) {
  const [on, setOn] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const key = items.map((i) => i.id).join(" ");
  // While a jump from the index is settling, the target stays marked and the observer does not overrule it.
  const jumping = useRef<{ id: string; timers: number[] } | null>(null);

  useEffect(() => {
    const ids = key.split(" ");
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => Boolean(e));
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const pick = () => {
      if (jumping.current) return;
      const line = window.innerHeight * 0.34;
      let cur: string | null = null;
      for (const el of els) if (el.getBoundingClientRect().top <= line) cur = el.id;
      setOn(cur);
    };
    // A band from the top of the viewport to the reading line: a section's top entering or leaving it is
    // exactly when the marked section can change.
    const io = new IntersectionObserver(pick, { rootMargin: "0px 0px -66% 0px", threshold: [0, 1] });
    els.forEach((el) => io.observe(el));
    pick();
    return () => io.disconnect();
  }, [key]);

  // On a phone the index scrolls sideways; keep the marked label in view without moving the page.
  useEffect(() => {
    const b = bar.current;
    const a = on ? b?.querySelector<HTMLElement>(`a[href="#${CSS.escape(on)}"]`) : null;
    if (!b || !a || b.scrollWidth <= b.clientWidth) return;
    const left = a.offsetLeft - (b.clientWidth - a.offsetWidth) / 2;
    b.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [on]);

  // Sections above the target grow as their deferred parts mount during a smooth scroll, so the first scroll
  // lands short: scroll, then re-align twice as the page settles, unless the reader scrolls on their own.
  useEffect(() => {
    const stop = () => {
      if (!jumping.current) return;
      jumping.current.timers.forEach(clearTimeout);
      jumping.current = null;
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", stop);
    return () => {
      stop();
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);

  const jump = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    jumping.current?.timers.forEach(clearTimeout);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Land just under the masthead and this index, both stuck to the top.
    const align = (smooth: boolean) => {
      const under = (bar.current?.closest("nav")?.getBoundingClientRect().bottom ?? 84) + 12;
      const top = el.getBoundingClientRect().top + window.scrollY - under;
      window.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduce ? "smooth" : "auto" });
    };
    setOn(id);
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {
      /* the address bar is a convenience only */
    }
    align(true);
    const timers = [
      window.setTimeout(() => align(true), 300),
      window.setTimeout(() => align(false), 900),
      window.setTimeout(() => align(false), 1700),
      window.setTimeout(() => {
        jumping.current = null;
      }, 2000),
    ];
    jumping.current = { id, timers };
  };

  return (
    <nav className="sx" aria-label={label}>
      <div className="sx-in" ref={bar}>
        <span className="sx-k">{label}</span>
        <ol>
          {items.map((it) => (
            <li key={it.id}>
              <a href={`#${it.id}`} aria-current={on === it.id ? "location" : undefined} onClick={(e) => jump(e, it.id)}>
                {it.label}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
