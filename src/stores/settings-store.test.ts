import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("settings store", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, "localStorage", {
      value: createLocalStorageMock(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats repeated active tool writes with the same contents as a no-op", async () => {
    const { useSettingsStore } = await import("./settings-store");

    useSettingsStore.getState().setActiveTools("project-1", ["tasks"]);
    const firstProjects = useSettingsStore.getState().projects;
    const firstActiveTools = firstProjects["project-1"]?.activeTools;

    useSettingsStore.getState().setActiveTools("project-1", ["tasks"]);
    const secondProjects = useSettingsStore.getState().projects;

    expect(secondProjects).toBe(firstProjects);
    expect(secondProjects["project-1"]?.activeTools).toBe(firstActiveTools);
    expect(secondProjects["project-1"]?.activeTools).toEqual(["tasks"]);
  });
});
