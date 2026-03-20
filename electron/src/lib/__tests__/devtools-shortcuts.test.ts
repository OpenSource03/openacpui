import { describe, expect, it } from "vitest";
import { isDevToolsShortcut } from "../devtools-shortcuts";

describe("isDevToolsShortcut", () => {
  it("matches F12 on keyDown", () => {
    expect(isDevToolsShortcut({ type: "keyDown", key: "F12" }, "darwin")).toBe(true);
    expect(isDevToolsShortcut({ type: "keyUp", key: "F12" }, "darwin")).toBe(false);
  });

  it("matches Cmd+Alt+I on macOS only when meta is pressed", () => {
    expect(isDevToolsShortcut({ type: "keyDown", key: "i", meta: true, alt: true }, "darwin")).toBe(true);
    expect(isDevToolsShortcut({ type: "keyDown", key: "i", control: true, alt: true }, "darwin")).toBe(false);
  });

  it("matches Ctrl+Alt+I on non-macOS", () => {
    expect(isDevToolsShortcut({ type: "keyDown", key: "I", control: true, alt: true }, "linux")).toBe(true);
    expect(isDevToolsShortcut({ type: "keyDown", key: "I", meta: true, alt: true }, "linux")).toBe(false);
  });

  it("matches Cmd/Ctrl+Shift+J", () => {
    expect(isDevToolsShortcut({ type: "keyDown", key: "j", meta: true, shift: true }, "darwin")).toBe(true);
    expect(isDevToolsShortcut({ type: "keyDown", key: "j", control: true, shift: true }, "win32")).toBe(true);
  });

  it("does not match unrelated combos", () => {
    expect(isDevToolsShortcut({ type: "keyDown", key: "i", meta: true }, "darwin")).toBe(false);
    expect(isDevToolsShortcut({ type: "keyDown", key: "j", meta: true }, "darwin")).toBe(false);
    expect(isDevToolsShortcut({ type: "keyDown", key: "k", meta: true, shift: true }, "darwin")).toBe(false);
  });
});
