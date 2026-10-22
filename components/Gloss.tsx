"use client";

// A gloss for the record's jargon: the term stays as FDA and pharmacy write it, and a short plain reading
// opens on hover, focus or tap. Escape closes it. <Glossed text="..."/> glosses every known term in a string.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./gloss.css";

export const GLOSSARY: Record<string, string> = {
  OAI: "Official Action Indicated: FDA's most serious inspection finding. FDA found serious violations at the plant and regulatory action is warranted.",
  VAI: "Voluntary Action Indicated: FDA found problems, and the firm is expected to fix them on its own.",
  NAI: "No Action Indicated: FDA found nothing that needs action.",
  FEI: "FDA Establishment Identifier: the number FDA gives one physical site, used across its inspection, import and compliance files.",
  NDC: "National Drug Code: labeler, product and package, as FDA lists them (00703-4239-01). Barcodes and wholesalers use an 11-digit form of the same code.",
  "P&T": "Pharmacy and Therapeutics committee: the hospital group that approves formulary changes and substitutions.",
  USL: "Unified Semantic Layer: the Zetaris layer that gives three hospitals' stock tables one shape, read in place.",
  "Form 483": "FDA Form 483: the list of objectionable conditions an investigator hands the firm at the end of an inspection.",
  "FMD-145": "FMD-145 letter: FDA's letter telling a firm how its inspection was classified. It is when the finding becomes known.",
  "import alert 66-40": "Import alert 66-40: FDA may detain, without examination, drugs from firms that have not met good manufacturing practice.",
  "H-MEM": "H-MEM: Meterless's memory of past decisions. It recalls what was signed before and records a new decision only under a signature.",
};

const ALIASES: [RegExp, string][] = [
  [/\bForm 483\b/, "Form 483"],
  [/\bFMD-145\b/, "FMD-145"],
  [/\bimport alert 66-40\b/i, "import alert 66-40"],
  [/\bH-MEM\b/, "H-MEM"],
  [/\bP&T\b/, "P&T"],
  [/\bOAI\b/, "OAI"],
  [/\bVAI\b/, "VAI"],
  [/\bNAI\b/, "NAI"],
  [/\bFEI\b/, "FEI"],
  [/\bNDCs?\b/, "NDC"],
  [/\bUSL\b/, "USL"],
];
const ANY = new RegExp(ALIASES.map(([r]) => r.source).join("|"), "gi");

export function Gloss({ term, def, children }: { term?: string; def?: ReactNode; children: ReactNode }) {
  // Three ways in, kept apart so they never cancel each other: a mouse hovering, keyboard focus, and a click or
  // tap that pins the card open until the next click, a tap elsewhere or Escape.
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || focus || pinned;
  const [shift, setShift] = useState(0);
  const tip = useRef<HTMLSpanElement>(null);
  const id = useId();
  const text = def ?? (term ? GLOSSARY[term] : null);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setPinned(false);
      setHover(false);
      setFocus(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element)?.closest?.(`[data-gloss="${CSS.escape(id)}"]`)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, id]);

  // keep the card on the screen at phone width
  useLayoutEffect(() => {
    if (!open || !tip.current) return setShift(0);
    const r = tip.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (r.right > vw - 12) setShift((s) => s - (r.right - (vw - 12)));
    else if (r.left < 12) setShift((s) => s + (12 - r.left));
  }, [open]);

  if (!text) return <>{children}</>;
  return (
    <span
      className={`gl${open ? " is-open" : ""}`}
      data-gloss={id}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
    >
      <button
        type="button"
        className="gl-term"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={(e) => {
          // keyboard focus only: a tap also focuses the button, and the click below handles that
          let kb = true;
          try {
            kb = e.currentTarget.matches(":focus-visible");
          } catch {
            /* an old browser without :focus-visible */
          }
          if (kb) setFocus(true);
        }}
        onBlur={() => setFocus(false)}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((v) => !v);
        }}
      >
        {children}
      </button>
      {open ? (
        <span ref={tip} role="tooltip" id={id} className="gl-tip" style={{ marginLeft: shift }}>
          {text}
        </span>
      ) : null}
    </span>
  );
}

/** A string with every known term glossed once (the first time it appears). */
export function Glossed({ text, overrides }: { text: string; overrides?: Record<string, ReactNode> }) {
  const out: ReactNode[] = [];
  const seen = new Set<string>();
  let last = 0;
  for (const m of text.matchAll(ANY)) {
    const word = m[0];
    const key = ALIASES.find(([r]) => new RegExp(`^(?:${r.source})$`, r.flags).test(word))?.[1];
    if (!key || seen.has(key) || m.index === undefined) continue;
    seen.add(key);
    out.push(text.slice(last, m.index));
    out.push(
      <Gloss key={m.index} term={key} def={overrides?.[key]}>
        {word}
      </Gloss>,
    );
    last = m.index + word.length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
