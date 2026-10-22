"use client";

// "Back to top": a small fixed button that shows once the reader is a screen down. A sentinel one screen tall
// at the top of the page tells an IntersectionObserver when that is; it steps aside while a full-screen piece
// (the film's pinned stage) is on screen, so it never sits on the film's own captions.
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const AVOID = ".fm, [data-totop-avoid]";

export function ToTop() {
  const path = usePathname();
  const top = useRef<HTMLDivElement>(null);
  const [down, setDown] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // On a phone the button hides while the reader scrolls down and comes back when they scroll up.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const phone = window.matchMedia("(max-width: 720px)");
    let last = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        if (Math.abs(y - last) < 6) return;
        setHidden(phone.matches && y > last);
        last = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const s = top.current;
    if (!s || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setDown(!e.isIntersecting));
    io.observe(s);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = [...document.querySelectorAll<HTMLElement>(AVOID)];
    if (!els.length) return setBlocked(false);
    const seen = new Set<Element>();
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (e.isIntersecting) seen.add(e.target);
        else seen.delete(e.target);
      }
      setBlocked(seen.size > 0);
    }, { rootMargin: "-40% 0px -40% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [path]);

  const go = () => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
    // Keyboard and screen-reader users land where they asked to go.
    const brand = document.querySelector<HTMLElement>(".mast-brand");
    brand?.focus({ preventScroll: true });
  };

  const show = down && !blocked && !hidden;
  return (
    <>
      <div ref={top} className="totop-sentinel" aria-hidden="true" />
      <button type="button" aria-label="Back to top" className={`totop${show ? " is-on" : ""}`} title="Back to top" onClick={go} tabIndex={show ? 0 : -1} aria-hidden={show ? undefined : true}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 13V3.5M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="totop-label">Back to top</span>
      </button>
    </>
  );
}
