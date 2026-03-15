import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { MermaidDiagram } from "./MermaidDiagram";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
    setParseErrorHandler: vi.fn(),
  },
}));

vi.mock("@/hooks/useResolvedThemeClass", () => ({
  useResolvedThemeClass: () => "dark",
}));

describe("MermaidDiagram", () => {
  it("renders the mermaid container with header", () => {
    const code = "graph TD\n  A-->B";
    const html = renderToStaticMarkup(<MermaidDiagram code={code} isStreaming={false} />);

    expect(html).toContain("mermaid");
    expect(html).toContain("not-prose");
    expect(html).toContain("group/code");
  });

  it("includes copy button in header", () => {
    const code = "graph TD\n  A-->B";
    const html = renderToStaticMarkup(<MermaidDiagram code={code} isStreaming={false} />);

    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover/code:opacity-100");
  });

  it("shows raw mermaid source while the message is still streaming", () => {
    const code = "graph TD\n  A-->B";
    const html = renderToStaticMarkup(<MermaidDiagram code={code} isStreaming />);
    const mockedMermaid = vi.mocked(mermaid);

    expect(html).toContain("graph TD");
    expect(mockedMermaid.render).not.toHaveBeenCalled();
  });
});
