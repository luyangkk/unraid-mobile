import { describe, expect, it } from "vitest";
import {
  containerGroup,
  containerStateLabel,
  formatContainerUptime,
  readRunningCollapsed,
  saveRunningCollapsed,
} from "./docker";

describe("container presentation", () => {
  it("keeps paused/restarting/unknown states out of the stopped group", () => {
    expect(containerGroup("running")).toBe("running");
    for (const state of ["exited", "created", "dead"])
      expect(containerGroup(state)).toBe("stopped");
    for (const state of ["paused", "restarting", "removing", "unknown"])
      expect(containerGroup(state)).toBe("other");
    expect(containerStateLabel("paused")).toBe("Paused");
    expect(containerStateLabel("")).toBe("Unknown");
  });

  it("formats real uptime and shows unknown rather than zero for missing values", () => {
    expect(formatContainerUptime(1562400)).toBe("18d 2h");
    expect(formatContainerUptime(3660)).toBe("1h 1m");
    expect(formatContainerUptime(120)).toBe("2m");
    expect(formatContainerUptime(0)).toBe("<1m");
    expect(formatContainerUptime(null)).toBe("—");
  });
});

describe("Running collapse preference", () => {
  it("roundtrips the UI preference without storing server data", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(readRunningCollapsed(storage)).toBe(false);
    saveRunningCollapsed(true, storage);
    expect(readRunningCollapsed(storage)).toBe(true);
    saveRunningCollapsed(false, storage);
    expect(readRunningCollapsed(storage)).toBe(false);
    expect(values.size).toBe(1);
  });

  it("remains usable when browser storage access is denied", () => {
    const storage = {
      getItem: () => { throw new Error("Access denied"); },
      setItem: () => { throw new Error("Access denied"); },
    };
    expect(readRunningCollapsed(storage)).toBe(false);
    expect(() => saveRunningCollapsed(true, storage)).not.toThrow();
  });
});
