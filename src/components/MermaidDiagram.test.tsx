/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import mermaid from "mermaid";
import { MermaidDiagram } from "./MermaidDiagram";

vi.mock("mermaid", () => {
  return {
    default: {
      initialize: vi.fn(),
      render: vi.fn(),
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MermaidDiagram", () => {
  it("renders the mermaid container with header", () => {
    const code = "graph TD\n  A-->B";
    const html = renderToStaticMarkup(<MermaidDiagram code={code} />);

    // Should have the mermaid label in header
    expect(html).toContain("mermaid");
    // Should have the container structure
    expect(html).toContain("not-prose");
    expect(html).toContain("group/code");
  });

  it("includes copy button in header", () => {
    const code = "graph TD\n  A-->B";
    const html = renderToStaticMarkup(<MermaidDiagram code={code} />);

    // CopyButton should be rendered
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover/code:opacity-100");
  });

  it("injects SVG when mermaid render succeeds", async () => {
    const code = "graph TD\n  A-->B";
    // Arrange: mermaid.render succeeds with SVG markup
    const mockedMermaid: any = mermaid;
    mockedMermaid.render.mockResolvedValueOnce({
      svg: "<svg><g>diagram</g></svg>",
    });

    const { container } = render(<MermaidDiagram code={code} />);

    await waitFor(() => {
      expect(container.innerHTML).toContain("<svg");
    });
  });

  it("falls back to showing raw code when mermaid render fails", async () => {
    const code = "graph TD\n  A-->B";
    // Arrange: mermaid.render fails
    const mockedMermaid: any = mermaid;
    mockedMermaid.render.mockRejectedValueOnce(new Error("render failed"));

    const { container } = render(<MermaidDiagram code={code} />);

    await waitFor(() => {
      // Fallback should at least include the original diagram code
      expect(container.textContent || "").toContain("graph TD");
      expect(container.textContent || "").toContain("A-->B");
    });
  });
});
