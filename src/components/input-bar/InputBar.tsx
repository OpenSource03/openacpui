import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  memo,
  type KeyboardEvent,
} from "react";
import DOMPurify from "dompurify";
import {
  ArrowUp,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ImageAttachment,
  GrabbedElement,
  ContextUsage,
  InstalledAgent,
  ACPConfigOption,
  ModelInfo,
  AcpPermissionBehavior,
  ClaudeEffort,
  EngineId,
  SlashCommand,
} from "@/types";
import { BOTTOM_CHAT_MAX_WIDTH_CLASS } from "@/lib/layout/constants";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { resolveModelValue } from "@/lib/model-utils";
import { ImageAnnotationEditor } from "@/components/ImageAnnotationEditor";
import { TOOLBAR_BTN } from "./constants";
import {
  readFileAsBase64,
  isAcceptedImage,
  insertTextAtCursor,
  hasMeaningfulText,
  stripVoicePlaceholderText,
  extractEditableContent,
  getAvailableSlashCommands,
  isClearCommandText,
} from "./input-bar-utils";
import { ContextGauge } from "./ContextGauge";
import { AttachmentPreview } from "./AttachmentPreview";
import { EnginePickerDropdown } from "./EnginePickerDropdown";
import { EngineControls } from "./EngineControls";
import { MentionPicker } from "./MentionPicker";
import { useMentionAutocomplete } from "./useMentionAutocomplete";
import { CommandPicker } from "./CommandPicker";
import { useCommandAutocomplete } from "./CommandPicker";

/** localStorage key for a per-session composer draft. */
function draftStorageKey(draftKey: string): string {
  return `harnss-composer-draft-${draftKey}`;
}

/**
 * Which draftKey has the current "write lease" on localStorage. When the same
 * session is somehow surfaced in two InputBar instances (same pane reopen
 * race, split view, or a second window), only the first-mounted owner writes
 * back — the rest restore from storage but stay passive, so they never
 * clobber the primary composer's state.
 *
 * Module-level Map, not context, so it survives React reconciliation without
 * needing a provider plumbed through every mount site.
 */
const draftKeyOwners = new Set<string>();

/**
 * Sanitize HTML pulled out of localStorage before re-injecting it via
 * innerHTML. The composer only ever produces text nodes, <br>, and
 * mention chips (spans with a data-mention-path attribute), so we whitelist
 * exactly that and strip every event handler / script / URL-bearing tag.
 *
 * Why it matters: a devtools user, browser extension, or a second Electron
 * window could theoretically tamper with the saved blob. Without sanitize,
 * replaying `<img onerror="...">` on mount would execute the handler.
 */
function sanitizeDraftHtml(raw: string): string {
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ["br", "span", "div", "p"],
    ALLOWED_ATTR: ["data-mention-path", "class", "contenteditable", "data-mention-chip"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "img", "svg"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "href", "src", "style"],
  });
}

export interface InputBarProps {
  onSend: (text: string, images?: ImageAttachment[], displayText?: string) => void;
  onClear?: () => void | Promise<void>;
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
  /** Slash commands available for the current engine session */
  slashCommands?: SlashCommand[];
  acpConfigOptions?: ACPConfigOption[];
  acpConfigOptionsLoading?: boolean;
  onACPConfigChange?: (configId: string, value: string) => void;
  acpPermissionBehavior?: AcpPermissionBehavior;
  onAcpPermissionBehaviorChange?: (behavior: AcpPermissionBehavior) => void;
  supportedModels?: ModelInfo[];
  codexModelsLoadingMessage?: string | null;
  /** Codex reasoning effort -- per-model configurable effort level */
  codexEffort?: string;
  onCodexEffortChange?: (effort: string) => void;
  /** Codex models carry their supported effort levels -- passed through for the effort dropdown */
  codexModelData?: Array<{
    id: string;
    supportedReasoningEfforts: Array<{
      reasoningEffort: string;
      description: string;
    }>;
    defaultReasoningEffort: string;
    isDefault?: boolean;
  }>;
  /** Non-null when session is active (not draft) -- engine is locked and cross-engine agents show "Opens new chat" */
  lockedEngine?: EngineId | null;
  /** Non-null when an ACP session is active -- switching to a different ACP agent opens new chat */
  lockedAgentId?: string | null;
  /** Number of messages currently queued for sending */
  queuedCount?: number;
  /** Grabbed elements from browser inspector, displayed as context cards */
  grabbedElements?: GrabbedElement[];
  /** Remove a grabbed element by ID */
  onRemoveGrabbedElement?: (id: string) => void;
  /** Open ACP Agents settings */
  onManageACPs?: () => void;
  /**
   * Stable key (typically activeSessionId) used to persist the composer's
   * contents across remounts. Omitted or null disables persistence — useful
   * for detached contexts like onboarding samples. When the key changes the
   * current content is saved for the previous key and the new key's content
   * is restored from localStorage.
   */
  draftKey?: string | null;
}

