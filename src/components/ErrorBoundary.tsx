import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { posthog } from "@/lib/posthog";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Root error boundary — catches unhandled React errors and shows a visible
 * fallback instead of a blank/transparent window. Especially important in
 * Electron where a transparent frameless window makes crashes invisible.
 *
 * Also captures exceptions to PostHog for error tracking (respects the
 * analytics opt-in/out setting via posthog-js opt_out state).
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);

    // Capture to PostHog error tracking (no-ops if user has opted out)
    try {
      posthog.captureException(error, {
        componentStack: info.componentStack ?? undefined,
      });
    } catch {
      // Analytics should never break the error boundary
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        className="drag-region"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          padding: "2rem",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#18181b",
          color: "#e4e4e7",
        }}
      >
        <div
          className="no-drag"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            maxWidth: "600px",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Something went wrong
          </h1>
          <pre
            style={{
              fontSize: "0.8rem",
              color: "#a1a1aa",
              maxWidth: "600px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1.25rem",
              fontSize: "0.85rem",
              borderRadius: "0.375rem",
              border: "1px solid #3f3f46",
              background: "#27272a",
              color: "#e4e4e7",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
