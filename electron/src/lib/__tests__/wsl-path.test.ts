import { describe, expect, it } from "vitest";
import { getLikelyWslHome, maybeToWslPath, parseWslPath, getWslWindowsPrefix } from "../wsl-path";

describe("wsl path helpers", () => {
  it("parses UNC WSL paths into distro and unix paths", () => {
    const info = parseWslPath("\\\\wsl$\\Ubuntu\\home\\user\\project");
    expect(info).toEqual({ distro: "Ubuntu", unixPath: "/home/user/project" });

    const localhost = parseWslPath("//wsl.localhost/Ubuntu/home/user/project");
    expect(localhost).toEqual({ distro: "Ubuntu", unixPath: "/home/user/project" });
  });

  it("returns the original path when not a WSL UNC path", () => {
    expect(maybeToWslPath("C:\\\\Users\\\\tester")).toBe("C:\\\\Users\\\\tester");
    expect(maybeToWslPath(undefined)).toBeUndefined();
  });

  it("guesses the user home directory from a WSL path", () => {
    expect(getLikelyWslHome("/home/alice/code")).toBe("/home/alice");
    expect(getLikelyWslHome("/var/www")).toBe("/root");
  });

  it("builds the UNC prefix for a distro using wsl.localhost", () => {
    expect(getWslWindowsPrefix("Ubuntu")).toBe("\\\\wsl.localhost\\Ubuntu");
  });
});