export const InputBar = memo(function InputBar({
  onSend,
  onClear,
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
  onManageACPs,
  draftKey,
}: InputBarProps) {
  // ── Core state ──
  const [hasContent, setHasContent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [editingAttachment, setEditingAttachment] = useState<ImageAttachment | null>(null);

  // Deep folder confirmation
  const [showDeepFolderConfirm, setShowDeepFolderConfirm] = useState(false);
  const [deepFolderInfo, setDeepFolderInfo] = useState<{
    fileCount: number;
    totalSize: number;
    estimatedTokens: number;
    warnings: string[];
  } | null>(null);
  const pendingSendRef = useRef<(() => Promise<void>) | null>(null);

  // Voice dictation
  const speech = useSpeechRecognition({
    onResult: (text) => insertTextAtCursor(editableRef.current, text),
  });

  const editableRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasContentRef = useRef(false);

  // ── Derived engine state ──
  const isACPAgent = selectedAgent != null && selectedAgent.engine === "acp";
  const isCodexAgent = selectedAgent != null && selectedAgent.engine === "codex";
  const showACPConfigOptions = isACPAgent && (acpConfigOptions?.length ?? 0) > 0;
  const isAwaitingAcpOptions = isACPAgent && !!acpConfigOptionsLoading;

  const availableSlashCommands = useMemo(
    () => getAvailableSlashCommands(slashCommands),
    [slashCommands],
  );

  // ── Derived model state ──
  const modelList = supportedModels?.length
    ? supportedModels.map((m) => ({
        id: m.value,
        label: m.displayName,
        description: m.description,
      }))
    : [];
  const modelsLoading = modelList.length === 0;
  const modelsLoadingText = isCodexAgent
    ? (codexModelsLoadingMessage?.trim() || "Loading Codex models...")
    : "Loading models...";
  const resolvedModelId = resolveModelValue(model, supportedModels ?? []);
  const preferredModelId = resolvedModelId ?? model;
  const selectedModel = modelList.find((m) => m.id === preferredModelId) ?? (
    preferredModelId
      ? { id: preferredModelId, label: preferredModelId, description: "" }
      : modelList[0]
  );
  const selectedModelId = selectedModel?.id ?? preferredModelId;

  // Claude effort
  const claudeCurrentModel = supportedModels?.find((m) => m.value === selectedModelId);
  const claudeEffortOptions = claudeCurrentModel?.supportsEffort
    ? (claudeCurrentModel.supportedEffortLevels ?? [])
    : [];
  const claudeActiveEffort = claudeEffortOptions.includes(claudeEffort)
    ? claudeEffort
    : (claudeEffortOptions.includes("high") ? "high" : (claudeEffortOptions[0] ?? "high"));

  // Codex effort
  const codexCurrentModel = codexModelData?.find((m) => m.id === selectedModelId)
    ?? codexModelData?.find((m) => m.isDefault)
    ?? codexModelData?.[0];
  const supportedModelCodexEfforts = supportedModels
    ?.find((m) => m.value === selectedModelId)
    ?.supportedEffortLevels
    ?.map((effort) => ({ reasoningEffort: effort, description: "" }))
    ?? [];
  const codexEffortOptions = codexCurrentModel?.supportedReasoningEfforts ?? supportedModelCodexEfforts;
  const codexActiveEffort = codexEffortOptions.some((opt) => opt.reasoningEffort === codexEffort)
    ? codexEffort
    : codexCurrentModel?.defaultReasoningEffort ?? codexEffort ?? "medium";

  // ── Mention & command autocomplete ──

  const mention = useMentionAutocomplete({ projectPath, editableRef });
  const command = useCommandAutocomplete({ availableSlashCommands, editableRef });

  // ── Composer lifecycle ──

  const clearComposer = useCallback(
    (el: HTMLDivElement) => {
      el.innerHTML = "";
      hasContentRef.current = false;
      setHasContent(false);
      setAttachments([]);
      mention.closeMentions();
      command.setShowCommands(false);
      // Drop the persisted draft on send / explicit clear so it doesn't
      // resurrect next time we restore for this draftKey. We always want to
      // purge (even for non-owners) since a send from any instance means the
      // draft is "spent" from the user's perspective.
      if (draftKey) {
        try { localStorage.removeItem(draftStorageKey(draftKey)); } catch { /* quota / mode */ }
      }
    },
    [mention.closeMentions, command.setShowCommands, draftKey],
  );

  // Save/restore the composer's DOM content per draftKey (session id).
  // - On mount / draftKey change: restore the stored innerHTML for the new key
  //   so mention chips + text both survive a space switch that unmounts us.
  // - On cleanup (unmount / draftKey change): save the current DOM under the
  //   PREVIOUS key. useEffect cleanup runs before the next effect body, so the
  //   save always targets the key the DOM actually belonged to.
  // - Write-lease: if another InputBar is already editing this draftKey, we
  //   read storage but never write back, so the primary composer stays the
  //   single source of truth.
  useEffect(() => {
    if (!draftKey) return;
    const el = editableRef.current;
    if (!el) return;

    const isOwner = !draftKeyOwners.has(draftKey);
    if (isOwner) draftKeyOwners.add(draftKey);

    try {
      const stored = localStorage.getItem(draftStorageKey(draftKey));
      if (stored && stored.length > 0) {
        // Sanitize before innerHTML: the blob comes out of localStorage,
        // which any devtools user / extension could have written. Strip
        // event handlers / unexpected tags so we never execute tampered
        // scripts just by restoring a draft.
        el.innerHTML = sanitizeDraftHtml(stored);
        const hasText = Boolean(el.textContent?.trim());
        hasContentRef.current = hasText;
        setHasContent(hasText);
      }
    } catch { /* ignore — fall through to empty composer */ }

    return () => {
      if (isOwner) {
        // Primary composer saves its DOM and releases the lease.
        const current = el.innerHTML;
        const hasText = Boolean(el.textContent?.trim());
        try {
          if (current && hasText) {
            localStorage.setItem(draftStorageKey(draftKey), current);
          } else {
            localStorage.removeItem(draftStorageKey(draftKey));
          }
        } catch { /* ignore */ }
        draftKeyOwners.delete(draftKey);
      }
      // Non-owners restore only, so nothing to persist on unmount — avoids
      // the "last writer wins" clobber when two panes share a session id.
    };
  }, [draftKey]);

  // ── Image attachments ──

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

  // ── Send flow ──

  const performSend = useCallback(
    async (
      el: HTMLDivElement,
      fullText: string,
      mentionPaths: string[],
      deepMentionPaths: Set<string>,
      hasGrabs: boolean,
    ) => {
      const trimmed = fullText.trim();
      const currentImages = attachments.length > 0 ? [...attachments] : undefined;
      const contextParts: string[] = [];
      const grabbedElementDisplayTokens: string[] = [];
      let hasContext = false;

      // File mentions -> <file>/<folder> context blocks
      if (mentionPaths.length > 0 && projectPath) {
        setIsSending(true);
        try {
          const fileResults = await window.claude.files.readMultiple(
            projectPath,
            mentionPaths,
            deepMentionPaths,
          );

          for (const result of fileResults) {
            if (result.error) {
              contextParts.push(
                `<file path="${result.path}">\n[Error: ${result.error}]\n</file>`,
              );
            } else if (result.isDir && result.tree) {
              contextParts.push(
                `<folder path="${result.path}">\n${result.tree}\n</folder>`,
              );
            } else if (!result.isDir && result.content !== undefined) {
              contextParts.push(
                `<file path="${result.path}">\n${result.content}\n</file>`,
              );
            }
          }
          hasContext = true;
        } finally {
          setIsSending(false);
        }
      }

      // Grabbed elements -> <element> context blocks
      if (hasGrabs && grabbedElements) {
        const esc = (s: string) =>
          s
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        const compact = (s: string) => s.trim().replace(/\s+/g, " ");

        for (const ge of grabbedElements) {
          const browserRef = [
            `<${ge.tag}>`,
            ge.attributes?.id ? `#${ge.attributes.id}` : "",
            ge.classes?.length ? `.${ge.classes.slice(0, 2).join(".")}` : "",
            ge.textContent
              ? ` ${compact(ge.textContent).slice(0, 40)}`
              : "",
          ]
            .join("")
            .replace(/\]/g, "");
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
              (ge.textContent
                ? `\nText content: ${ge.textContent}`
                : "") +
              (styles ? `\nComputed styles:\n${styles}` : "") +
              `\nHTML:\n${ge.outerHTML}` +
              `\n</element>`,
          );
        }
        hasContext = true;
      }

      if (hasContext) {
        const contextBlock = contextParts.join("\n\n");
        const fullMessage = contextBlock
          ? `${contextBlock}\n\n${trimmed}`
          : trimmed;
        const displayText =
          grabbedElementDisplayTokens.length > 0
            ? `${trimmed}${trimmed ? "\n\n" : ""}${grabbedElementDisplayTokens.join(" ")}`
            : trimmed;
        onSend(fullMessage, currentImages, displayText);
      } else {
        onSend(trimmed, currentImages);
      }

      clearComposer(el);
    },
    [attachments, projectPath, onSend, clearComposer, grabbedElements],
  );

  const handleSend = useCallback(async () => {
    const el = editableRef.current;
    if (!el) return;

    const { text: fullText, mentionPaths, deepMentionPaths } =
      extractEditableContent(el);
    const trimmed = fullText.trim();
    const hasGrabs = (grabbedElements?.length ?? 0) > 0;
    if (
      isAwaitingAcpOptions ||
      (!trimmed && attachments.length === 0 && !hasGrabs) ||
      isSending
    )
      return;

    if (isClearCommandText(trimmed)) {
      try {
        await onClear?.();
      } finally {
        clearComposer(el);
      }
      return;
    }

    // Check if we need to warn about deep folder size
    if (deepMentionPaths.size > 0 && projectPath) {
      try {
        const sizeInfo = await window.claude.files.calculateDeepSize(
          projectPath,
          Array.from(deepMentionPaths),
        );

        if (sizeInfo.estimatedTokens > 50_000) {
          setDeepFolderInfo(sizeInfo);
          setShowDeepFolderConfirm(true);
          pendingSendRef.current = async () => {
            await performSend(
              el,
              fullText,
              mentionPaths,
              deepMentionPaths,
              hasGrabs,
            );
          };
          return;
        }
      } catch (err) {
        console.error("Failed to calculate deep folder size:", err);
      }
    }

    await performSend(el, fullText, mentionPaths, deepMentionPaths, hasGrabs);
  }, [
    attachments,
    isAwaitingAcpOptions,
    isSending,
    projectPath,
    onClear,
    grabbedElements,
    performSend,
    clearComposer,
  ]);

  const handleDeepFolderConfirm = useCallback(async () => {
    if (pendingSendRef.current) {
      await pendingSendRef.current();
      pendingSendRef.current = null;
    }
    setShowDeepFolderConfirm(false);
    setDeepFolderInfo(null);
  }, []);

  // ── Keyboard handling ──

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // IME composition guard: while the user is composing with a pinyin / kana /
    // other input method, Enter / Arrow keys / Tab belong to the IME candidate
    // window and must NOT trigger our own handlers (send, slash-picker nav,
    // mention nav, newline). `isComposing` covers modern browsers; keyCode 229
    // is a legacy fallback some browsers still use on composition commit.
    //
    // Escape is deliberately let through: it cancels composition AND should
    // close the slash/mention picker in the same keypress. Otherwise users
    // have to press Escape twice to clear both.
    const isComposing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (isComposing && e.key !== "Escape") {
      return;
    }

    // Slash command picker keyboard navigation
    if (command.showCommands && command.cmdResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        command.setCommandIndex(
          (prev) => (prev + 1) % command.cmdResults.length,
        );
        requestAnimationFrame(() => {
          command.commandListRef.current
            ?.querySelector("[data-active=true]")
            ?.scrollIntoView({ block: "nearest" });
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        command.setCommandIndex(
          (prev) =>
            (prev - 1 + command.cmdResults.length) %
            command.cmdResults.length,
        );
        requestAnimationFrame(() => {
          command.commandListRef.current
            ?.querySelector("[data-active=true]")
            ?.scrollIntoView({ block: "nearest" });
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const didInsert = command.selectCommand(
          command.cmdResults[command.commandIndex],
        );
        if (didInsert) {
          hasContentRef.current = true;
          setHasContent(true);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        command.setShowCommands(false);
        return;
      }
    }

    // Mention picker keyboard navigation
    if (mention.showMentions && mention.results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mention.setMentionIndex(
          (prev) => (prev + 1) % mention.results.length,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        mention.setMentionIndex(
          (prev) =>
            (prev - 1 + mention.results.length) % mention.results.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const didInsert = mention.selectMention(
          mention.results[mention.mentionIndex],
        );
        if (didInsert) {
          hasContentRef.current = true;
          setHasContent(true);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        mention.closeMentions();
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

  // ── Input detection (@ mentions, / commands, content changes) ──

  const handleEditableInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      const el = editableRef.current;
      if (!el) return;

      const hasMentionChip =
        el.querySelector("[data-mention-path]") !== null;
      const rawText = el.textContent ?? "";
      const sanitizedText = stripVoicePlaceholderText(rawText);
      if (!hasMentionChip && sanitizedText !== rawText) {
        el.textContent = sanitizedText;
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }

      const nativeEvent = e.nativeEvent;
      const inputType =
        nativeEvent instanceof InputEvent ? nativeEvent.inputType : "";
      const shouldRecomputeHasContent =
        sanitizedText !== rawText ||
        !hasContentRef.current ||
        inputType.startsWith("delete") ||
        inputType === "historyUndo" ||
        inputType === "historyRedo";

      if (shouldRecomputeHasContent) {
        const hasText = hasMeaningfulText(sanitizedText);
        const nextHasContent = hasText || hasMentionChip;
        if (nextHasContent !== hasContentRef.current) {
          hasContentRef.current = nextHasContent;
          setHasContent(nextHasContent);
        }
      } else if (!hasContentRef.current) {
        hasContentRef.current = true;
        setHasContent(true);
      }

      // Detect @ and / triggers
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) {
        if (mention.showMentions) mention.closeMentions();
        if (command.showCommands) command.setShowCommands(false);
        return;
      }

      const range = sel.getRangeAt(0);
      const node = range.startContainer;

      // Mention detection
      mention.detectMentionTrigger(node, range.startOffset);

      // Slash command detection
      command.detectCommandTrigger(sanitizedText);
    },
    [mention, command],
  );

  // ── Paste / drag-drop handlers ──

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
    if (
      e.currentTarget === e.target ||
      !e.currentTarget.contains(e.relatedTarget as Node)
    ) {
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

  // ── Placeholder text ──

  const placeholderText = isCompacting
    ? "Compacting context..."
    : isAwaitingAcpOptions
      ? "Loading agent options..."
      : isProcessing
        ? `${selectedAgent?.name ?? "Claude"} is responding... (messages will be queued)`
        : availableSlashCommands.length > 0
          ? "Ask anything, @ to tag files, / for commands"
          : "Ask anything, @ to tag files";

  // ── Send button disabled state ──

  const sendDisabled =
    isAwaitingAcpOptions ||
    ((!hasContent &&
      attachments.length === 0 &&
      (!grabbedElements || grabbedElements.length === 0)) ||
      isSending);

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
        className={`pointer-events-auto rounded-2xl border bg-black/[0.09] dark:bg-white/[0.08] shadow-[0_2px_12px_-3px_rgba(0,0,0,0.06),0_8px_24px_-8px_rgba(0,0,0,0.04)] backdrop-blur-xl ring-1 ring-inset ring-white/[0.06] transition-all duration-200 ease-out focus-within:shadow-[0_2px_16px_-3px_rgba(0,0,0,0.08),0_12px_32px_-8px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_-3px_rgba(0,0,0,0.35),0_8px_24px_-8px_rgba(0,0,0,0.2)] dark:focus-within:shadow-[0_2px_16px_-3px_rgba(0,0,0,0.4),0_12px_32px_-8px_rgba(0,0,0,0.25)] ${
          isDragging
            ? "border-primary/50 bg-primary/5 ring-primary/25"
            : speech.isListening
              ? "border-red-400/40 ring-red-400/20"
              : "border-border/35 focus-within:border-border/60"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Mention popup */}
        {mention.showMentions && (
          <MentionPicker
            results={mention.results}
            mentionIndex={mention.mentionIndex}
            mentionListRef={mention.mentionListRef}
            onSelect={(entry) => {
              const didInsert = mention.selectMention(entry);
              if (didInsert) {
                hasContentRef.current = true;
                setHasContent(true);
              }
            }}
            onHover={mention.setMentionIndex}
          />
        )}

        {/* Slash command popup */}
        {command.showCommands && (
          <CommandPicker
            cmdResults={command.cmdResults}
            commandIndex={command.commandIndex}
            commandListRef={command.commandListRef}
            onSelect={(cmd) => {
              const didInsert = command.selectCommand(cmd);
              if (didInsert) {
                hasContentRef.current = true;
                setHasContent(true);
              }
            }}
            onHover={command.setCommandIndex}
          />
        )}

        {/* Input area -- contentEditable with inline chip support */}
        <div
          className="relative px-5 pt-4 pb-2.5"
          onClick={() => editableRef.current?.focus()}
        >
          {!hasContent && (
            <div className="pointer-events-none absolute inset-0 flex items-start px-5 pt-4 pb-2.5 text-sm text-muted-foreground/35 select-none">
              {placeholderText}
            </div>
          )}
          <div
            ref={editableRef}
            contentEditable
            onInput={handleEditableInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className={`min-h-[24px] max-h-[200px] overflow-y-auto text-[14.5px] leading-relaxed outline-none whitespace-pre-wrap wrap-break-word ${
              isAwaitingAcpOptions
                ? "cursor-wait text-muted-foreground/60"
                : "text-foreground"
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

        {/* Attachment & grabbed element previews */}
        <AttachmentPreview
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          onEditAttachment={setEditingAttachment}
          grabbedElements={grabbedElements ?? []}
          onRemoveGrabbedElement={onRemoveGrabbedElement ?? (() => {})}
        />

        {editingAttachment && (
          <ImageAnnotationEditor
            image={editingAttachment}
            open={!!editingAttachment}
            onOpenChange={(isOpen) => {
              if (!isOpen) setEditingAttachment(null);
            }}
            onSave={(updated) => {
              setAttachments((prev) =>
                prev.map((a) => (a.id === updated.id ? updated : a)),
              );
              setEditingAttachment(null);
            }}
          />
        )}

        {/* Bottom toolbar */}
        <div className="mx-4 flex items-center gap-1.5 border-t border-border/[0.08] px-1 pt-2 pb-2.5">
          {/* Left controls */}
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none">
            <Button
              variant="ghost"
              size="xs"
              className={TOOLBAR_BTN}
              onClick={() => fileInputRef.current?.click()}
              title="Attach image"
            >
              <Paperclip className="size-3.5" />
            </Button>

            {/* Voice dictation button */}
            {speech.isAvailable ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={speech.toggle}
                    disabled={speech.isModelLoading || speech.isTranscribing}
                    className={`rounded-lg font-normal transition-colors duration-150 ${
                      speech.isListening
                        ? "text-red-400 bg-red-500/10 recording-pulse hover:bg-red-500/15"
                        : speech.isTranscribing
                          ? "text-amber-400"
                          : speech.isModelLoading
                            ? "text-muted-foreground/40 cursor-wait"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    {speech.isListening ? (
                      <MicOff className="size-3.5" />
                    ) : speech.isModelLoading || speech.isTranscribing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Mic className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {speech.error
                    ? speech.error
                    : speech.isModelLoading
                      ? `Loading speech model... ${speech.loadProgress.toFixed(0)}%`
                      : speech.isTranscribing
                        ? "Transcribing..."
                        : speech.isListening
                          ? "Stop dictation"
                          : "Voice dictation"}
                </TooltipContent>
              </Tooltip>
            ) : speech.nativeHint ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="rounded-lg font-normal text-muted-foreground/40 cursor-default hover:bg-transparent"
                  >
                    <Mic className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{speech.nativeHint}</TooltipContent>
              </Tooltip>
            ) : null}

            <span
              className="mx-0.5 h-3.5 w-px shrink-0 bg-border/20"
              aria-hidden="true"
            />

            {/* Engine picker */}
            <EnginePickerDropdown
              isProcessing={isProcessing}
              isACPAgent={isACPAgent}
              isCodexAgent={isCodexAgent}
              selectedAgent={selectedAgent ?? null}
              agents={agents ?? []}
              onAgentChange={onAgentChange ?? (() => {})}
              selectedModelId={selectedModelId}
              selectedModelLabel={selectedModel?.label ?? ""}
              modelList={modelList}
              modelsLoading={modelsLoading}
              modelsLoadingText={modelsLoadingText}
              onModelChange={onModelChange}
              claudeEffortOptions={claudeEffortOptions}
              claudeActiveEffort={claudeActiveEffort as ClaudeEffort}
              onClaudeModelEffortChange={onClaudeModelEffortChange}
              codexEffortOptions={codexEffortOptions}
              codexActiveEffort={codexActiveEffort ?? "medium"}
              onCodexEffortChange={onCodexEffortChange}
              showACPConfigOptions={showACPConfigOptions}
              acpConfigOptions={acpConfigOptions}
              acpConfigOptionsLoading={acpConfigOptionsLoading}
              onACPConfigChange={onACPConfigChange}
              lockedEngine={lockedEngine}
              lockedAgentId={lockedAgentId}
              onManageACPs={onManageACPs}
            />

            <span
              className="mx-0.5 h-3.5 w-px shrink-0 bg-border/20"
              aria-hidden="true"
            />

            <EngineControls
              isCodexAgent={isCodexAgent}
              isACPAgent={isACPAgent}
              isProcessing={isProcessing}
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange}
              planMode={planMode}
              onPlanModeChange={onPlanModeChange}
              acpPermissionBehavior={acpPermissionBehavior}
              onAcpPermissionBehaviorChange={onAcpPermissionBehaviorChange}
            />
          </div>

          {/* Right controls */}
          <div className="flex shrink-0 items-center gap-2">
            {contextUsage && contextUsage.contextWindow > 0 && onCompact && (
              <ContextGauge
                contextUsage={contextUsage}
                isCompacting={isCompacting ?? false}
                isProcessing={isProcessing}
                onCompact={onCompact}
              />
            )}
            {isProcessing && (
              <Button
                size="icon"
                variant="ghost"
                onClick={onStop}
                className="h-7 w-7 rounded-full text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
              >
                <Square className="h-3 w-3" />
              </Button>
            )}
            <div className="relative">
              <Button
                size="icon"
                onClick={handleSend}
                disabled={sendDisabled}
                className="h-8 w-8 rounded-full shadow-sm transition-all duration-150 hover:shadow-md active:scale-95 disabled:shadow-none disabled:active:scale-100"
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

      {/* Deep folder confirmation dialog */}
      <ConfirmDialog
        open={showDeepFolderConfirm}
        onOpenChange={setShowDeepFolderConfirm}
        onConfirm={handleDeepFolderConfirm}
        title="Large Context Warning"
        confirmLabel="Send Anyway"
        cancelLabel="Cancel"
        confirmVariant="default"
        description={
          deepFolderInfo && (
            <div className="space-y-2 text-sm">
              <p>
                This deep folder includes{" "}
                <strong>{deepFolderInfo.fileCount} files</strong> totaling{" "}
                <strong>
                  {Math.round(deepFolderInfo.totalSize / 1024)}KB
                </strong>{" "}
                (~
                <strong>
                  {deepFolderInfo.estimatedTokens.toLocaleString()} tokens
                </strong>
                ).
              </p>
              <p className="text-muted-foreground">
                Sending this much content will consume a significant portion
                of the context window and may impact response quality.
              </p>
              {deepFolderInfo.warnings.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <p className="font-medium">
                    Note: Some files will be skipped:
                  </p>
                  <ul className="ms-4 list-disc">
                    {deepFolderInfo.warnings.slice(0, 3).map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                    {deepFolderInfo.warnings.length > 3 && (
                      <li>
                        ... and {deepFolderInfo.warnings.length - 3} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )
        }
      />
    </div>
  );
});
