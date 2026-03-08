import { describe, expect, it } from "vitest";
import {
  appendTerminalHistory,
  EMPTY_TERMINAL_HISTORY,
  readTerminalHistory,
} from "../terminal-history";

describe("terminal history", () => {
  it("accumulates output chunks in order", () => {
    const history = appendTerminalHistory(
      appendTerminalHistory(EMPTY_TERMINAL_HISTORY, "hello "),
      "world",
    );

    expect(readTerminalHistory(history)).toBe("hello world");
  });

  it("drops oldest chunks when the buffer exceeds the limit", () => {
    let history = EMPTY_TERMINAL_HISTORY;
    history = appendTerminalHistory(history, "abc", 5);
    history = appendTerminalHistory(history, "de", 5);
    history = appendTerminalHistory(history, "fg", 5);

    expect(readTerminalHistory(history)).toBe("defg");
  });
});
