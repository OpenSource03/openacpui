import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  GitBranch as GitBranchIcon,
  ChevronDown,
  Plus,
  Check,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GitBranch } from "@/types";

function BranchItem({ branch, onSelect }: { branch: GitBranch; onSelect: (name: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(branch.name)}
      className={`flex w-full items-center gap-1.5 px-3 py-1 text-[11px] transition-colors hover:bg-foreground/[0.05] cursor-pointer ${
        branch.isCurrent ? "text-foreground/90" : "text-foreground/65"
      }`}
    >
      {branch.isCurrent ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-600/80 dark:text-emerald-300/80" />
      ) : (
        <GitBranchIcon className="h-3 w-3 shrink-0 text-foreground/25" />
      )}
      <span className="min-w-0 truncate">{branch.name}</span>
      {branch.ahead !== undefined && branch.ahead > 0 && (
        <span className="shrink-0 rounded-full bg-emerald-500/15 px-1 text-[9px] font-semibold text-emerald-600 dark:text-emerald-300">+{branch.ahead}</span>
      )}
      {branch.behind !== undefined && branch.behind > 0 && (
        <span className="shrink-0 rounded-full bg-amber-500/15 px-1 text-[9px] font-semibold text-amber-600 dark:text-amber-300">-{branch.behind}</span>
      )}
    </button>
  );
}

export interface BranchPickerProps {
  currentBranch?: string;
  branches: GitBranch[];
  onCheckout: (branch: string) => void;
  onCreateBranch: (name: string) => Promise<void>;
  /** Override outer wrapper classes (defaults to "px-3 pb-1" for standalone use). */
  className?: string;
}

export function BranchPicker({
  currentBranch,
  branches,
  onCheckout,
  onCreateBranch,
  className,
}: BranchPickerProps) {
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const branchPickerRef = useRef<HTMLDivElement>(null);

  // Close branch picker on click outside
  useEffect(() => {
    if (!showBranchPicker) return;
    const handler = (e: MouseEvent) => {
      if (branchPickerRef.current && !branchPickerRef.current.contains(e.target as Node)) {
        setShowBranchPicker(false);
        setBranchFilter("");
        setShowNewBranch(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showBranchPicker]);

  const handleCheckout = useCallback(
    (branch: string) => {
      setShowBranchPicker(false);
      setBranchFilter("");
      onCheckout(branch);
    },
    [onCheckout],
  );

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return;
    await onCreateBranch(newBranchName.trim());
    setNewBranchName("");
    setShowNewBranch(false);
    setShowBranchPicker(false);
  }, [newBranchName, onCreateBranch]);

  const filteredBranches = useMemo(() => {
    if (!branchFilter) return branches;
    const q = branchFilter.toLowerCase();
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, branchFilter]);

  const localBranches = useMemo(
    () => filteredBranches.filter((b) => !b.isRemote),
    [filteredBranches],
  );
  const remoteBranches = useMemo(
    () => filteredBranches.filter((b) => b.isRemote),
    [filteredBranches],
  );

  return (
    <div className={`relative ${className ?? "px-3 pb-1"}`} ref={branchPickerRef}>
      <button
        type="button"
        onClick={() => setShowBranchPicker(!showBranchPicker)}
        className="flex w-full items-center gap-1.5 rounded-md border border-foreground/[0.08] bg-foreground/[0.03] px-2 py-1 text-[11px] transition-colors hover:border-foreground/[0.12] hover:bg-foreground/[0.05] cursor-pointer"
      >
        <GitBranchIcon className="h-3 w-3 shrink-0 text-foreground/50" />
        <span className="truncate font-medium text-foreground/80">{currentBranch ?? "…"}</span>
        <ChevronDown className={`ms-auto h-3 w-3 shrink-0 text-foreground/35 transition-transform ${showBranchPicker ? "rotate-180" : ""}`} />
      </button>

      {/* Branch dropdown */}
      {showBranchPicker && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-foreground/[0.1] bg-[var(--background)] shadow-xl">
          {/* Search */}
          <div className="sticky top-0 border-b border-foreground/[0.08] bg-[var(--background)] p-1.5">
            <div className="flex items-center gap-1.5 rounded-md bg-foreground/[0.05] px-2">
              <Search className="h-3 w-3 shrink-0 text-foreground/35" />
              <input
                type="text"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                placeholder="Filter branches…"
                className="w-full bg-transparent py-1.5 text-[11px] text-foreground/80 outline-none placeholder:text-foreground/30"
                autoFocus
              />
            </div>
          </div>

          {/* New branch */}
          {showNewBranch ? (
            <div className="flex items-center gap-1.5 border-b border-foreground/[0.08] p-1.5">
              <input
                type="text"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateBranch();
                  if (e.key === "Escape") { setShowNewBranch(false); setNewBranchName(""); }
                }}
                placeholder="New branch name…"
                className="min-w-0 flex-1 rounded-md bg-foreground/[0.05] px-2 py-1.5 text-[11px] text-foreground/80 outline-none placeholder:text-foreground/30"
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-emerald-600/80 dark:text-emerald-300/80 hover:text-emerald-600 dark:hover:text-emerald-300 hover:bg-emerald-500/15"
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim()}
              >
                <Check className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewBranch(true)}
              className="flex w-full items-center gap-1.5 border-b border-foreground/[0.08] px-3 py-1.5 text-[11px] text-foreground/50 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/70 cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              Create new branch
            </button>
          )}

          {/* Branch lists */}
          {localBranches.length > 0 && (
            <div className="py-0.5">
              <div className="px-3 pt-1.5 pb-0.5 text-[9px] font-semibold uppercase tracking-widest text-foreground/35">Local</div>
              {localBranches.map((b) => (
                <BranchItem key={b.name} branch={b} onSelect={handleCheckout} />
              ))}
            </div>
          )}
          {remoteBranches.length > 0 && (
            <div className="border-t border-foreground/[0.06] py-0.5">
              <div className="px-3 pt-1.5 pb-0.5 text-[9px] font-semibold uppercase tracking-widest text-foreground/35">Remote</div>
              {remoteBranches.map((b) => (
                <BranchItem key={b.name} branch={b} onSelect={handleCheckout} />
              ))}
            </div>
          )}

          {filteredBranches.length === 0 && (
            <div className="px-3 py-3 text-center text-[10px] text-foreground/40">No matching branches</div>
          )}
        </div>
      )}
    </div>
  );
}
