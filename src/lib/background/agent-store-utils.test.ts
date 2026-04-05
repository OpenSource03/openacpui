import { describe, expect, it } from "vitest";
import type { RegistryAgent } from "@/types";
import {
  getPreferredRegistryBinaryTarget,
  getRegistryAgentSetupUrl,
} from "./agent-store-utils";

function makeRegistryAgent(overrides: Partial<RegistryAgent> = {}): RegistryAgent {
  return {
    id: "cursor",
    name: "Cursor",
    version: "0.1.0",
    description: "Test agent",
    authors: ["ACP"],
    license: "MIT",
    distribution: {
      binary: {
        "darwin-aarch64": {
          archive: "https://example.com/darwin-arm64.tar.gz",
          cmd: "./cursor-agent",
          args: ["acp"],
        },
        "darwin-x86_64": {
          archive: "https://example.com/darwin-x64.tar.gz",
          cmd: "./cursor-agent",
          args: ["acp"],
        },
      },
    },
    ...overrides,
  };
}

describe("getPreferredRegistryBinaryTarget", () => {
  it("returns the first matching platform target", () => {
    const agent = makeRegistryAgent();

    expect(getPreferredRegistryBinaryTarget(agent, ["darwin-aarch64"])).toEqual({
      archive: "https://example.com/darwin-arm64.tar.gz",
      cmd: "./cursor-agent",
      args: ["acp"],
    });
  });

  it("returns null when no platform target matches", () => {
    const agent = makeRegistryAgent();

    expect(getPreferredRegistryBinaryTarget(agent, ["linux-x86_64"])).toBeNull();
  });
});

describe("getRegistryAgentSetupUrl", () => {
  it("prefers the platform archive over the repository URL", () => {
    const agent = makeRegistryAgent({
      repository: "https://github.com/example/cursor-agent",
    });

    expect(getRegistryAgentSetupUrl(agent, ["darwin-aarch64"])).toBe(
      "https://example.com/darwin-arm64.tar.gz",
    );
  });

  it("falls back to the repository when no platform archive exists", () => {
    const agent = makeRegistryAgent({
      repository: "https://github.com/example/cursor-agent",
    });

    expect(getRegistryAgentSetupUrl(agent, ["linux-x86_64"])).toBe(
      "https://github.com/example/cursor-agent",
    );
  });

  it("returns null when neither archive nor repository is available", () => {
    const agent = makeRegistryAgent({
      repository: undefined,
    });

    expect(getRegistryAgentSetupUrl(agent, ["linux-x86_64"])).toBeNull();
  });
});
