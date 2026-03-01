export function InlineDiff({ diff }: { diff: string }) {
  if (!diff || diff === "(no diff available)") {
    return (
      <div className="mx-3 mb-1 rounded bg-foreground/[0.03] px-2 py-1.5 text-[10px] text-foreground/25 italic">
        No diff available
      </div>
    );
  }
  const lines = diff.split("\n");
  const contentLines = lines.filter(
    (l) => !l.startsWith("diff ") && !l.startsWith("index ") && !l.startsWith("---") && !l.startsWith("+++") && !l.startsWith("\\"),
  );
  return (
    <div className="mx-3 mb-1 max-h-48 overflow-auto rounded bg-foreground/[0.03]">
      <pre className="px-2 py-1 font-mono text-[10px] leading-relaxed">
        {contentLines.map((line, i) => {
          let color = "text-foreground/35";
          if (line.startsWith("+")) color = "text-emerald-400/60";
          else if (line.startsWith("-")) color = "text-red-400/60";
          else if (line.startsWith("@@")) color = "text-blue-400/40";
          return (
            <div key={i} className={color}>{line || " "}</div>
          );
        })}
      </pre>
    </div>
  );
}
