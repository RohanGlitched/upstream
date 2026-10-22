"use client";

// A slim index of a long page's sections, stuck under the masthead. The section being read is marked: the last
// one whose top has passed a reading line a third of the way down. IntersectionObserver only, no scroll handler.
import { useEffect, useRef, useState } from "react";

export interface SectionLink {
  id: string;
  label: string;
}

export function SectionIndex({ items, label = "On this page" }: { items: SectionLink[]; label?: string }) {
  const [on, setOn] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const key = items.map((i) => i.id).join(" ");

  useEffect(() => {
    const ids = key.split(" ");
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => Boolean(e));
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const pick = () => {
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

  return (
    <nav className="sx" aria-label={label}>
      <div className="sx-in" ref={bar}>
        <span className="sx-k">{label}</span>
        <ol>
          {items.map((it) => (
            <li key={it.id}>
              <a href={`#${it.id}`} aria-current={on === it.id ? "location" : undefined}>
                {it.label}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
