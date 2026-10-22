"use client";

// Lazy hydration for a heavy section far down a long page: the server sends a sized, empty block, and the
// children render (and hydrate) only when the block comes within a screen or so of the viewport.
// Their props still travel in the page's payload; their markup and their first render wait.
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Defer({ children, minHeight, margin = "900px 0px", className, id }: { children: ReactNode; minHeight: number | string; margin?: string; className?: string; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || on) return;
    if (typeof IntersectionObserver === "undefined") return setOn(true);
    const io = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting)) {
        setOn(true);
        io.disconnect();
      }
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [on, margin]);
  return (
    <div ref={ref} id={id} className={className} style={on ? undefined : { minHeight }}>
      {on ? children : null}
    </div>
  );
}
