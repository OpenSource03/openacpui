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
      className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] transition-colors hover:bg-foreground/[0.05] cursor-pointer ${
        branch.isCurrent ? "text-foreground/80" : "text-foreground/50"
      }`}
    >
      {branch.isCurrent ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-400/60" />
      ) : (
        <GitBranchIcon className="h-3 w-3 shrink-0 text-foreground/15" />
      )}
      <span className="min-w-0 truncate">{branch.name}</span>
      {branch.ahead !== undefined && branch.ahead > 0 && (
        <span className="shrink-0 rounded-full bg-emerald-500/10 px-1 text-[9px] font-medium text-emerald-400/60">+{branch.ahead}</span>
      )}
      {branch.behind !== undefined && branch.behind > 0 && (
        <span className="shrink-0 rounded-full bg-amber-500/10 px-1 text-[9px] font-medium text-amber-400/60">-{branch.behind}</span>
      )}
    </button>
  );
}

export interface BranchPickerProps {
  currentBranch?: string;
  branches: GitBranch[];
  onCheckout: (branch: string) => void;
  onCreateBranch: (name: string) => Promise<void>;
}

export function BranchPicker({
  currentBranch,
  branches,
  onCheckout,
  onCreateBranch,
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
    <div className="relative px-3 pb-1.5" ref={branchPickerRef}>
      <button
        type="button"
        onClick={() => setShowBranchPicker(!showBranchPicker)}
        className="flex w-full items-center gap-1.5 rounded-md border border-foreground/[0.06] bg-foreground/[0.02] px-2.5 py-1.5 text-[11px] transition-colors hover:border-foreground/[0.1] hover:bg-foreground/[0.04] cursor-pointer"
      >
        <GitBranchIcon className="h-3 w-3 shrink-0 text-foreground/35" />
        <span className="truncate font-medium text-foreground/65">{currentBranch ?? "…"}</span>
        <ChevronDown className={`ms-auto h-3 w-3 shrink-0 text-foreground/25 transition-transform ${showBranchPicker ? "rotate-180" : ""}`} />
      </button>

      {/* Branch dropdown */}
      {showBranchPicker && (
        <div className="absolute inset-x-3 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-foreground/[0.08] bg-[var(--background)] shadow-xl">
          {/* Search */}
          <div className="sticky top-0 border-b border-foreground/[0.06] bg-[var(--background)] p-1.5">
            <div className="flex items-center gap-1.5 rounded-md bg-foreground/[0.04] px-2">
              <Search className="h-3 w-3 shrink-0 text-foreground/20" />
              <input
                type="text"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                placeholder="Filter branches…"
                className="w-full bg-transparent py-1.5 text-[11px] text-foreground/70 outline-none placeholder:text-foreground/20"
                autoFocus
              />
            </div>
          </div>

          {/* New branch */}
          {showNewBranch ? (
            <div className="flex items-center gap-1.5 border-b border-foreground/[0.06] p-1.5">
              <input
                type="text"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateBranch();
                  if (e.key === "Escape") { setShowNewBranch(false); setNewBranchName(""); }
                }}
                placeholder="New branch name…"
                className="min-w-0 flex-1 rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[11px] text-foreground/70 outline-none placeholder:text-foreground/20"
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/10"
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
              className="flex w-full items-center gap-1.5 border-b border-foreground/[0.06] px-3 py-2 text-[11px] text-foreground/40 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/60 cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              Create new branch
            </button>
          )}

          {/* Branch lists */}
          {localBranches.length > 0 && (
            <div className="py-0.5">
              <div className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-foreground/20">Local</div>
              {localBranches.map((b) => (
                <BranchItem key={b.name} branch={b} onSelect={handleCheckout} />
              ))}
            </div>
          )}
          {remoteBranches.length > 0 && (
            <div className="border-t border-foreground/[0.04] py-0.5">
              <div className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-foreground/20">Remote</div>
              {remoteBranches.map((b) => (
                <BranchItem key={b.name} branch={b} onSelect={handleCheckout} />
              ))}
            </div>
          )}

          {filteredBranches.length === 0 && (
            <div className="px-3 py-4 text-center text-[10px] text-foreground/25">No matching branches</div>
          )}
        </div>
      )}
    </div>
  );
}
