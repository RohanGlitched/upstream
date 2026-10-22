// Renders `backticks` in README cells as code, and nothing else.
export function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="ic">
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p.replace(/->/g, "→")}</span>
        ),
      )}
    </>
  );
}
