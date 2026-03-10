import { describe, expect, it } from "vitest";
import {
  APP_SIDEBAR_WIDTH,
  BOTTOM_CHAT_MAX_WIDTH_CLASS,
  CHAT_INPUT_MAX_WIDTH_CLASS,
  ISLAND_CONTROL_RADIUS,
  ISLAND_PANEL_GAP,
  ISLAND_LAYOUT_MARGIN,
  ISLAND_RADIUS,
  ISLAND_SHELL_GAP,
  MIN_CHAT_WIDTH_FLAT,
  MIN_CHAT_WIDTH_ISLAND,
  RESIZE_HANDLE_WIDTH_ISLAND,
  TOOL_PICKER_WIDTH_ISLAND,
  WINDOWS_FRAME_BUFFER_WIDTH,
  getBootstrapMinWindowWidth,
  getMinChatWidth,
} from "../../../../src/lib/layout-constants";

describe("layout constants", () => {
  it("keeps island mode chat width aligned with flat mode", () => {
    expect(MIN_CHAT_WIDTH_ISLAND).toBe(MIN_CHAT_WIDTH_FLAT);
    expect(getMinChatWidth(true)).toBe(getMinChatWidth(false));
  });

  it("uses the shared wider chat input width class", () => {
    expect(BOTTOM_CHAT_MAX_WIDTH_CLASS).toBe("max-w-[61.5rem]");
    expect(CHAT_INPUT_MAX_WIDTH_CLASS).toBe("max-w-[61.5rem]");
    expect(CHAT_INPUT_MAX_WIDTH_CLASS).toBe(BOTTOM_CHAT_MAX_WIDTH_CLASS);
  });

  it("computes the bootstrap window minimum width for each platform", () => {
    expect(APP_SIDEBAR_WIDTH).toBe(280);
    expect(ISLAND_SHELL_GAP).toBe(6);
    expect(ISLAND_PANEL_GAP).toBe(4);
    expect(ISLAND_LAYOUT_MARGIN).toBe(12);
    expect(ISLAND_RADIUS).toBe(12);
    expect(ISLAND_CONTROL_RADIUS).toBe(11);
    expect(TOOL_PICKER_WIDTH_ISLAND).toBe(58);
    expect(RESIZE_HANDLE_WIDTH_ISLAND).toBe(4);
    expect(WINDOWS_FRAME_BUFFER_WIDTH).toBe(16);
    expect(getBootstrapMinWindowWidth("darwin")).toBe(1666);
    expect(getBootstrapMinWindowWidth("win32")).toBe(1682);
  });
});
