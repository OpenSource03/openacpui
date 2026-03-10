export function InlineDiff({ diff }: { diff: string }) {
  if (!diff || diff === "(no diff available)") {
    return (
      <div className="mx-3 mb-1.5 rounded-md border border-foreground/[0.04] bg-foreground/[0.02] px-3 py-2 text-[10px] text-foreground/25 italic">
        No diff available
      </div>
    );
  }
  const lines = diff.split("\n");
  const contentLines = lines.filter(
    (l) => !l.startsWith("diff ") && !l.startsWith("index ") && !l.startsWith("---") && !l.startsWith("+++") && !l.startsWith("\\"),
  );
  return (
    <div className="mx-3 mb-1.5 max-h-56 overflow-auto rounded-md border border-foreground/[0.04]">
      <pre className="font-mono text-[10px] leading-[1.7]">
        {contentLines.map((line, i) => {
          let textColor = "text-foreground/35";
          let bgColor = "";
          if (line.startsWith("+")) {
            textColor = "text-emerald-400/70";
            bgColor = "bg-emerald-500/[0.04]";
          } else if (line.startsWith("-")) {
            textColor = "text-red-400/70";
            bgColor = "bg-red-500/[0.04]";
          } else if (line.startsWith("@@")) {
            textColor = "text-blue-400/50";
            bgColor = "bg-blue-500/[0.03]";
          }
          return (
            <div key={i} className={`px-2.5 ${textColor} ${bgColor}`}>{line || " "}</div>
          );
        })}
      </pre>
    </div>
  );
}
