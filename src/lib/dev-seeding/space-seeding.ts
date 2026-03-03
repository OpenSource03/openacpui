import type { Project, UIMessage } from "@/types";

interface ConversationSeed {
  title: string;
  objective: string;
  constraints: string[];
  acceptance: string[];
}

interface ProjectSeed {
  name: string;
  conversations: ConversationSeed[];
}

interface SessionSavePayload {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  messages: UIMessage[];
  totalCost: number;
}

export interface DevSpaceSeedingDeps {
  activeSpaceId: string;
  existingProjects: Project[];
  createDevProject: (name: string, spaceId?: string) => Promise<Project | null>;
  saveSession: (data: SessionSavePayload) => Promise<{ ok?: boolean; error?: string }>;
  refreshSessions: (projectIds: string[]) => Promise<void>;
}

const DEV_PROJECT_SEEDS: ProjectSeed[] = [
  {
    name: "Example Web App",
    conversations: [
      {
        title: "Onboarding flow hardening",
        objective: "Stabilize first-run onboarding with clear states and retries.",
        constraints: ["Keep optimistic UI behavior", "No visual redesign", "Preserve telemetry schema"],
        acceptance: ["No duplicate onboarding records", "Retry is idempotent", "Error copy is actionable"],
      },
      {
        title: "Settings validation pass",
        objective: "Tighten validation and inline error messages for settings edits.",
        constraints: ["Reuse shared validators", "No new dependencies", "Keep keyboard navigation"],
        acceptance: ["All invalid fields surface specific errors", "Submit disabled only when invalid", "Tests cover edge inputs"],
      },
      {
        title: "Dashboard data loading",
        objective: "Reduce dashboard loading jank while preserving correctness.",
        constraints: ["No API contract changes", "Respect cache invalidation", "Avoid stale flashes"],
        acceptance: ["Skeleton only for first load", "Background refresh does not flicker", "Manual refresh remains available"],
      },
      {
        title: "Notification center cleanup",
        objective: "Normalize notification rendering and dismissal behavior.",
        constraints: ["Keep existing notification types", "No global state rewrite", "Respect unread counts"],
        acceptance: ["Dismiss + undo work reliably", "Unread badge matches list", "Sorting is deterministic"],
      },
      {
        title: "Search result relevance tune",
        objective: "Improve perceived relevance for mixed project content search.",
        constraints: ["Client-side ranking only", "No backend changes", "Maintain current query syntax"],
        acceptance: ["Prefix hits prioritize top", "Recent interactions boost ranking", "No regression for exact matches"],
      },
      {
        title: "Release prep checklist",
        objective: "Prepare release branch readiness checks and rollout notes.",
        constraints: ["Use existing CI workflows", "No forced branch policies", "Plain-language notes"],
        acceptance: ["Checklist covers rollback path", "Known risks documented", "Verification steps reproducible"],
      },
      {
        title: "Accessibility review sprint",
        objective: "Address core keyboard/screen-reader gaps in primary views.",
        constraints: ["No major layout churn", "Preserve shortcuts", "Keep dark-mode contrast standards"],
        acceptance: ["All dialogs trap focus correctly", "Icon-only actions have labels", "Tab order is predictable"],
      },
    ],
  },
  {
    name: "Example API Service",
    conversations: [
      {
        title: "Idempotent write endpoints",
        objective: "Implement safe idempotency keys for create/update endpoints.",
        constraints: ["Backward compatible defaults", "No distributed lock service", "Preserve current SLA"],
        acceptance: ["Replay returns original result", "Expired keys handled clearly", "Metrics track replay count"],
      },
      {
        title: "Error taxonomy alignment",
        objective: "Standardize service errors and mapping to HTTP responses.",
        constraints: ["Do not leak internal traces", "Keep existing client error codes", "Avoid broad catch-all"],
        acceptance: ["All error classes map deterministically", "Correlation IDs included", "Docs updated for consumers"],
      },
      {
        title: "Rate limit strategy revision",
        objective: "Refine rate limiting to reduce false positives for bursty clients.",
        constraints: ["No per-user database writes", "Configurable by endpoint group", "Preserve abuse protections"],
        acceptance: ["Burst traffic handled gracefully", "Abuse paths still blocked", "Headers expose limit context"],
      },
      {
        title: "Background job resiliency",
        objective: "Improve retry and dead-letter handling for job processor.",
        constraints: ["Keep existing queue backend", "No silent drop of failed jobs", "Minimal migration risk"],
        acceptance: ["Exponential backoff implemented", "Poison jobs land in DLQ", "Operator runbook updated"],
      },
      {
        title: "Audit log consistency",
        objective: "Ensure key entity actions emit complete audit records.",
        constraints: ["Do not log sensitive payloads", "Preserve event names", "No breaking schema changes"],
        acceptance: ["Create/update/delete all audited", "Actor identity always present", "Timestamp precision normalized"],
      },
      {
        title: "Service dependency timeout audit",
        objective: "Tune upstream timeout/retry budgets across integrations.",
        constraints: ["Fail fast over hanging calls", "Avoid retry storms", "Maintain availability target"],
        acceptance: ["Timeouts per dependency documented", "Circuit-breaker thresholds validated", "Load test confirms stability"],
      },
      {
        title: "OpenAPI quality pass",
        objective: "Polish OpenAPI docs for clearer request/response examples.",
        constraints: ["No endpoint removals", "Schema names remain stable", "Examples based on realistic payloads"],
        acceptance: ["Every endpoint has example pair", "Error responses documented", "Generated clients unchanged"],
      },
    ],
  },
  {
    name: "Example Desktop Client",
    conversations: [
      {
        title: "Multi-session reliability",
        objective: "Reduce race conditions when switching rapidly between sessions.",
        constraints: ["No full architecture rewrite", "Preserve draft behavior", "Do not lose queued messages"],
        acceptance: ["Session switch is deterministic", "Queued messages remain scoped", "No stale spinner leaks"],
      },
      {
        title: "Tool panel persistence",
        objective: "Keep terminal/browser/tool panels stable across UI toggles.",
        constraints: ["No process restarts on hide/show", "Respect split ratios", "Keyboard shortcuts unchanged"],
        acceptance: ["Panel state survives toggle", "Terminal fit remains correct", "Browser session context persists"],
      },
      {
        title: "Permission prompt UX polish",
        objective: "Clarify permission prompts and background notification flow.",
        constraints: ["No reduction in safety checks", "Keep current policy model", "No hidden auto-approve"],
        acceptance: ["Prompt context is specific", "Background alerts route correctly", "Decision state always visible"],
      },
      {
        title: "Model picker consistency",
        objective: "Unify model picker behavior across Claude/Codex/ACP engines.",
        constraints: ["Keep engine-specific capabilities", "No settings migration breakage", "Retain current defaults"],
        acceptance: ["Selection labels are consistent", "Invalid model values auto-resolve", "Session-scoped persistence works"],
      },
      {
        title: "Markdown rendering stress pass",
        objective: "Validate rendering for long markdown + code blocks + diffs.",
        constraints: ["No replacement of renderer stack", "Maintain syntax highlighting", "Avoid layout thrash"],
        acceptance: ["Long messages remain responsive", "Code fences render reliably", "Diff view stays readable"],
      },
      {
        title: "Workspace navigation refinement",
        objective: "Improve file mention navigation and context chip behavior.",
        constraints: ["No removal of mention chips", "Keep fuzzy search logic", "Preserve keyboard shortcuts"],
        acceptance: ["Mention popup is predictable", "Selected chips serialize correctly", "Duplicate mentions prevented"],
      },
      {
        title: "Release candidate shakeout",
        objective: "Run end-to-end sanity checks and document release blockers.",
        constraints: ["No speculative refactors", "Track blockers by severity", "Keep notes actionable"],
        acceptance: ["Critical flows verified", "Blockers include repro steps", "Go/no-go summary is clear"],
      },
    ],
  },
];

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "seed";
}

