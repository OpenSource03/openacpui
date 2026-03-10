import type { UIMessage } from "@/types";
import { McpToolContent, hasMcpRenderer } from "../McpToolContent";
import { BashContent } from "./BashContent";
import { WriteContent } from "./WriteContent";
import { EditContent } from "./EditContent";
import { ReadContent } from "./ReadContent";
import { SearchContent } from "./SearchContent";
import { WebSearchContent } from "./WebSearchContent";
import { WebFetchContent } from "./WebFetchContent";
import { TodoWriteContent } from "./TodoWriteContent";
import { EnterPlanModeContent, ExitPlanModeContent } from "./PlanContent";
import { AskUserQuestionContent } from "./AskUserQuestion";
import { GenericContent } from "./GenericContent";
import { ToolSearchContent } from "./ToolSearchContent";
import { SkillContent } from "./SkillContent";

/** Routes a UIMessage to its tool-specific expanded renderer. */
export function ExpandedToolContent({ message }: { message: UIMessage }) {
  switch (message.toolName) {
    case "Bash":
      return <BashContent message={message} />;
    case "Write":
      return <WriteContent message={message} />;
    case "Edit":
      return <EditContent message={message} />;
    case "Read":
      return <ReadContent message={message} />;
    case "Grep":
    case "Glob":
      return <SearchContent message={message} />;
    case "TodoWrite":
      return <TodoWriteContent message={message} />;
    case "EnterPlanMode":
      return <EnterPlanModeContent message={message} />;
    case "ExitPlanMode":
      return <ExitPlanModeContent message={message} />;
    case "WebSearch":
      return <WebSearchContent message={message} />;
    case "WebFetch":
      return <WebFetchContent message={message} />;
    case "AskUserQuestion":
      return <AskUserQuestionContent message={message} />;
    case "ToolSearch":
      return <ToolSearchContent message={message} />;
    case "Skill":
      return <SkillContent message={message} />;
    default:
      // Check for specialized MCP tool renderers
      if (message.toolName && hasMcpRenderer(message.toolName)) {
        const mcpResult = <McpToolContent message={message} />;
        if (mcpResult) return mcpResult;
      }
      return <GenericContent message={message} />;
  }
}
