// Renders an agent reply: paragraphs, "*"/"-" bullets, **bold**, `code`, short "#" headings and "---" rules. No HTML is ever
// injected (React escapes every string). The plan's own id is shown as "this plan" instead of a raw UUID.
import { Fragment } from "react";

function inline(text: string, planId?: string): React.ReactNode[] {
  const cleaned = planId ? text.replaceAll(`\`${planId}\``, "this plan").replaceAll(planId, "this plan") : text;
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of cleaned.matchAll(re)) {
    if (m.index > last) out.push(cleaned.slice(last, m.index));
    const tok = m[0];
    out.push(
      tok.startsWith("**") ? (
        <strong key={m.index} className="font-semibold text-fg-1">
          {tok.slice(2, -2)}
        </strong>
      ) : (
        <code key={m.index} className="rounded bg-white/5 px-1 font-mono text-[12px] text-fg-1">
          {tok.slice(1, -1)}
        </code>
      ),
    );
    last = m.index + tok.length;
  }
  if (last < cleaned.length) out.push(cleaned.slice(last));
  return out;
}

export function RichText({ text, planId }: { text: string; planId?: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="space-y-2.5 text-[13.5px] leading-[21px] text-fg-2">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim());
        const bullets = lines.filter((l) => /^\s*[*-]\s+/.test(l));
        if (bullets.length > 0 && bullets.length === lines.length) {
          return (
            <ul key={bi} className="space-y-1">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[9px] size-1 shrink-0 rounded-full bg-fg-3" aria-hidden />
                  <span>{inline(l.replace(/^\s*[*-]\s+/, ""), planId)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <Fragment key={bi}>
            {lines.map((l, i) =>
              /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) ? (
                <hr key={i} className="border-border" />
              ) : /^#{1,4}\s/.test(l) ? (
                <p key={i} className="font-semibold text-fg-1">
                  {inline(l.replace(/^#{1,4}\s/, ""), planId)}
                </p>
              ) : /^\s*[*-]\s+/.test(l) ? (
                <p key={i} className="flex gap-2">
                  <span className="mt-[9px] size-1 shrink-0 rounded-full bg-fg-3" aria-hidden />
                  <span>{inline(l.replace(/^\s*[*-]\s+/, ""), planId)}</span>
                </p>
              ) : (
                <p key={i}>{inline(l, planId)}</p>
              ),
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** "AI" or "Calculated": where an answer came from. */
export function SourceTag({ source }: { source: "agent" | "deterministic" }) {
  return source === "agent" ? (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-brand/30 bg-brand-glow px-2 text-[11px] font-medium text-brand">
      <span className="size-1.5 rounded-full bg-brand" aria-hidden /> AI
    </span>
  ) : (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-border-strong bg-surface-3 px-2 text-[11px] font-medium text-fg-2">
      <span className="size-1.5 rounded-full bg-fg-3" aria-hidden /> Calculated
    </span>
  );
}
