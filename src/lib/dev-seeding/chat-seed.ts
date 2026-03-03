import type { UIMessage } from "@/types";

export function buildDevExampleConversation(base = Date.now()): {
  messages: UIMessage[];
  lastMessageAt: number;
} {
  const makeId = (prefix: string, offset: number) => `${prefix}-${base + offset}`;
  const messages: UIMessage[] = [
    {
      id: makeId("user-dev", 1),
      role: "user",
      content: "Run a quick demo: read a file, search for Jira references, do one extra tool step, then show Jira search + issue details.",
      timestamp: base + 1,
    },
    {
      id: makeId("assistant-dev", 2),
      role: "assistant",
      content: "Sure — here is a seeded example turn for renderer development and testing.",
      timestamp: base + 2,
    },
    {
      id: makeId("tool-read-dev", 3),
      role: "tool_call",
      content: "",
      toolName: "Read",
      toolInput: { file_path: "src/components/InputBar.tsx" },
      toolResult: {
        file: {
          filePath: "src/components/InputBar.tsx",
          content: "import { Button } from \"@/components/ui/button\";\nexport const InputBar = memo(function InputBar() {/* ... */});",
          startLine: 1,
          numLines: 2,
          totalLines: 1474,
        },
      },
      timestamp: base + 3,
    },
    {
      id: makeId("tool-search-dev", 4),
      role: "tool_call",
      content: "",
      toolName: "Grep",
      toolInput: { pattern: "Jira|jira", path: "src" },
      toolResult: {
        stdout: "src/components/mcp-renderers/jira.tsx\nsrc/components/McpToolContent.tsx\nsrc/components/mcp-renderers/atlassian.tsx",
      },
      timestamp: base + 4,
    },
    {
      id: makeId("tool-bash-dev", 5),
      role: "tool_call",
      content: "",
      toolName: "Bash",
      toolInput: { command: "pnpm -s test -- --runInBand" },
      toolResult: {
        stdout: "PASS src/components/mcp-renderers/jira.test.tsx\n1 passed, 0 failed",
      },
      timestamp: base + 5,
    },
    {
      id: makeId("tool-jira-search-dev", 6),
      role: "tool_call",
      content: "",
      toolName: "mcp__Atlassian__searchJiraIssuesUsingJql",
      toolInput: { jql: "project = DEMO ORDER BY updated DESC" },
      toolResult: {
        structuredContent: {
          issues: {
            totalCount: 2,
            nodes: [
              {
                key: "DEMO-123",
                fields: {
                  summary: "Seed dev button for chat test data",
                  status: { name: "In Progress" },
                  issuetype: { name: "Task" },
                  priority: { name: "Medium" },
                  assignee: { displayName: "Alex Tester" },
                },
              },
              {
                key: "DEMO-99",
                fields: {
                  summary: "Polish Jira renderer card spacing",
                  status: { name: "To Do" },
                  issuetype: { name: "Bug" },
                  priority: { name: "High" },
                  assignee: { displayName: "Sam QA" },
                },
              },
            ],
          },
        },
      },
      timestamp: base + 6,
    },
    {
      id: makeId("tool-jira-read-dev", 7),
      role: "tool_call",
      content: "",
      toolName: "mcp__Atlassian__getJiraIssue",
      toolInput: { issueIdOrKey: "DEMO-123" },
      toolResult: {
        structuredContent: {
          key: "DEMO-123",
          webUrl: "https://example.atlassian.net/browse/DEMO-123",
          fields: {
            summary: "Seed dev button for chat test data",
            status: { name: "In Progress" },
            issuetype: { name: "Task" },
            priority: { name: "Medium" },
            assignee: { displayName: "Alex Tester" },
            created: "2026-02-24T09:30:00.000Z",
            description: "Implement a tiny development-only button that injects sample read/search/Jira tool messages.",
          },
        },
      },
      timestamp: base + 7,
    },
    {
      id: makeId("assistant-dev-final", 8),
      role: "assistant",
      content: "Done. The chat now includes sample Read/Grep/Bash tool calls and Jira search + issue detail examples for renderer testing.",
      timestamp: base + 8,
    },
  ];

  return {
    messages,
    lastMessageAt: base + 8,
  };
}
