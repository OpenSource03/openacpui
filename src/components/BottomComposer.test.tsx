import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { BottomComposer } from "./BottomComposer";

vi.mock("./input-bar", () => ({
  InputBar: () => <div data-testid="input-bar">input-bar</div>,
}));

vi.mock("./PermissionPrompt", () => ({
  PermissionPrompt: ({ request }: { request: { requestId: string } }) => (
    <div data-testid="permission-prompt">{request.requestId}</div>
  ),
}));

type BottomComposerProps = ComponentProps<typeof BottomComposer>;

function createProps(
  overrides: Partial<BottomComposerProps> = {},
): BottomComposerProps {
  return {
    pendingPermission: null,
    onRespondPermission: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    isProcessing: false,
    model: "claude-sonnet-4",
    claudeEffort: "high",
    planMode: false,
    permissionMode: "default",
    onModelChange: vi.fn(),
    onClaudeModelEffortChange: vi.fn(),
    onPlanModeChange: vi.fn(),
    onPermissionModeChange: vi.fn(),
    queuedCount: 0,
    ...overrides,
  };
}

describe("BottomComposer", () => {
  it("keeps the input bar mounted when there is no pending permission", () => {
    const html = renderToStaticMarkup(<BottomComposer {...createProps()} />);

    expect(html).toContain("aria-hidden=\"false\"");
    expect(html).toContain("data-testid=\"input-bar\"");
    expect(html).not.toContain("data-testid=\"permission-prompt\"");
  });

  it("keeps the input bar mounted while also rendering the permission prompt", () => {
    const html = renderToStaticMarkup(
      <BottomComposer
        {...createProps({
          pendingPermission: {
            requestId: "req-1",
            toolName: "bash",
            toolInput: {},
            toolUseId: "tool-1",
          },
        })}
      />,
    );

    expect(html).toContain("data-testid=\"permission-prompt\"");
    expect(html).toContain("req-1");
    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("inert=\"\"");
    expect(html).toContain("data-testid=\"input-bar\"");
  });
});
