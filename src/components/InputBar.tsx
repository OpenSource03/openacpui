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
  Crosshair,
  File,
  Folder,
  Loader2,
  Map,
  Mic,
  MicOff,
  Paperclip,
  Pencil,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ImageAttachment, GrabbedElement, CodeSnippet, ContextUsage, InstalledAgent, ACPConfigOption, ModelInfo, AcpPermissionBehavior, ClaudeEffort, EngineId, SlashCommand } from "@/types";
import { flattenConfigOptions } from "@/lib/acp-utils";
import { BOTTOM_CHAT_MAX_WIDTH_CLASS } from "@/lib/layout-constants";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { resolveModelValue } from "@/lib/model-utils";
import { isMac } from "@/lib/utils";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { AgentIcon } from "@/components/AgentIcon";
import { ImageAnnotationEditor } from "@/components/ImageAnnotationEditor";
import { ENGINE_ICONS, getAgentIcon } from "@/lib/engine-icons";
import { getLanguageFromPath } from "@/lib/languages";

const ACP_PERMISSION_BEHAVIORS = [
  { id: "ask" as const, label: "Ask", description: "Show permission prompt" },
  { id: "auto_accept" as const, label: "Auto Accept", description: "Auto-approve each tool call" },
  { id: "allow_all" as const, label: "Allow All", description: "Auto-approve with always-allow" },
] as const;

const PERMISSION_MODES = [
  { id: "default", label: "Ask Before Edits" },
  { id: "acceptEdits", label: "Accept Edits" },
  { id: "bypassPermissions", label: "Allow All" },
] as const;

const CODEX_PERMISSION_MODE_DETAILS: Record<
  (typeof PERMISSION_MODES)[number]["id"],
  { policy: string; description: string }
