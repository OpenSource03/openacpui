import { memo, useState, useCallback } from "react";
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  X,
  Terminal,
  Shield,
  ClipboardPaste,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IconPicker } from "@/components/IconPicker";
import { AgentIcon } from "@/components/AgentIcon";
import { AgentStore } from "@/components/settings/AgentStore";
import type { AgentDefinition } from "@/types";

// ── Types ──

interface AgentSettingsProps {
  agents: AgentDefinition[];
  onSave: (agent: AgentDefinition) => Promise<{ ok?: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok?: boolean; error?: string }>;
}

interface FormState {
  id: string;
  name: string;
  binary: string;
  args: string;
  envPairs: Array<{ key: string; value: string }>;
  icon: string;
  iconType: "emoji" | "lucide";
}

interface FormErrors {
  id?: string;
  name?: string;
  binary?: string;
  general?: string;
}

// ── Helpers ──

function emptyForm(): FormState {
  return { id: "", name: "", binary: "", args: "", envPairs: [], icon: "", iconType: "lucide" };
}

/** Try to parse a JSON agent definition (single object or first element of array). */
function tryParseAgentJson(text: string): FormState | null {
  try {
    const parsed = JSON.parse(text);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!obj || typeof obj !== "object" || !obj.id) return null;
    return {
      id: String(obj.id ?? ""),
      name: String(obj.name ?? ""),
      binary: String(obj.binary ?? ""),
      args: Array.isArray(obj.args) ? obj.args.join(" ") : "",
      envPairs: obj.env && typeof obj.env === "object"
        ? Object.entries(obj.env as Record<string, string>).map(([key, value]) => ({ key, value: String(value) }))
        : [],
      icon: String(obj.icon ?? ""),
      iconType: "lucide",
    };
  } catch {
    return null;
  }
}

function agentToForm(agent: AgentDefinition): FormState {
  // Detect if the stored icon looks like an emoji (starts with a non-ASCII char)
  const isEmoji = agent.icon ? /^\p{Emoji}/u.test(agent.icon) : false;
  return {
    id: agent.id,
    name: agent.name,
    binary: agent.binary ?? "",
    args: agent.args?.join(" ") ?? "",
    envPairs: agent.env
      ? Object.entries(agent.env).map(([key, value]) => ({ key, value }))
      : [],
    icon: agent.icon ?? "",
    iconType: isEmoji ? "emoji" : "lucide",
  };
}

// ── Agent Card ──