function buildConversationMessages(
  project: Project,
  seed: ConversationSeed,
  convoIndex: number,
  createdAt: number,
): UIMessage[] {
  const sessionPrefix = `dev-${slugify(project.name)}-${convoIndex + 1}`;
  const checkpoints = [
    {
      user: `Let's run a careful work session on "${seed.title}" for ${project.name}. Goal: ${seed.objective}`,
      assistant: `Great. I'll keep this scoped, deterministic, and production-safe.\n\nWorking assumptions:\n- ${seed.constraints[0]}\n- ${seed.constraints[1]}\n- ${seed.constraints[2]}`,
    },
    {
      user: "Start with a risk scan and propose an implementation path before touching anything.",
      assistant: `Risk scan complete. Primary risks are state drift, partial writes, and ambiguous recovery paths.\n\nProposed path:\n1) Establish baseline behavior.\n2) Add focused guards and state transitions.\n3) Verify with scenario checks before rollout.`,
    },
    {
      user: "What should be the smallest first increment?",
      assistant: "First increment: isolate the critical state transitions and make them explicit with invariant checks.\nThis reduces accidental regressions before we optimize anything else.",
    },
    {
      user: "Apply that increment and call out what changed logically.",
      assistant: "Applied. The flow now validates preconditions before mutation and records a deterministic terminal state for failures.\nNo behavior-expanded shortcuts were added.",
    },
    {
      user: "Add stronger observability while keeping logs concise.",
      assistant: "Added structured checkpoints at transition boundaries with correlation context.\nLogs avoid payload leakage and focus on phase, decision, and outcome.",
    },
    {
      user: "Walk through an unhappy-path example end to end.",
      assistant: "Unhappy path walkthrough:\n- Invalid precondition detected.\n- Transition blocked before write.\n- User-visible error remains actionable.\n- System stays recoverable without manual cleanup.",
    },
    {
      user: "Now verify we did not regress the happy path.",
      assistant: "Happy path remains intact. Latency impact is negligible, and output shape is unchanged for valid requests.",
    },
    {
      user: "Let's address test coverage next. What scenarios matter most?",
      assistant: `Priority scenarios:\n- Standard flow success.\n- Boundary value handling.\n- Retry/idempotency behavior.\n- Partial-failure recovery.\n- ${seed.acceptance[0]}.`,
    },
    {
      user: "Draft the high-value assertions and expected outputs.",
      assistant: `Assertions drafted around deterministic transitions and observable outcomes.\nExpected outputs now explicitly include:\n- Stable status codes/messages.\n- Consistent metadata for retries.\n- Correct acceptance criteria checks.`,
    },
    {
      user: "I want stronger edge-case handling around timing and ordering.",
      assistant: "Added ordering guards so stale operations cannot overwrite newer state.\nTiming-related retries now validate freshness before commit.",
    },
    {
      user: "Can we tighten user-facing error copy for faster triage?",
      assistant: "Yes. Error copy now distinguishes validation, dependency, and policy failures.\nEach message includes next-step guidance without exposing internals.",
    },
    {
      user: "Document explicit non-goals so we don't overreach.",
      assistant: "Non-goals documented: no architecture migration, no schema churn, and no speculative UI redesign.\nScope remains strictly aligned to this workstream.",
    },
    {
      user: "Before wrapping, do a brief security and privacy pass.",
      assistant: "Security/privacy pass complete: no new sensitive fields persisted, no unsafe interpolation paths added, and no privilege model changes introduced.",
    },
    {
      user: "Summarize validation against acceptance criteria.",
      assistant: `Acceptance validation:\n- ${seed.acceptance[0]} ✅\n- ${seed.acceptance[1]} ✅\n- ${seed.acceptance[2]} ✅`,
    },
    {
      user: "Give me rollout guidance plus rollback triggers.",
      assistant: "Rollout: gradual exposure with monitoring on transition failures and retry spikes.\nRollback triggers: elevated failure ratio, invariant breach frequency, or degraded completion latency.",
    },
    {
      user: "Final recap with next concrete follow-ups.",
      assistant: `Completed "${seed.title}" with a behavior-safe implementation path.\nFollow-ups:\n1) Keep watch on production telemetry for one release cycle.\n2) Fold lessons into adjacent flows.\n3) Re-run this review after the next dependency update.`,
    },
  ];

  let ts = createdAt + 1;
  return checkpoints.flatMap((step, idx) => {
    const userId = `${sessionPrefix}-u-${idx + 1}`;
    const assistantId = `${sessionPrefix}-a-${idx + 1}`;
    return [
      { id: userId, role: "user", content: step.user, timestamp: ts++ } as UIMessage,
      { id: assistantId, role: "assistant", content: step.assistant, timestamp: ts++ } as UIMessage,
    ];
  });
}

