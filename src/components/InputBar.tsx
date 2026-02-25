import {
  useState,
  useRef,
  useEffect,
  useCallback,
  memo,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  Brain,
  ChevronDown,
  File,
  Folder,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Shield,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ImageAttachment, ContextUsage, AgentDefinition, ACPConfigOption, ModelInfo, AcpPermissionBehavior, EngineId } from "@/types";
import { flattenConfigOptions } from "@/types/acp";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { resolveModelValue } from "@/lib/model-utils";

const ACP_PERMISSION_BEHAVIORS = [
  { id: "ask" as const, label: "Ask", description: "Show permission prompt" },
  { id: "auto_accept" as const, label: "Auto Accept", description: "Auto-approve each tool call" },
  { id: "allow_all" as const, label: "Allow All", description: "Auto-approve with always-allow" },
] as const;

const PERMISSION_MODES = [
  { id: "plan", label: "Plan" },
  { id: "default", label: "Ask Before Edits" },
  { id: "acceptEdits", label: "Accept Edits" },
  { id: "dontAsk", label: "Don't Ask" },
  { id: "bypassPermissions", label: "Allow All" },
] as const;

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function getContextColor(percent: number): string {
  if (percent >= 80) return "text-red-400";
  if (percent >= 60) return "text-amber-400";
  return "text-muted-foreground/60";
}

function getContextStrokeColor(percent: number): string {
  if (percent >= 80) return "stroke-red-400";
  if (percent >= 60) return "stroke-amber-400";
  return "stroke-foreground/40";
}

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type AcceptedMediaType = (typeof ACCEPTED_IMAGE_TYPES)[number];

function readFileAsBase64(file: globalThis.File): Promise<{ data: string; mediaType: AcceptedMediaType }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve({ data: base64, mediaType: file.type as AcceptedMediaType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isAcceptedImage(file: globalThis.File): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type);
}


// Lucide SVG paths for inline chip icons (can't use React components in DOM-created elements)
const FILE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-muted-foreground"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
const FOLDER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-blue-400"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;

interface InputBarProps {
  onSend: (text: string, images?: ImageAttachment[], displayText?: string) => void;
  onStop: () => void;
  isProcessing: boolean;
  model: string;
  thinking: boolean;
  permissionMode: string;
  onModelChange: (model: string) => void;
  onThinkingChange: (thinking: boolean) => void;
  onPermissionModeChange: (mode: string) => void;
  projectPath?: string;
  contextUsage?: ContextUsage | null;
  isCompacting?: boolean;
  onCompact?: () => void;
  agents?: AgentDefinition[];
  selectedAgent?: AgentDefinition | null;
  onAgentChange?: (agent: AgentDefinition | null) => void;
  acpConfigOptions?: ACPConfigOption[];
  onACPConfigChange?: (configId: string, value: string) => void;
  acpPermissionBehavior?: AcpPermissionBehavior;
  onAcpPermissionBehaviorChange?: (behavior: AcpPermissionBehavior) => void;
  supportedModels?: ModelInfo[];
  /** Codex reasoning effort — per-model configurable effort level */
  codexEffort?: string;
  onCodexEffortChange?: (effort: string) => void;
  /** Codex models carry their supported effort levels — passed through for the effort dropdown */
  codexModelData?: Array<{ id: string; supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>; defaultReasoningEffort: string; isDefault?: boolean }>;
  /** Non-null when session is active (not draft) — engine is locked and cross-engine agents show "Opens new chat" */
  lockedEngine?: EngineId | null;
  /** Non-null when an ACP session is active — switching to a different ACP agent opens new chat */
  lockedAgentId?: string | null;
  /** Number of messages currently queued for sending */
  queuedCount?: number;
}

// Simple fuzzy match: all query chars must appear in order
function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t.startsWith(q)) return { match: true, score: 100 + (1 / target.length) };
  if (t.includes(q)) return { match: true, score: 50 + (1 / target.length) };

  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return { match: true, score: 10 + (qi / target.length) };

  return { match: false, score: 0 };
}

