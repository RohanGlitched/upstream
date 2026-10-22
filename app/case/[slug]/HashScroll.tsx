"use client";

// "Send to sign" links to /case/<slug>#memo. After a client navigation the page mounts at the top (and the
// desk re-packs its height once it measures), so the browser's own jump to the hash is lost or lands short.
// This scrolls to the hash after mount, then once more as the page settles, unless the reader has scrolled.
import { useEffect } from "react";

export function HashScroll() {
  useEffect(() => {
    let moved = false;
    const timers: number[] = [];
    const go = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (el && !moved) el.scrollIntoView({ block: "start" });
    };
    const settle = () => {
      moved = false;
      go();
      for (const ms of [250, 700, 1400]) timers.push(window.setTimeout(go, ms));
    };
    const stop = () => (moved = true);
    if (location.hash) settle();
    window.addEventListener("hashchange", settle);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", stop);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("hashchange", settle);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);
  return null;
}
