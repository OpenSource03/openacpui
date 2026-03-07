import { describe, expect, it } from "vitest";
import {
  BOTTOM_CHAT_MAX_WIDTH_CLASS,
  CHAT_INPUT_MAX_WIDTH_CLASS,
  MIN_CHAT_WIDTH_FLAT,
  MIN_CHAT_WIDTH_ISLAND,
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
});