/** Insert text at the current cursor position in a contentEditable element */
function insertTextAtCursor(el: HTMLElement | null, text: string): void {
  if (!el) return;
  el.focus();

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    // No cursor — append to end
    el.appendChild(document.createTextNode(text));
  } else {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    // Move cursor after inserted text
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Trigger input handler so hasContent updates and send button enables
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Extract full text + mention paths from a contentEditable element */
function extractEditableContent(el: HTMLElement): { text: string; mentionPaths: string[] } {
  let text = "";
  const mentionPaths: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node instanceof HTMLElement) {
      const mentionPath = node.dataset.mentionPath;
      if (mentionPath) {
        text += `@${mentionPath}`;
        mentionPaths.push(mentionPath);
      } else if (node.tagName === "BR") {
        text += "\n";
      } else {
        for (const child of node.childNodes) walk(child);
      }
    }
  };

  for (const child of el.childNodes) walk(child);
  return { text, mentionPaths: [...new Set(mentionPaths)] };
}

export const InputBar = memo(function InputBar({
  onSend,
  onStop,
  isProcessing,
  model,
  thinking,
  permissionMode,
  onModelChange,
  onThinkingChange,
  onPermissionModeChange,
  projectPath,
  contextUsage,
  isCompacting,
  onCompact,
  agents,
  selectedAgent,
  onAgentChange,
  acpConfigOptions,
  onACPConfigChange,
  acpPermissionBehavior,
  onAcpPermissionBehaviorChange,
  supportedModels,
  codexEffort,
  onCodexEffortChange,
  codexModelData,
  lockedEngine,
  lockedAgentId,
  queuedCount = 0,
}: InputBarProps) {
  const [hasContent, setHasContent] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [fileCache, setFileCache] = useState<{ files: string[]; dirs: string[] } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // ── Voice dictation ──
  const speech = useSpeechRecognition({
    onResult: (text) => insertTextAtCursor(editableRef.current, text),
  });

  const editableRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const mentionStartNode = useRef<Node | null>(null);
  const mentionStartOffset = useRef<number>(0);
  const fileCachePathRef = useRef<string | undefined>(undefined);

  const modelList = supportedModels?.length
    ? supportedModels.map((m) => ({ id: m.value, label: m.displayName, description: m.description }))
    : [];
  const modelsLoading = modelList.length === 0;
  const resolvedModelId = resolveModelValue(model, supportedModels ?? []);
  const preferredModelId = resolvedModelId ?? model;
  const selectedModel = modelList.find((m) => m.id === preferredModelId) ?? modelList[0];
  const selectedModelId = selectedModel?.id ?? preferredModelId;
  const selectedMode =
    PERMISSION_MODES.find((m) => m.id === permissionMode) ?? PERMISSION_MODES[0];
  const isACPAgent = selectedAgent != null && selectedAgent.engine === "acp";
  const isCodexAgent = selectedAgent != null && selectedAgent.engine === "codex";

  // Codex: find the effort options for the currently selected model
  const codexCurrentModel = codexModelData?.find((m) => m.id === selectedModelId)
    ?? codexModelData?.find((m) => m.isDefault)
    ?? codexModelData?.[0];
  const codexEffortOptions = codexCurrentModel?.supportedReasoningEfforts ?? [];
  const codexActiveEffort = codexEffortOptions.some((opt) => opt.reasoningEffort === codexEffort)
    ? codexEffort
    : codexCurrentModel?.defaultReasoningEffort ?? codexEffort ?? "medium";

  // Fetch file list when projectPath changes
  useEffect(() => {
    if (!projectPath || fileCachePathRef.current === projectPath) return;
    fileCachePathRef.current = projectPath;
    window.claude.files.list(projectPath).then((result) => {
      setFileCache(result);
    });
  }, [projectPath]);

  // Filtered mention results
  const mentionResults = useCallback(() => {
    if (!fileCache) return [];
    const q = mentionQuery;
    const allEntries = [
      ...fileCache.dirs.map((d) => ({ path: d, isDir: true })),
      ...fileCache.files.map((f) => ({ path: f, isDir: false })),
    ];

    // Filter out paths already mentioned as chips
    const mentionedPaths = new Set<string>();
    if (editableRef.current) {
      editableRef.current.querySelectorAll("[data-mention-path]").forEach((el) => {
        const p = el.getAttribute("data-mention-path");
        if (p) mentionedPaths.add(p);
      });
    }
    const available = allEntries.filter((e) => !mentionedPaths.has(e.path));

    if (!q) {
      return available
        .sort((a, b) => {
          const aDepth = a.path.split("/").length;
          const bDepth = b.path.split("/").length;
          if (aDepth !== bDepth) return aDepth - bDepth;
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.path.localeCompare(b.path);
        })
        .slice(0, 12);
    }

    return available
      .map((entry) => {
        const { match, score } = fuzzyMatch(q, entry.path);
        return { ...entry, match, score };
      })
      .filter((e) => e.match)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [fileCache, mentionQuery]);

  const results = showMentions ? mentionResults() : [];

  // Clamp mention index
  useEffect(() => {
    if (mentionIndex >= results.length) {
      setMentionIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, mentionIndex]);

  // Scroll active mention into view
  useEffect(() => {
    if (!mentionListRef.current) return;
    const active = mentionListRef.current.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [mentionIndex]);

  const closeMentions = useCallback(() => {
    setShowMentions(false);
    setMentionQuery("");
    setMentionIndex(0);
    mentionStartNode.current = null;
    mentionStartOffset.current = 0;
  }, []);

  const addImageFiles = useCallback(async (files: FileList | globalThis.File[]) => {
    const validFiles = Array.from(files).filter(isAcceptedImage);
    if (validFiles.length === 0) return;

    const newAttachments: ImageAttachment[] = [];
    for (const file of validFiles) {
      const { data, mediaType } = await readFileAsBase64(file);
      newAttachments.push({
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        data,
        mediaType,
        fileName: file.name,
      });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const selectMention = useCallback(
    (entry: { path: string; isDir: boolean }) => {
      const el = editableRef.current;
      const node = mentionStartNode.current;
      const sel = window.getSelection();
      if (!el || !node || !sel || !sel.rangeCount) {
        closeMentions();
        return;
      }

      // Delete the @query text (from @ to current cursor position)
      const range = document.createRange();
      range.setStart(node, mentionStartOffset.current);
      const curRange = sel.getRangeAt(0);
      range.setEnd(curRange.startContainer, curRange.startOffset);
      range.deleteContents();

      // Create chip element
      const chip = document.createElement("span");
      chip.contentEditable = "false";
      chip.className =
        "mention-chip inline-flex items-center gap-1 rounded-md bg-accent/60 px-1.5 py-0.5 text-xs text-accent-foreground font-mono align-baseline cursor-default select-none";
      chip.setAttribute("data-mention-path", entry.path);
      chip.setAttribute("data-mention-dir", String(entry.isDir));
      chip.innerHTML = `${entry.isDir ? FOLDER_ICON_SVG : FILE_ICON_SVG}<span>${entry.path}</span>`;

      // Insert chip at cursor
      range.insertNode(chip);

      // Add space after chip so cursor has somewhere to go
      const space = document.createTextNode(" ");
      chip.after(space);

      // Move cursor after the space
      const newRange = document.createRange();
      newRange.setStartAfter(space);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);

      setHasContent(true);
      closeMentions();
    },
    [closeMentions],
  );

  const handleSend = useCallback(async () => {
    const el = editableRef.current;
    if (!el) return;

    const { text: fullText, mentionPaths } = extractEditableContent(el);
    const trimmed = fullText.trim();
    if ((!trimmed && attachments.length === 0) || isSending) return;

    const currentImages = attachments.length > 0 ? [...attachments] : undefined;

    if (mentionPaths.length > 0 && projectPath) {
      setIsSending(true);
      try {
        const fileResults = await window.claude.files.readMultiple(projectPath, mentionPaths);

        const contextParts: string[] = [];
        for (const result of fileResults) {
          if (result.error) {
            contextParts.push(`<file path="${result.path}">\n[Error: ${result.error}]\n</file>`);
          } else if (result.isDir && result.tree) {
            contextParts.push(`<folder path="${result.path}">\n${result.tree}\n</folder>`);
          } else if (!result.isDir && result.content !== undefined) {
            contextParts.push(`<file path="${result.path}">\n${result.content}\n</file>`);
          }
        }

        const contextBlock = contextParts.join("\n\n");
        const fullMessage = contextBlock ? `${contextBlock}\n\n${trimmed}` : trimmed;
        // Pass trimmed (@path text) as displayText so MessageBubble doesn't need regex stripping
        onSend(fullMessage, currentImages, trimmed);
      } finally {
        setIsSending(false);
      }
    } else {
      onSend(trimmed, currentImages);
    }

    // Clear input
    el.innerHTML = "";
    setHasContent(false);
    setAttachments([]);
    closeMentions();
  }, [attachments, isSending, projectPath, onSend, closeMentions]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (showMentions && results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % results.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + results.length) % results.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(results[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMentions();
        return;
      }
    }

    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      document.execCommand("insertLineBreak");
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSending) {
        handleSend();
      }
    }
  };

  // Detect @ trigger on contentEditable input
  const handleEditableInput = useCallback(() => {
    const el = editableRef.current;
    if (!el) return;

    // Update hasContent for placeholder & send button
    const hasText =
      (el.textContent?.trim().length ?? 0) > 0 ||
      el.querySelector("[data-mention-path]") !== null;
    setHasContent(hasText);

    // Detect @ trigger
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      if (showMentions) closeMentions();
      return;
    }

    const range = sel.getRangeAt(0);
    const node = range.startContainer;

    if (node.nodeType !== Node.TEXT_NODE) {
      if (showMentions) closeMentions();
      return;
    }

    const textBefore = (node.textContent ?? "").slice(0, range.startOffset);
    const atMatch = textBefore.match(/(^|[\s])@([^\s]*)$/);

    if (atMatch && projectPath) {
      mentionStartNode.current = node;
      mentionStartOffset.current = textBefore.lastIndexOf("@");
      setMentionQuery(atMatch[2]);
      setShowMentions(true);
      setMentionIndex(0);
    } else {
      if (showMentions) closeMentions();
    }
  }, [showMentions, closeMentions, projectPath]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (items) {
        const imageFiles: globalThis.File[] = [];
        for (const item of items) {
          if (item.kind === "file" && isAcceptedImage(item.getAsFile()!)) {
            imageFiles.push(item.getAsFile()!);
          }
        }
        if (imageFiles.length > 0) {
          e.preventDefault();
          addImageFiles(imageFiles);
          return;
        }
      }

      // Paste as plain text only (strip HTML formatting)
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, text);
      setHasContent(true);
    },
    [addImageFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer?.files) {
        addImageFiles(e.dataTransfer.files);
      }
    },
    [addImageFiles],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        addImageFiles(e.target.files);
      }
      e.target.value = "";
    },
    [addImageFiles],
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <div
        className={`pointer-events-auto rounded-2xl border bg-background/55 shadow-lg backdrop-blur-lg transition-colors focus-within:border-border ${
          isDragging
            ? "border-primary/60 bg-primary/5"
            : speech.isListening
              ? "border-red-400/40 ring-1 ring-red-400/20"
              : "border-border/60"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Mention popup */}
        {showMentions && results.length > 0 && (
          <div
            ref={mentionListRef}
            className="mx-2 mb-1 mt-2 max-h-64 overflow-y-auto rounded-lg border border-border/60 bg-popover shadow-lg"
          >
            {results.map((entry, i) => (
              <button
                key={entry.path}
                data-active={i === mentionIndex}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm transition-colors ${
                  i === mentionIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-muted/40"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(entry);
                }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                {entry.isDir ? (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                ) : (
                  <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate font-mono text-xs">{entry.path}</span>
              </button>
            ))}
          </div>
        )}

        {/* Input area — contentEditable with inline chip support */}
        <div
          className="relative px-4 pt-3.5 pb-2"
          onClick={() => editableRef.current?.focus()}
        >
          {/* Placeholder (shown when input is empty) */}
          {!hasContent && (
            <div className="pointer-events-none absolute inset-0 flex items-start px-4 pt-3.5 pb-2 text-sm text-muted-foreground/50">
              {isCompacting
                ? "Compacting context..."
                : isProcessing
                  ? `${selectedAgent?.name ?? "Claude"} is responding... (messages will be queued)`
                  : "Ask anything, @ to tag files"}
            </div>
          )}
          <div
            ref={editableRef}
            contentEditable
            onInput={handleEditableInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="min-h-[1.5em] max-h-[200px] overflow-y-auto text-sm text-foreground outline-none whitespace-pre-wrap wrap-break-word"
            role="textbox"
            aria-multiline="true"
            suppressContentEditableWarning
          />
        </div>

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="group/att relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/40"
              >
                <img
                  src={`data:${att.mediaType};base64,${att.data}`}
                  alt={att.fileName ?? "attachment"}
                  className="h-full w-full object-cover"
                />
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="absolute -end-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover/att:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 px-3 pb-2.5">
          {/* Left controls — scrollable as a defensive fallback (should never trigger with proper MIN_CHAT_WIDTH) */}
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex shrink-0 items-center justify-center rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              title="Attach image"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>

            {/* Voice dictation button */}
            {speech.isAvailable ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={speech.toggle}
                    disabled={speech.isModelLoading || speech.isTranscribing}
                    className={`flex shrink-0 items-center justify-center rounded-lg px-2 py-1 transition-colors ${
                      speech.isListening
                        ? "text-red-400 bg-red-500/10 recording-pulse"
                        : speech.isTranscribing
                          ? "text-amber-400"
                          : speech.isModelLoading
                            ? "text-muted-foreground/40 cursor-wait"
                            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    }`}
                  >
                    {speech.isListening ? (
                      <MicOff className="h-3.5 w-3.5" />
                    ) : speech.isModelLoading || speech.isTranscribing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Mic className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {speech.error
                    ? speech.error
                    : speech.isModelLoading
                      ? `Loading speech model… ${speech.loadProgress.toFixed(0)}%`
                      : speech.isTranscribing
                        ? "Transcribing…"
                        : speech.isListening
                          ? "Stop dictation"
                          : "Voice dictation"}
                </TooltipContent>
              </Tooltip>
            ) : speech.nativeHint ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="flex shrink-0 items-center justify-center rounded-lg px-2 py-1 text-muted-foreground/40 cursor-default"
                  >
                    <Mic className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{speech.nativeHint}</TooltipContent>
              </Tooltip>
            ) : null}

            {agents && agents.length > 1 && onAgentChange && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    disabled={isProcessing}
                  >
                    {selectedAgent?.name ?? "Claude Code"}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(() => {
                    // An agent "will open new chat" if engine differs OR same ACP engine but different agent
                    const willOpenNewChat = (agent: AgentDefinition) => {
                      if (lockedEngine == null) return false;
                      if (agent.engine !== lockedEngine) return true;
                      if (lockedEngine === "acp" && lockedAgentId && agent.id !== lockedAgentId) return true;
                      return false;
                    };
                    const sameEngine = agents.filter((a) => !willOpenNewChat(a));
                    const crossEngine = agents.filter((a) => willOpenNewChat(a));

                    const renderItem = (agent: AgentDefinition, crossEngine: boolean) => (
                      <DropdownMenuItem
                        key={agent.id}
                        onClick={() => onAgentChange(agent.engine === "claude" ? null : agent)}
                        className={
                          (selectedAgent?.id ?? "claude-code") === agent.id ? "bg-accent" : ""
                        }
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            {agent.name}
                            {agent.engine === "acp" && (
                              <span className="text-[10px] text-muted-foreground">ACP</span>
                            )}
                          </div>
                          {crossEngine && (
                            <div className="text-[10px] text-muted-foreground/70">
                              Opens new chat
                            </div>
                          )}
                        </div>
                      </DropdownMenuItem>
                    );

                    return (
                      <>
                        {sameEngine.map((a) => renderItem(a, false))}
                        {crossEngine.length > 0 && sameEngine.length > 0 && (
                          <DropdownMenuSeparator />
                        )}
                        {crossEngine.map((a) => renderItem(a, true))}
                      </>
                    );
                  })()}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {isCodexAgent ? (
              /* Codex controls — model, effort, permission mode */
              <>
                {modelsLoading ? (
                  <div className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading models…
                  </div>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                        disabled={isProcessing}
                      >
                        {selectedModel?.label}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {modelList.map((m) => (
                        <DropdownMenuItem
                          key={m.id}
                          onClick={() => onModelChange(m.id)}
                          className={m.id === selectedModelId ? "bg-accent" : ""}
                        >
                          <div>
                            <div>{m.label}</div>
                            {m.description && (
                              <div className="text-[10px] text-muted-foreground">{m.description}</div>
                            )}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Codex reasoning effort dropdown */}
                {codexEffortOptions.length > 0 && onCodexEffortChange && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                        disabled={isProcessing}
                      >
                        <Brain className="h-3 w-3" />
                        {codexActiveEffort}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {codexEffortOptions.map((opt) => (
                        <DropdownMenuItem
                          key={opt.reasoningEffort}
                          onClick={() => onCodexEffortChange(opt.reasoningEffort)}
                          className={opt.reasoningEffort === codexActiveEffort ? "bg-accent" : ""}
                        >
                          <div>
                            <div className="capitalize">{opt.reasoningEffort}</div>
                            {opt.description && (
                              <div className="text-[10px] text-muted-foreground">{opt.description}</div>
                            )}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Codex permission mode — reuse Claude's dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                    >
                      <Shield className="h-3 w-3" />
                      {selectedMode.label}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {PERMISSION_MODES.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => onPermissionModeChange(m.id)}
                        className={m.id === permissionMode ? "bg-accent" : ""}
                      >
                        {m.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : isACPAgent ? (
              /* ACP agent controls — permission behavior + dynamic config dropdowns */
              <>
                {/* ACP permission behavior dropdown */}
                {onAcpPermissionBehaviorChange && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                        disabled={isProcessing}
                      >
                        <Shield className="h-3 w-3" />
                        {ACP_PERMISSION_BEHAVIORS.find(b => b.id === acpPermissionBehavior)?.label ?? "Ask"}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {ACP_PERMISSION_BEHAVIORS.map((b) => (
                        <DropdownMenuItem
                          key={b.id}
                          onClick={() => onAcpPermissionBehaviorChange(b.id)}
                          className={b.id === acpPermissionBehavior ? "bg-accent" : ""}
                        >
                          <div>
                            <div>{b.label}</div>
                            <div className="text-[10px] text-muted-foreground">{b.description}</div>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* Agent-provided config dropdowns */}
                {acpConfigOptions && acpConfigOptions.length > 0 && onACPConfigChange &&
                  acpConfigOptions.map((opt) => {
                    const flat = flattenConfigOptions(opt.options);
                    const current = flat.find((o) => o.value === opt.currentValue);
                    return (
                      <DropdownMenu key={opt.id}>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                            disabled={isProcessing}
                          >
                            {current?.name ?? opt.currentValue}
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {flat.map((o) => (
                            <DropdownMenuItem
                              key={o.value}
                              onClick={() => onACPConfigChange(opt.id, o.value)}
                              className={o.value === opt.currentValue ? "bg-accent" : ""}
                            >
                              <div>
                                <div>{o.name}</div>
                                {o.description && (
                                  <div className="text-[10px] text-muted-foreground">{o.description}</div>
                                )}
                              </div>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    );
                  })
                }
              </>
            ) : (
              /* Claude SDK controls — model, permission mode, thinking */
              <>
                {modelsLoading ? (
                  <div className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading models…
                  </div>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                        disabled={isProcessing}
                      >
                        {selectedModel?.label}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {modelList.map((m) => (
                        <DropdownMenuItem
                          key={m.id}
                          onClick={() => onModelChange(m.id)}
                          className={m.id === selectedModelId ? "bg-accent" : ""}
                        >
                          <div>
                            <div>{m.label}</div>
                            {m.description && (
                              <div className="text-[10px] text-muted-foreground">{m.description}</div>
                            )}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                    >
                      <Shield className="h-3 w-3" />
                      {selectedMode.label}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {PERMISSION_MODES.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => onPermissionModeChange(m.id)}
                        className={m.id === permissionMode ? "bg-accent" : ""}
                      >
                        {m.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <button
                  onClick={() => onThinkingChange(!thinking)}
                  disabled={isProcessing}
                  className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    thinking
                      ? "text-foreground bg-muted/40"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  }`}
                >
                  <Brain className="h-3 w-3" />
                  Reasoning
                </button>
              </>
            )}
          </div>

          {/* Right controls — always visible, never shrink */}
          <div className="flex shrink-0 items-center gap-1.5">
            {contextUsage && (() => {
              const totalInput = contextUsage.inputTokens + contextUsage.cacheReadTokens + contextUsage.cacheCreationTokens;
              const percent = Math.min(100, (totalInput / contextUsage.contextWindow) * 100);
              const radius = 7;
              const circumference = 2 * Math.PI * radius;
              const dashOffset = circumference - (percent / 100) * circumference;
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => { if (!isProcessing) onCompact?.(); }}
                      className={`flex items-center justify-center rounded-full p-0.5 transition-colors hover:bg-muted/40 ${isProcessing ? "opacity-40 cursor-default" : ""} ${getContextColor(percent)}`}
                    >
                      <svg width="20" height="20" viewBox="0 0 20 20" className={isCompacting ? "animate-spin" : "-rotate-90"}>
                        <circle
                          cx="10" cy="10" r={radius}
                          fill="none"
                          className="stroke-muted/30"
                          strokeWidth="2.5"
                        />
                        <circle
                          cx="10" cy="10" r={radius}
                          fill="none"
                          className={isCompacting ? "stroke-foreground/60" : getContextStrokeColor(percent)}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeDasharray={circumference}
                          strokeDashoffset={isCompacting ? circumference * 0.7 : dashOffset}
                        />
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-64">
                    <div className="space-y-1.5 text-xs">
                      <div className="font-medium">{isCompacting ? "Compacting..." : `Context: ${percent.toFixed(1)}%`}</div>
                      <div className="space-y-0.5 opacity-70">
                        <div className="flex justify-between gap-4">
                          <span>Input tokens</span>
                          <span className="font-mono">{formatTokenCount(contextUsage.inputTokens)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span>Cache read</span>
                          <span className="font-mono">{formatTokenCount(contextUsage.cacheReadTokens)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span>Cache creation</span>
                          <span className="font-mono">{formatTokenCount(contextUsage.cacheCreationTokens)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span>Output tokens</span>
                          <span className="font-mono">{formatTokenCount(contextUsage.outputTokens)}</span>
                        </div>
                      </div>
                      <div className="flex justify-between gap-4 border-t border-background/20 pt-1">
                        <span>Total / Window</span>
                        <span className="font-mono">{formatTokenCount(totalInput)} / {formatTokenCount(contextUsage.contextWindow)}</span>
                      </div>
                      <div className="border-t border-background/20 pt-1.5 opacity-50">
                        Click to compact context
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })()}
            {isProcessing && (
              <Button
                size="icon"
                variant="ghost"
                onClick={onStop}
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-destructive"
              >
                <Square className="h-3 w-3" />
              </Button>
            )}
            <div className="relative">
              <Button
                size="icon"
                onClick={handleSend}
                disabled={(!hasContent && attachments.length === 0) || isSending}
                className="h-8 w-8 rounded-full"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              {queuedCount > 0 && (
                <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                  {queuedCount}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