> = {
  default: {
    policy: "on-request",
    description: "Prompt before commands and file edits",
  },
  acceptEdits: {
    policy: "untrusted",
    description: "Auto-approve trusted edits; prompt for untrusted actions",
  },
  bypassPermissions: {
    policy: "never",
    description: "No approval prompts",
  },
};

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function getContextColor(percent: number): string {
  if (percent >= 80) return "text-red-600 dark:text-red-400";
  if (percent >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground/60";
}

function getContextStrokeColor(percent: number): string {
  if (percent >= 80) return "stroke-red-600 dark:stroke-red-400";
  if (percent >= 60) return "stroke-amber-600 dark:stroke-amber-400";
  return "stroke-foreground/40";
}


function ModelDropdown({
  modelList,
  selectedModel,
  selectedModelId,
  isProcessing,
  onModelChange,
  onModelEffortChange,
  effortOptionsByModel,
  activeEffort,
  modelsLoading,
  modelsLoadingText,
}: {
  modelList: Array<{ id: string; label: string; description?: string }>;
  selectedModel: { id: string; label: string; description?: string } | undefined;
  selectedModelId: string;
  isProcessing: boolean;
  onModelChange: (id: string) => void;
  onModelEffortChange?: (id: string, effort: ClaudeEffort) => void;
  effortOptionsByModel?: Partial<Record<string, ClaudeEffort[]>>;
  activeEffort?: ClaudeEffort;
  modelsLoading: boolean;
  modelsLoadingText: string;
}) {
  if (modelsLoading) {
    return (
      <div className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {modelsLoadingText}
      </div>
    );
  }
  const selectedEffort = activeEffort && (effortOptionsByModel?.[selectedModelId]?.includes(activeEffort) ?? false)
    ? activeEffort
    : undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={isProcessing}
        >
          {selectedModel?.label}
          {selectedEffort && (
            <span className="text-muted-foreground/70">
              · {selectedEffort}
            </span>
          )}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {modelList.map((m) => {
          const effortOptions = effortOptionsByModel?.[m.id] ?? [];
          if (effortOptions.length > 0 && onModelEffortChange) {
            const isSelected = m.id === selectedModelId;
            return (
              <DropdownMenuSub key={m.id}>
                <DropdownMenuSubTrigger className={isSelected ? "bg-accent" : ""}>
                  <div>
                    <div>{m.label}</div>
                    {m.description && (
                      <div className="text-[10px] text-muted-foreground">{m.description}</div>
                    )}
                  </div>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {effortOptions.map((effort) => {
                    const isActive = isSelected && effort === activeEffort;
                    return (
                      <DropdownMenuItem
                        key={`${m.id}-${effort}`}
                        onClick={() => onModelEffortChange(m.id, effort)}
                        className={isActive ? "bg-accent" : ""}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="capitalize">{effort}</span>
                            {isActive && <span className="text-[10px] text-muted-foreground">Current</span>}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{CLAUDE_EFFORT_DESCRIPTIONS[effort]}</div>
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          }

          return (
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
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PermissionDropdown({
  permissionMode,
  onPermissionModeChange,
  showDetails,
}: {
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  showDetails?: boolean;
}) {
  const selectedMode =
    PERMISSION_MODES.find((m) => m.id === permissionMode) ?? PERMISSION_MODES[0];
  return (
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
        {PERMISSION_MODES.map((m) => {
          const details = showDetails ? CODEX_PERMISSION_MODE_DETAILS[m.id] : undefined;
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onPermissionModeChange(m.id)}
              className={m.id === permissionMode ? "bg-accent" : ""}
            >
              {details ? (
                <div className="flex min-w-0 flex-col">
                  <span>{m.label}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="font-mono text-foreground/80">{details.policy}</span>
                    <span aria-hidden="true">·</span>
                    <span>{details.description}</span>
                  </span>
                </div>
              ) : (
                m.label
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlanModeToggle({
  planMode,
  onPlanModeChange,
}: {
  planMode: boolean;
  onPlanModeChange: (enabled: boolean) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => onPlanModeChange(!planMode)}
          className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${
            planMode
              ? "text-blue-400 bg-blue-500/10"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          <Map className="h-3 w-3" />
          Plan
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">
          {planMode ? "Plan mode on" : "Plan mode off"} ({isMac ? "⌘" : "Ctrl"}+⇧+P)
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function EngineControls({
  isCodexAgent,
  isACPAgent,
  isOpenClawAgent,
  isProcessing,
  showACPConfigOptions,
  modelList,
  selectedModel,
  selectedModelId,
  onModelChange,
  onClaudeModelEffortChange,
  claudeEffortOptionsByModel,
  claudeActiveEffort,
  modelsLoading,
  modelsLoadingText,
  permissionMode,
  onPermissionModeChange,
  planMode,
  onPlanModeChange,
  codexEffortOptions,
  codexActiveEffort,
  onCodexEffortChange,
  acpPermissionBehavior,
  onAcpPermissionBehaviorChange,
  acpConfigOptions,
  acpConfigOptionsLoading,
  onACPConfigChange,
}: {
  isCodexAgent: boolean;
  isACPAgent: boolean;
  isOpenClawAgent: boolean;
  isProcessing: boolean;
  showACPConfigOptions: boolean;
  modelList: Array<{ id: string; label: string; description?: string }>;
  selectedModel: { id: string; label: string; description?: string } | undefined;
  selectedModelId: string;
  onModelChange: (id: string) => void;
  onClaudeModelEffortChange?: (model: string, effort: ClaudeEffort) => void;
  claudeEffortOptionsByModel: Partial<Record<string, ClaudeEffort[]>>;
  claudeActiveEffort: ClaudeEffort;
  modelsLoading: boolean;
  modelsLoadingText: string;
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  planMode: boolean;
  onPlanModeChange: (enabled: boolean) => void;
  codexEffortOptions: Array<{ reasoningEffort: string; description: string }>;
  codexActiveEffort?: string;
  onCodexEffortChange?: (effort: string) => void;
  acpPermissionBehavior?: AcpPermissionBehavior;
  onAcpPermissionBehaviorChange?: (behavior: AcpPermissionBehavior) => void;
  acpConfigOptions?: ACPConfigOption[];
  acpConfigOptionsLoading?: boolean;
  onACPConfigChange?: (configId: string, value: string) => void;
}) {
  if (isCodexAgent) {
    return (
      <>
        <ModelDropdown
          modelList={modelList}
          selectedModel={selectedModel}
          selectedModelId={selectedModelId}
          isProcessing={isProcessing}
          onModelChange={onModelChange}
          modelsLoading={modelsLoading}
          modelsLoadingText={modelsLoadingText}
        />
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
        <PlanModeToggle planMode={planMode} onPlanModeChange={onPlanModeChange} />
        <PermissionDropdown permissionMode={permissionMode} onPermissionModeChange={onPermissionModeChange} showDetails />
      </>
    );
  }

  if (isOpenClawAgent) {
    return (
      <>
        <PermissionDropdown permissionMode={permissionMode} onPermissionModeChange={onPermissionModeChange} />
      </>
    );
  }

  if (isACPAgent) {
    return (
      <>
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
        {showACPConfigOptions && acpConfigOptions && acpConfigOptions.length > 0 && onACPConfigChange &&
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
        {acpConfigOptionsLoading && !showACPConfigOptions && (
          <div className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading options...
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <ModelDropdown
        modelList={modelList}
        selectedModel={selectedModel}
        selectedModelId={selectedModelId}
        isProcessing={isProcessing}
        onModelChange={onModelChange}
        onModelEffortChange={onClaudeModelEffortChange}
        effortOptionsByModel={claudeEffortOptionsByModel}
        activeEffort={claudeActiveEffort}
        modelsLoading={modelsLoading}
        modelsLoadingText={modelsLoadingText}
      />
      <PlanModeToggle planMode={planMode} onPlanModeChange={onPlanModeChange} />
      <PermissionDropdown permissionMode={permissionMode} onPermissionModeChange={onPermissionModeChange} />
    </>
  );
}

const CLAUDE_EFFORT_DESCRIPTIONS: Record<ClaudeEffort, string> = {
  low: "Minimal thinking, fastest responses",
  medium: "Moderate thinking",
  high: "Deep reasoning",
  max: "Maximum effort",
};

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


const FILE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-muted-foreground"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
const FOLDER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-blue-400"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;

function CodeSnippetCard({ snippet, onRemove }: { snippet: CodeSnippet; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const fileName = snippet.filePath.split("/").pop() ?? snippet.filePath;
  const range = snippet.lineStart === snippet.lineEnd ? `L${snippet.lineStart}` : `L${snippet.lineStart}-${snippet.lineEnd}`;

  return (
    <div className="group/snippet relative overflow-hidden rounded-lg border border-foreground/10 bg-foreground/[0.03]">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-start transition-colors hover:bg-foreground/[0.04] cursor-pointer"
      >
        <File className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
        <span className="text-[11px] font-medium text-foreground/80">{fileName}</span>
        <span className="text-[10px] font-mono text-foreground/40">{range}</span>
        <ChevronDown className={`ms-auto h-3 w-3 shrink-0 text-foreground/30 transition-transform ${expanded ? "" : "-rotate-90"}`} />
      </button>
      {expanded && (
        <div className="max-h-48 overflow-auto border-t border-foreground/[0.06] text-xs">
          <SyntaxHighlighter
            language={getLanguageFromPath(snippet.filePath) ?? "text"}
            style={oneDark}
            customStyle={{ margin: 0, padding: "8px 12px", background: "transparent", fontSize: "11px" }}
            showLineNumbers
            startingLineNumber={snippet.lineStart}
          >
            {snippet.code}
          </SyntaxHighlighter>
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover/snippet:opacity-100"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

interface InputBarProps {
  onSend: (text: string, images?: ImageAttachment[], displayText?: string, codeSnippets?: CodeSnippet[]) => void;
  onStop: () => void;
  isProcessing: boolean;
  model: string;
  claudeEffort: ClaudeEffort;
  planMode: boolean;
  permissionMode: string;
  onModelChange: (model: string) => void;
  onClaudeModelEffortChange: (model: string, effort: ClaudeEffort) => void;
  onPlanModeChange: (enabled: boolean) => void;
  onPermissionModeChange: (mode: string) => void;
  projectPath?: string;
  contextUsage?: ContextUsage | null;
  isCompacting?: boolean;
  onCompact?: () => void;
  agents?: InstalledAgent[];
  selectedAgent?: InstalledAgent | null;
  onAgentChange?: (agent: InstalledAgent | null) => void;
  slashCommands?: SlashCommand[];
  acpConfigOptions?: ACPConfigOption[];
  acpConfigOptionsLoading?: boolean;
  onACPConfigChange?: (configId: string, value: string) => void;
  acpPermissionBehavior?: AcpPermissionBehavior;
  onAcpPermissionBehaviorChange?: (behavior: AcpPermissionBehavior) => void;
  supportedModels?: ModelInfo[];
  codexModelsLoadingMessage?: string | null;
  codexEffort?: string;
  onCodexEffortChange?: (effort: string) => void;
  codexModelData?: Array<{ id: string; supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>; defaultReasoningEffort: string; isDefault?: boolean }>;
  lockedEngine?: EngineId | null;
  lockedAgentId?: string | null;
  queuedCount?: number;
  grabbedElements?: GrabbedElement[];
  onRemoveGrabbedElement?: (id: string) => void;
  codeSnippets?: CodeSnippet[];
  onRemoveCodeSnippet?: (id: string) => void;
  isIslandLayout?: boolean;
}

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

function insertTextAtCursor(el: HTMLElement | null, text: string): void {
  if (!el) return;
  el.focus();

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    el.appendChild(document.createTextNode(text));
  } else {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function hasMeaningfulText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      code !== 32 &&
      code !== 9 &&
      code !== 10 &&
      code !== 13 &&
      code !== 11 &&
      code !== 12 &&
      code !== 160
    ) {
      return true;
    }
  }
  return false;
}

function extractEditableContent(el: HTMLElement): { text: string; mentionPaths: string[] } {
  let text = "";
  const mentionPaths: string[] = [];
  const BLOCK_TAGS = new Set([
    "DIV",
    "P",
    "LI",
    "PRE",
    "BLOCKQUOTE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
  ]);

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
        if (BLOCK_TAGS.has(node.tagName) && !text.endsWith("\n")) {
          text += "\n";
        }
      }
    }
  };

  for (const child of el.childNodes) walk(child);
  return {
    text: text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " "),
    mentionPaths: [...new Set(mentionPaths)],
  };
}

export const InputBar = memo(function InputBar({
  onSend,
  onStop,
  isProcessing,
  model,
  claudeEffort,
  planMode,
  permissionMode,
  onModelChange,
  onClaudeModelEffortChange,
  onPlanModeChange,
  onPermissionModeChange,
  projectPath,
  contextUsage,
  isCompacting,
  onCompact,
  agents,
  selectedAgent,
  onAgentChange,
  slashCommands,
  acpConfigOptions,
  acpConfigOptionsLoading,
  onACPConfigChange,
  acpPermissionBehavior,
  onAcpPermissionBehaviorChange,
  supportedModels,
  codexModelsLoadingMessage,
  codexEffort,
  onCodexEffortChange,
  codexModelData,
  lockedEngine,
  lockedAgentId,
  queuedCount = 0,
  grabbedElements,
  onRemoveGrabbedElement,
  codeSnippets,
  onRemoveCodeSnippet,
}: InputBarProps) {
  const [hasContent, setHasContent] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);

  const [showCommands, setShowCommands] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const commandListRef = useRef<HTMLDivElement>(null);
  const [fileCache, setFileCache] = useState<{ files: string[]; dirs: string[] } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [editingAttachment, setEditingAttachment] = useState<ImageAttachment | null>(null);

  const speech = useSpeechRecognition({
    onResult: (text) => insertTextAtCursor(editableRef.current, text),
  });

  const editableRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const mentionStartNode = useRef<Node | null>(null);
  const mentionStartOffset = useRef<number>(0);
  const fileCacheFetchIdRef = useRef(0);
  const fileCacheRefreshTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasContentRef = useRef(false);

  const modelList = supportedModels?.length
    ? supportedModels.map((m) => ({ id: m.value, label: m.displayName, description: m.description }))
    : [];
  const isACPAgent = selectedAgent != null && selectedAgent.engine === "acp";
  const isCodexAgent = selectedAgent != null && selectedAgent.engine === "codex";
  const isOpenClawAgent = selectedAgent != null && selectedAgent.engine === "openclaw";
  const showACPConfigOptions = isACPAgent && (acpConfigOptions?.length ?? 0) > 0;
  const isAwaitingAcpOptions = isACPAgent && !!acpConfigOptionsLoading;
  const modelsLoading = modelList.length === 0;
  const modelsLoadingText = isCodexAgent
    ? (codexModelsLoadingMessage?.trim() || "Loading Codex models...")
    : "Loading models…";
  const resolvedModelId = resolveModelValue(model, supportedModels ?? []);
  const preferredModelId = resolvedModelId ?? model;
  const selectedModel = modelList.find((m) => m.id === preferredModelId) ?? modelList[0];
  const selectedModelId = selectedModel?.id ?? preferredModelId;
  const claudeCurrentModel = supportedModels?.find((m) => m.value === selectedModelId);
  const claudeEffortOptionsByModel = Object.fromEntries(
    (supportedModels ?? [])
      .filter((m) => m.supportsEffort && (m.supportedEffortLevels?.length ?? 0) > 0)
      .map((m) => [m.value, m.supportedEffortLevels ?? []]),
  ) as Partial<Record<string, ClaudeEffort[]>>;
  const claudeEffortOptions = claudeCurrentModel?.supportsEffort
    ? (claudeCurrentModel.supportedEffortLevels ?? [])
    : [];
  const claudeActiveEffort = claudeEffortOptions.includes(claudeEffort)
    ? claudeEffort
    : (claudeEffortOptions.includes("high") ? "high" : (claudeEffortOptions[0] ?? "high"));

  const codexCurrentModel = codexModelData?.find((m) => m.id === selectedModelId)
    ?? codexModelData?.find((m) => m.isDefault)
    ?? codexModelData?.[0];
  const codexEffortOptions = codexCurrentModel?.supportedReasoningEfforts ?? [];
  const codexActiveEffort = codexEffortOptions.some((opt) => opt.reasoningEffort === codexEffort)
    ? codexEffort
    : codexCurrentModel?.defaultReasoningEffort ?? codexEffort ?? "medium";

  const refreshFileCache = useCallback(async (cwd: string) => {
    const fetchId = ++fileCacheFetchIdRef.current;
    const result = await window.claude.files.list(cwd);
    if (fetchId !== fileCacheFetchIdRef.current) return;
    setFileCache(result);
  }, []);

  const scheduleFileCacheRefresh = useCallback((cwd: string) => {
    clearTimeout(fileCacheRefreshTimerRef.current);
    fileCacheRefreshTimerRef.current = setTimeout(() => {
      void refreshFileCache(cwd);
    }, 150);
  }, [refreshFileCache]);

  useEffect(() => {
    if (!projectPath) {
      fileCacheFetchIdRef.current += 1;
      clearTimeout(fileCacheRefreshTimerRef.current);
      setFileCache(null);
      return;
    }

    setFileCache(null);
    void refreshFileCache(projectPath);
    void window.claude.files.watch(projectPath);

    const unsubscribe = window.claude.files.onChanged(({ cwd }) => {
      if (cwd !== projectPath) return;
      scheduleFileCacheRefresh(projectPath);
    });

    const refreshOnFocus = () => scheduleFileCacheRefresh(projectPath);
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        scheduleFileCacheRefresh(projectPath);
      }
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
      clearTimeout(fileCacheRefreshTimerRef.current);
      void window.claude.files.unwatch(projectPath);
    };
  }, [projectPath, refreshFileCache, scheduleFileCacheRefresh]);

  const mentionResults = useCallback(() => {
    if (!fileCache) return [];
    const q = mentionQuery;
    const allEntries = [
      ...fileCache.dirs.map((d) => ({ path: d, isDir: true })),
      ...fileCache.files.map((f) => ({ path: f, isDir: false })),
    ];

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

  const cmdResults = (() => {
    if (!showCommands || !slashCommands?.length) return [];
    const q = commandQuery.toLowerCase();
    if (!q) return slashCommands.slice(0, 15);
    return slashCommands
      .filter(cmd => cmd.name.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q))
      .slice(0, 15);
  })();

  useEffect(() => {
    if (mentionIndex >= results.length) {
      setMentionIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, mentionIndex]);

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

  const selectCommand = useCallback((cmd: SlashCommand) => {
    setShowCommands(false);
    const el = editableRef.current;
    if (!el) return;

    let replacement: string;
    switch (cmd.source) {
      case "claude":
      case "acp":
        replacement = `/${cmd.name} `;
        break;
      case "codex-skill":
        replacement = cmd.defaultPrompt
          ? `$${cmd.name} ${cmd.defaultPrompt}`
          : `$${cmd.name} `;
        break;
      case "codex-app":
        replacement = `$${cmd.appSlug ?? cmd.name} `;
        break;
    }

    el.textContent = replacement;

    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.focus();

    hasContentRef.current = true;
    setHasContent(true);
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

      const range = document.createRange();
      range.setStart(node, mentionStartOffset.current);
      const curRange = sel.getRangeAt(0);
      range.setEnd(curRange.startContainer, curRange.startOffset);
      range.deleteContents();

      const chip = document.createElement("span");
      chip.contentEditable = "false";
      chip.className =
        "mention-chip inline-flex items-center gap-1 rounded-md bg-accent/60 px-1.5 py-0.5 text-xs text-accent-foreground font-mono align-baseline cursor-default select-none";
      chip.setAttribute("data-mention-path", entry.path);
      chip.setAttribute("data-mention-dir", String(entry.isDir));
      chip.innerHTML = `${entry.isDir ? FOLDER_ICON_SVG : FILE_ICON_SVG}<span>${entry.path}</span>`;

      range.insertNode(chip);

      const space = document.createTextNode(" ");
      chip.after(space);

      const newRange = document.createRange();
      newRange.setStartAfter(space);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);

      hasContentRef.current = true;
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
    const hasGrabs = grabbedElements && grabbedElements.length > 0;
    const hasSnippets = codeSnippets && codeSnippets.length > 0;
    if (isAwaitingAcpOptions || (!trimmed && attachments.length === 0 && !hasGrabs && !hasSnippets) || isSending) return;

    const currentImages = attachments.length > 0 ? [...attachments] : undefined;
    const contextParts: string[] = [];
    const grabbedElementDisplayTokens: string[] = [];
    let hasContext = false;

    if (mentionPaths.length > 0 && projectPath) {
      setIsSending(true);
      try {
        const fileResults = await window.claude.files.readMultiple(projectPath, mentionPaths);

        for (const result of fileResults) {
          if (result.error) {
            contextParts.push(`<file path="${result.path}">\n[Error: ${result.error}]\n</file>`);
          } else if (result.isDir && result.tree) {
            contextParts.push(`<folder path="${result.path}">\n${result.tree}\n</folder>`);
          } else if (!result.isDir && result.content !== undefined) {
            contextParts.push(`<file path="${result.path}">\n${result.content}\n</file>`);
          }
        }
        hasContext = true;
      } finally {
        setIsSending(false);
      }
    }

    if (hasGrabs) {
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const compact = (s: string) => s.trim().replace(/\s+/g, " ");

      for (const ge of grabbedElements) {
        const browserRef = [
          `<${ge.tag}>`,
          ge.attributes?.id ? `#${ge.attributes.id}` : "",
          ge.classes?.length ? `.${ge.classes.slice(0, 2).join(".")}` : "",
          ge.textContent ? ` ${compact(ge.textContent).slice(0, 40)}` : "",
        ].join("").replace(/\]/g, "");
        grabbedElementDisplayTokens.push(`[[element:${browserRef}]]`);

        const attrs = Object.entries(ge.attributes)
          .map(([k, v]) => `  ${k}="${esc(v)}"`)
          .join("\n");
        const styles = Object.entries(ge.computedStyles)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join("\n");

        contextParts.push(
          `<element tag="${esc(ge.tag)}" selector="${esc(ge.selector)}" url="${esc(ge.url)}">` +
          `\nClasses: ${ge.classes.join(" ") || "(none)"}` +
          (attrs ? `\nAttributes:\n${attrs}` : "") +
          (ge.textContent ? `\nText content: ${ge.textContent}` : "") +
          (styles ? `\nComputed styles:\n${styles}` : "") +
          `\nHTML:\n${ge.outerHTML}` +
          `\n</element>`,
        );
      }
      hasContext = true;
    }

    if (hasSnippets) {
      for (const snippet of codeSnippets) {
        const range = snippet.lineStart === snippet.lineEnd ? `L${snippet.lineStart}` : `L${snippet.lineStart}-${snippet.lineEnd}`;
        contextParts.push(`<file path="${snippet.filePath}:${range}">\n${snippet.code}\n</file>`);
      }
      hasContext = true;
    }

    if (hasContext) {
      const contextBlock = contextParts.join("\n\n");
      const fullMessage = contextBlock ? `${contextBlock}\n\n${trimmed}` : trimmed;
      const displayText =
        grabbedElementDisplayTokens.length > 0
          ? `${trimmed}${trimmed ? "\n\n" : ""}${grabbedElementDisplayTokens.join(" ")}`
          : trimmed;
      onSend(fullMessage, currentImages, displayText, hasSnippets ? codeSnippets : undefined);
    } else {
      onSend(trimmed, currentImages);
    }

    el.innerHTML = "";
    hasContentRef.current = false;
    setHasContent(false);
    setAttachments([]);
    closeMentions();
  }, [attachments, isAwaitingAcpOptions, isSending, projectPath, onSend, closeMentions, grabbedElements, codeSnippets]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (showCommands && cmdResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCommandIndex((prev) => (prev + 1) % cmdResults.length);
        requestAnimationFrame(() => {
          commandListRef.current?.querySelector("[data-active=true]")?.scrollIntoView({ block: "nearest" });
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCommandIndex((prev) => (prev - 1 + cmdResults.length) % cmdResults.length);
        requestAnimationFrame(() => {
          commandListRef.current?.querySelector("[data-active=true]")?.scrollIntoView({ block: "nearest" });
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectCommand(cmdResults[commandIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowCommands(false);
        return;
      }
    }

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
      if (!isSending && !isAwaitingAcpOptions) {
        handleSend();
      }
    }
  };

  const handleEditableInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const el = editableRef.current;
    if (!el) return;

    const nativeEvent = e.nativeEvent;
    const inputType = nativeEvent instanceof InputEvent ? nativeEvent.inputType : "";
    const shouldRecomputeHasContent =
      !hasContentRef.current ||
      inputType.startsWith("delete") ||
      inputType === "historyUndo" ||
      inputType === "historyRedo";

    if (shouldRecomputeHasContent) {
      const text = el.textContent ?? "";
      const hasText = hasMeaningfulText(text);
      const hasMentionChip = el.querySelector("[data-mention-path]") !== null;
      const nextHasContent = hasText || hasMentionChip;
      if (nextHasContent !== hasContentRef.current) {
        hasContentRef.current = nextHasContent;
        setHasContent(nextHasContent);
      }
    } else if (!hasContentRef.current) {
      hasContentRef.current = true;
      setHasContent(true);
    }

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      if (showMentions) closeMentions();
      if (showCommands) setShowCommands(false);
      return;
    }

    const range = sel.getRangeAt(0);
    const node = range.startContainer;

    if (node.nodeType !== Node.TEXT_NODE) {
      if (showMentions) closeMentions();
      if (showCommands) setShowCommands(false);
      return;
    }

    const nodeText = node.textContent ?? "";
    const offset = range.startOffset;
    const scanStart = Math.max(0, offset - 256);
    const textBefore = nodeText.slice(scanStart, offset);
    const atMatch = textBefore.match(/(^|[\s])@([^\s]*)$/);

    if (atMatch && projectPath) {
      mentionStartNode.current = node;
      mentionStartOffset.current = scanStart + textBefore.lastIndexOf("@");
      setMentionQuery(atMatch[2]);
      setShowMentions(true);
      setMentionIndex(0);
    } else {
      if (showMentions) closeMentions();
    }

    const fullText = (el.textContent ?? "").trimStart();
    const slashMatch = fullText.match(/^\/(\S*)$/);
    if (slashMatch && slashCommands?.length) {
      setShowCommands(true);
      setCommandQuery(slashMatch[1]);
      setCommandIndex(0);
    } else if (showCommands) {
      setShowCommands(false);
    }
  }, [showMentions, showCommands, closeMentions, projectPath, slashCommands]);

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

      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      if (!hasContentRef.current && text.length > 0) {
        hasContentRef.current = true;
        setHasContent(true);
      }
      insertTextAtCursor(editableRef.current, text);
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

      const droppedPath = e.dataTransfer?.getData("application/x-harnss-path");
      if (droppedPath) {
        const isDir = e.dataTransfer.getData("application/x-harnss-is-dir") === "true";
        const el = editableRef.current;
        if (el) {
          el.focus();
          const chip = document.createElement("span");
          chip.contentEditable = "false";
          chip.className =
            "mention-chip inline-flex items-center gap-1 rounded-md bg-accent/60 px-1.5 py-0.5 text-xs text-accent-foreground font-mono align-baseline cursor-default select-none";
          chip.setAttribute("data-mention-path", droppedPath);
          chip.setAttribute("data-mention-dir", String(isDir));
          chip.innerHTML = `${isDir ? FOLDER_ICON_SVG : FILE_ICON_SVG}<span>${droppedPath}</span>`;

          const sel = window.getSelection();
          if (sel && sel.rangeCount) {
            const range = sel.getRangeAt(0);
            range.collapse(false);
            range.insertNode(chip);
            const space = document.createTextNode(" ");
            chip.after(space);
            range.setStartAfter(space);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            el.appendChild(chip);
            el.appendChild(document.createTextNode(" "));
          }

          hasContentRef.current = true;
          setHasContent(true);
        }
        return;
      }

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
    <div className={`mx-auto w-full px-4 pb-4 ${BOTTOM_CHAT_MAX_WIDTH_CLASS}`}>
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

        {showCommands && cmdResults.length > 0 && (
          <div
            ref={commandListRef}
            className="mx-2 mb-1 mt-2 max-h-64 overflow-y-auto rounded-lg border border-border/60 bg-popover p-1 shadow-lg"
          >
            {cmdResults.map((cmd, i) => (
              <button
                key={`${cmd.source}-${cmd.name}`}
                data-active={i === commandIndex}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm transition-colors ${
                  i === commandIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-muted/40"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectCommand(cmd);
                }}
                onMouseEnter={() => setCommandIndex(i)}
              >
                {cmd.iconUrl ? (
                  <img src={cmd.iconUrl} alt="" className="h-4 w-4 shrink-0 rounded" />
                ) : (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
                    {cmd.source.startsWith("codex") ? "$" : "/"}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-medium">
                      {cmd.source.startsWith("codex") ? "$" : "/"}{cmd.name}
                    </span>
                    {cmd.argumentHint && (
                      <span className="text-xs text-muted-foreground">{cmd.argumentHint}</span>
                    )}
                  </div>
                  {cmd.description && (
                    <div className="truncate text-xs text-muted-foreground">{cmd.description}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        <div
          className="relative px-4 pt-3.5 pb-2"
          onClick={() => editableRef.current?.focus()}
        >
          {!hasContent && (
            <div className="pointer-events-none absolute inset-0 flex items-start px-4 pt-3.5 pb-2 text-sm text-muted-foreground/50">
              {isCompacting
                ? "Compacting context..."
                : isAwaitingAcpOptions
                  ? "Loading agent options..."
                : isProcessing
                  ? `${selectedAgent?.name ?? "Claude"} is responding... (messages will be queued)`
                  : slashCommands?.length
                    ? "Ask anything, @ to tag files, / for commands"
                    : "Ask anything, @ to tag files"}
            </div>
          )}
          <div
            ref={editableRef}
            contentEditable
            onInput={handleEditableInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className={`min-h-[1.5em] max-h-[200px] overflow-y-auto text-sm outline-none whitespace-pre-wrap wrap-break-word ${
              isAwaitingAcpOptions ? "cursor-wait text-muted-foreground/60" : "text-foreground"
            }`}
            role="textbox"
            aria-multiline="true"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            data-gramm="false"
            aria-disabled={isAwaitingAcpOptions}
            suppressContentEditableWarning
          />
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="group/att relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border/40"
                onClick={() => setEditingAttachment(att)}
              >
                <img
                  src={`data:${att.mediaType};base64,${att.data}`}
                  alt={att.fileName ?? "attachment"}
                  className="h-full w-full object-cover"
                />
                <div className="absolute bottom-0.5 end-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/att:opacity-100">
                  <Pencil className="h-2.5 w-2.5" />
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeAttachment(att.id); }}
                  className="absolute -end-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover/att:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {grabbedElements && grabbedElements.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {grabbedElements.map((ge) => (
              <div
                key={ge.id}
                className="group/grab relative flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-2.5 py-1.5"
              >
                <Crosshair className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                <div className="flex flex-col">
                  <span className="text-[11px] font-mono font-medium text-foreground/80">
                    {"<"}{ge.tag}{">"}
                    {ge.attributes?.id && (
                      <span className="text-blue-400">#{ge.attributes.id}</span>
                    )}
                    {ge.classes?.length > 0 && (
                      <span className="text-foreground/40">.{ge.classes.slice(0, 2).join(".")}</span>
                    )}
                  </span>
                  {ge.textContent && (
                    <span className="max-w-48 truncate text-[10px] text-muted-foreground">
                      {ge.textContent.slice(0, 60)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onRemoveGrabbedElement?.(ge.id)}
                  className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover/grab:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {codeSnippets && codeSnippets.length > 0 && (
          <div className="flex flex-col gap-1.5 px-4 pb-2">
            {codeSnippets.map((snippet) => (
              <CodeSnippetCard key={snippet.id} snippet={snippet} onRemove={() => onRemoveCodeSnippet?.(snippet.id)} />
            ))}
          </div>
        )}

        {editingAttachment && (
          <ImageAnnotationEditor
            image={editingAttachment}
            open={!!editingAttachment}
            onOpenChange={(isOpen) => { if (!isOpen) setEditingAttachment(null); }}
            onSave={(updated) => {
              setAttachments((prev) => prev.map((a) => a.id === updated.id ? updated : a));
              setEditingAttachment(null);
            }}
          />
        )}

        <div className="flex items-center gap-1 px-3 pb-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex shrink-0 items-center justify-center rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              title="Attach image"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>

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
                    className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    disabled={isProcessing}
                  >
                    <AgentIcon
                      icon={selectedAgent ? getAgentIcon(selectedAgent) : ENGINE_ICONS.claude}
                      size={14}
                      className="shrink-0"
                    />
                    {selectedAgent?.name ?? "Claude Code"}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(() => {
                    const willOpenNewChat = (agent: InstalledAgent) => {
                      if (lockedEngine == null) return false;
                      if (agent.engine !== lockedEngine) return true;
                      if (lockedEngine === "acp" && lockedAgentId && agent.id !== lockedAgentId) return true;
                      return false;
                    };
                    const sameEngine = agents.filter((a) => !willOpenNewChat(a));
                    const crossEngine = agents.filter((a) => willOpenNewChat(a));

                    const renderItem = (agent: InstalledAgent, crossEngine: boolean) => (
                      <DropdownMenuItem
                        key={agent.id}
                        onClick={() => onAgentChange(agent.engine === "claude" ? null : agent)}
                        className={
                          (selectedAgent?.id ?? "claude-code") === agent.id ? "bg-accent" : ""
                        }
                      >
                        <AgentIcon
                          icon={getAgentIcon(agent)}
                          size={16}
                          className="shrink-0"
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            {agent.name}
                            {agent.engine !== "claude" && (
                              <span className="rounded bg-amber-500/15 px-1 py-px text-[10px] font-medium text-amber-400">Beta</span>
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

            <EngineControls
              isCodexAgent={isCodexAgent}
              isACPAgent={isACPAgent}
              isOpenClawAgent={isOpenClawAgent}
              isProcessing={isProcessing}
              showACPConfigOptions={showACPConfigOptions}
              modelList={modelList}
              selectedModel={selectedModel}
              selectedModelId={selectedModelId}
              onModelChange={onModelChange}
              onClaudeModelEffortChange={onClaudeModelEffortChange}
              claudeEffortOptionsByModel={claudeEffortOptionsByModel}
              claudeActiveEffort={claudeActiveEffort}
              modelsLoading={modelsLoading}
              modelsLoadingText={modelsLoadingText}
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange}
              planMode={planMode}
              onPlanModeChange={onPlanModeChange}
              codexEffortOptions={codexEffortOptions}
              codexActiveEffort={codexActiveEffort}
              onCodexEffortChange={onCodexEffortChange}
              acpPermissionBehavior={acpPermissionBehavior}
              onAcpPermissionBehaviorChange={onAcpPermissionBehaviorChange}
              acpConfigOptions={acpConfigOptions}
              acpConfigOptionsLoading={acpConfigOptionsLoading}
              onACPConfigChange={onACPConfigChange}
            />
          </div>

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
                          className="stroke-muted-foreground/20 dark:stroke-muted/30"
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
                disabled={isAwaitingAcpOptions || ((!hasContent && attachments.length === 0 && (!grabbedElements || grabbedElements.length === 0) && (!codeSnippets || codeSnippets.length === 0)) || isSending)}
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