export async function seedDevExampleSpaceData(deps: DevSpaceSeedingDeps): Promise<void> {
  const targetSpaceId = deps.activeSpaceId === "default" ? "default" : deps.activeSpaceId;
  const currentSpaceProjects = deps.existingProjects.filter(
    (p) => (p.spaceId || "default") === targetSpaceId,
  );

  const sampleProjects: Project[] = [];
  for (const projectSeed of DEV_PROJECT_SEEDS) {
    const existing = currentSpaceProjects.find((p) => p.name === projectSeed.name);
    if (existing) {
      sampleProjects.push(existing);
      continue;
    }
    const created = await deps.createDevProject(projectSeed.name, targetSpaceId);
    if (!created) {
      throw new Error(`Failed to create dev project "${projectSeed.name}"`);
    }
    sampleProjects.push(created);
  }

  const seededProjectIds = new Set<string>();
  const base = Date.now();
  let convoCounter = 0;

  for (let projectIdx = 0; projectIdx < DEV_PROJECT_SEEDS.length; projectIdx++) {
    const projectSeed = DEV_PROJECT_SEEDS[projectIdx];
    const project = sampleProjects[projectIdx];
    seededProjectIds.add(project.id);

    for (let convoIdx = 0; convoIdx < projectSeed.conversations.length; convoIdx++) {
      const conversation = projectSeed.conversations[convoIdx];
      const createdAt = base + convoCounter * 1000;
      const sessionId = `dev-space-${project.id}-${convoIdx + 1}`;
      const messages = buildConversationMessages(project, conversation, convoIdx, createdAt);
      const saveResult = await deps.saveSession({
        id: sessionId,
        projectId: project.id,
        title: conversation.title,
        createdAt,
        messages,
        totalCost: 0,
      });
      if (saveResult?.error) {
        throw new Error(`Failed to save seeded session "${conversation.title}": ${saveResult.error}`);
      }
      convoCounter++;
    }
  }

  await deps.refreshSessions([...seededProjectIds]);
}