const AgentCard = memo(function AgentCard({
  agent,
  onEdit,
  onDelete,
}: {
  agent: AgentDefinition;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isBuiltIn = agent.builtIn === true;

  return (
    <div
      className={`group flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
        isBuiltIn
          ? "border-foreground/[0.04] bg-foreground/[0.02]"
          : "border-foreground/[0.06] hover:border-foreground/[0.1]"
      }`}
    >
      {/* Icon */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/40 text-foreground/60">
        <AgentIcon icon={agent.icon} />
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {agent.name}
          </span>
          {isBuiltIn && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Shield className="h-2.5 w-2.5" />
              Built-in
            </Badge>
          )}
        </div>
        <span className="font-mono text-xs text-muted-foreground">{agent.id}</span>
        {agent.binary && (
          <div className="mt-0.5 flex items-center gap-1 truncate">
            <Terminal className="h-3 w-3 shrink-0 text-muted-foreground/50" />
            <span className="truncate font-mono text-[11px] text-muted-foreground/70">
              {agent.binary} {agent.args?.join(" ")}
            </span>
          </div>
        )}
      </div>

      {/* Actions — hidden for built-in agents */}
      {!isBuiltIn && (
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={onEdit}>
                <Pencil className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Delete</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

// ── Agent Form ──

function AgentForm({
  initial,
  isEditing,
  existingIds,
  onSave,
  onCancel,
}: {
  initial: FormState;
  isEditing: boolean;
  existingIds: Set<string>;
  onSave: (agent: AgentDefinition) => Promise<{ ok?: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear field error on change
    setErrors((prev) => ({ ...prev, [key]: undefined, general: undefined }));
  }, []);

  const validate = useCallback((): FormErrors => {
    const e: FormErrors = {};
    const id = form.id.trim();
    const name = form.name.trim();

    if (!id) e.id = "ID is required";
    else if (id === "claude-code") e.id = "This ID is reserved";
    else if (!isEditing && existingIds.has(id)) e.id = "An agent with this ID already exists";

    if (!name) e.name = "Name is required";

    if (!form.binary.trim()) {
      e.binary = "Binary command is required";
    }

    return e;
  }, [form, isEditing, existingIds]);

  const handleSave = useCallback(async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSaving(true);
    try {
      const agent: AgentDefinition = {
        id: form.id.trim(),
        name: form.name.trim(),
        engine: "acp",
        binary: form.binary.trim(),
        args: form.args.trim() ? form.args.trim().split(/\s+/) : undefined,
        env:
          form.envPairs.length > 0
            ? Object.fromEntries(
                form.envPairs
                  .filter((p) => p.key.trim())
                  .map((p) => [p.key.trim(), p.value]),
              )
            : undefined,
        icon: form.icon.trim() || undefined,
      };

      const result = await onSave(agent);
      if (result.ok) {
        onCancel(); // Close form on success
      } else {
        setErrors({ general: result.error ?? "Failed to save agent" });
      }
    } finally {
      setSaving(false);
    }
  }, [form, validate, onSave, onCancel]);

  const addEnvPair = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      envPairs: [...prev.envPairs, { key: "", value: "" }],
    }));
  }, []);

  const removeEnvPair = useCallback((index: number) => {
    setForm((prev) => ({
      ...prev,
      envPairs: prev.envPairs.filter((_, i) => i !== index),
    }));
  }, []);

  const updateEnvPair = useCallback((index: number, field: "key" | "value", value: string) => {
    setForm((prev) => ({
      ...prev,
      envPairs: prev.envPairs.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    }));
  }, []);

  const handlePasteJson = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = tryParseAgentJson(text);
      if (parsed) {
        setForm(parsed);
        setErrors({});
      } else {
        setErrors({ general: "Clipboard doesn't contain a valid agent JSON" });
      }
    } catch {
      setErrors({ general: "Could not read clipboard" });
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Form header */}
      <div className="flex items-center gap-3 border-b border-foreground/[0.06] px-6 py-4">
        <Button variant="ghost" size="icon-xs" onClick={onCancel}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <h2 className="flex-1 text-base font-semibold text-foreground">
          {isEditing ? "Edit Agent" : "Add Agent"}
        </h2>
        {/* Paste JSON to auto-fill */}
        {!isEditing && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={handlePasteJson} className="gap-1.5 text-xs">
                <ClipboardPaste className="h-3 w-3" />
                Paste JSON
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[220px] text-xs">
              Paste an agent definition from agents.json to auto-fill the form
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Scrollable form body */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-6 py-5">
          {/* General error */}
          {errors.general && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errors.general}
            </div>
          )}

          {/* ID */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              ID <span className="text-destructive">*</span>
            </label>
            <Input
              value={form.id}
              onChange={(e) => updateField("id", e.target.value)}
              placeholder="my-agent"
              disabled={isEditing}
              className={isEditing ? "opacity-60" : ""}
              aria-invalid={!!errors.id}
            />
            {errors.id && <p className="text-xs text-destructive">{errors.id}</p>}
            {isEditing && (
              <p className="text-[11px] text-muted-foreground/60">Agent ID cannot be changed after creation</p>
            )}
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="My Custom Agent"
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          {/* Binary */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Binary <span className="text-destructive">*</span>
            </label>
            <Input
              value={form.binary}
              onChange={(e) => updateField("binary", e.target.value)}
              placeholder="npx"
              className="font-mono"
              aria-invalid={!!errors.binary}
            />
            {errors.binary && <p className="text-xs text-destructive">{errors.binary}</p>}
            <p className="text-[11px] text-muted-foreground/60">
              Command to spawn the ACP agent process
            </p>
          </div>

          {/* Arguments */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Arguments
            </label>
            <Input
              value={form.args}
              onChange={(e) => updateField("args", e.target.value)}
              placeholder="@scope/package --flag"
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground/60">
              Space-separated command arguments
            </p>
          </div>

          {/* Environment variables */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Environment Variables
            </label>
            <div className="space-y-2">
              {form.envPairs.map((pair, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={pair.key}
                    onChange={(e) => updateEnvPair(i, "key", e.target.value)}
                    placeholder="KEY"
                    className="flex-1 font-mono"
                  />
                  <span className="text-xs text-muted-foreground/40">=</span>
                  <Input
                    value={pair.value}
                    onChange={(e) => updateEnvPair(i, "value", e.target.value)}
                    placeholder="value"
                    className="flex-1 font-mono"
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeEnvPair(i)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={addEnvPair}
                className="text-xs"
              >
                <Plus className="h-3 w-3" />
                Add variable
              </Button>
            </div>
          </div>

          {/* Icon */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Icon
            </label>
            <IconPicker
              value={form.icon}
              iconType={form.iconType}
              onChange={(icon, type) => {
                setForm((prev) => ({ ...prev, icon, iconType: type }));
                setErrors((prev) => ({ ...prev, general: undefined }));
              }}
            />
          </div>
        </div>
      </ScrollArea>

      {/* Form footer */}
      <div className="flex items-center justify-end gap-2 border-t border-foreground/[0.06] px-6 py-3">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : isEditing ? "Save Changes" : "Add Agent"}
        </Button>
      </div>
    </div>
  );
}

// ── Main Component ──

export const AgentSettings = memo(function AgentSettings({
  agents,
  onSave,
  onDelete,
}: AgentSettingsProps) {
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const existingIds = new Set(agents.map((a) => a.id));
  const deleteAgent = agents.find((a) => a.id === deleteConfirmId);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirmId) return;
    await onDelete(deleteConfirmId);
    setDeleteConfirmId(null);
  }, [deleteConfirmId, onDelete]);

  // Show form view when creating or editing (replaces entire view, no tabs)
  if (isCreating) {
    return (
      <AgentForm
        initial={emptyForm()}
        isEditing={false}
        existingIds={existingIds}
        onSave={onSave}
        onCancel={() => setIsCreating(false)}
      />
    );
  }

  if (editingAgent) {
    return (
      <AgentForm
        initial={agentToForm(editingAgent)}
        isEditing={true}
        existingIds={existingIds}
        onSave={onSave}
        onCancel={() => setEditingAgent(null)}
      />
    );
  }

  // Sort: built-in first, then alphabetical
  const sorted = [...agents].sort((a, b) => {
    if (a.builtIn && !b.builtIn) return -1;
    if (!a.builtIn && b.builtIn) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex h-full flex-col">
      <Tabs defaultValue="store" className="flex min-h-0 flex-1 flex-col">
        {/* Header: title + description + tabs in one bordered section */}
        <div className="border-b border-foreground/[0.06] px-6">
          <div className="py-4">
            <h2 className="text-base font-semibold text-foreground">ACP Agents</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Browse the agent store or manage your installed agents
            </p>
          </div>
          <TabsList variant="line">
            <TabsTrigger value="store" className="gap-1.5">
              <Store className="h-3.5 w-3.5" />
              Agent Store
            </TabsTrigger>
            <TabsTrigger value="my-agents" className="gap-1.5">
              <Bot className="h-3.5 w-3.5" />
              My Agents
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Store tab */}
        <TabsContent value="store" className="min-h-0 flex-1">
          <AgentStore
            installedAgents={agents}
            onInstall={onSave}
            onUninstall={onDelete}
          />
        </TabsContent>

        {/* My Agents tab */}
        <TabsContent value="my-agents" className="min-h-0 flex-1">
          <div className="flex h-full flex-col">
            {/* Add Agent button bar */}
            <div className="flex items-center justify-end px-6 py-3">
              <Button size="sm" onClick={() => setIsCreating(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add Agent
              </Button>
            </div>

            {/* Agent list */}
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2 px-6 pb-4">
                {sorted.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onEdit={() => setEditingAgent(agent)}
                    onDelete={() => setDeleteConfirmId(agent.id)}
                  />
                ))}
                {agents.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Bot className="h-8 w-8 text-muted-foreground/30" />
                    <p className="mt-3 text-sm text-muted-foreground">No agents configured</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Add an ACP agent from the store or manually
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-medium text-foreground">{deleteAgent?.name}</span>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
