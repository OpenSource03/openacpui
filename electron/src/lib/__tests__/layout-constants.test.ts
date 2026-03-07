import { describe, expect, it } from "vitest";
import {
  APP_SIDEBAR_WIDTH,
  BOTTOM_CHAT_MAX_WIDTH_CLASS,
  CHAT_INPUT_MAX_WIDTH_CLASS,
  ISLAND_LAYOUT_MARGIN,
  MIN_CHAT_WIDTH_FLAT,
  MIN_CHAT_WIDTH_ISLAND,
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
    expect(APP_SIDEBAR_WIDTH).toBe(260);
    expect(ISLAND_LAYOUT_MARGIN).toBe(16);
    expect(WINDOWS_FRAME_BUFFER_WIDTH).toBe(16);
    expect(getBootstrapMinWindowWidth("darwin")).toBe(1664);
    expect(getBootstrapMinWindowWidth("win32")).toBe(1680);
  });
});
