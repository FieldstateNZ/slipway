import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { SETTINGS_STORAGE_KEY, SettingsProvider, useSettings } from "./settings";

vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: vi.fn().mockResolvedValue(undefined),
  disable: vi.fn().mockResolvedValue(undefined),
  isEnabled: vi.fn().mockResolvedValue(false),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("sw-reduced-motion");
});

describe("SettingsProvider", () => {
  it("defaults to reducedMotion=false, keyHints=true, launchAtLogin=false", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.reducedMotion).toBe(false);
    expect(result.current.keyHints).toBe(true);
    expect(result.current.launchAtLogin).toBe(false);
  });

  it("persists changes and restores them in a fresh provider", () => {
    const first = renderHook(() => useSettings(), { wrapper });
    act(() => {
      first.result.current.setReducedMotion(true);
      first.result.current.setKeyHints(false);
      first.result.current.setLaunchAtLogin(true);
    });
    first.unmount();

    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual({
      reducedMotion: true,
      keyHints: false,
      launchAtLogin: true,
    });

    const second = renderHook(() => useSettings(), { wrapper });
    expect(second.result.current.reducedMotion).toBe(true);
    expect(second.result.current.keyHints).toBe(false);
    expect(second.result.current.launchAtLogin).toBe(true);
  });

  it("falls back to defaults on corrupt storage", () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, "not json {");
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.reducedMotion).toBe(false);
    expect(result.current.keyHints).toBe(true);
    expect(result.current.launchAtLogin).toBe(false);
  });

  it("applies and removes .sw-reduced-motion on the document root", () => {
    const { result, unmount } = renderHook(() => useSettings(), { wrapper });
    const root = document.documentElement;
    expect(root.classList.contains("sw-reduced-motion")).toBe(false);

    act(() => {
      result.current.setReducedMotion(true);
    });
    expect(root.classList.contains("sw-reduced-motion")).toBe(true);

    act(() => {
      result.current.setReducedMotion(false);
    });
    expect(root.classList.contains("sw-reduced-motion")).toBe(false);

    act(() => {
      result.current.setReducedMotion(true);
    });
    unmount();
    expect(root.classList.contains("sw-reduced-motion")).toBe(false);
  });

  it("syncs the autostart plugin with launchAtLogin", async () => {
    const autostart = await import("@tauri-apps/plugin-autostart");
    vi.mocked(autostart.isEnabled).mockResolvedValue(false);
    const { result } = renderHook(() => useSettings(), { wrapper });

    // Mount with launchAtLogin=false checks the entry rather than enabling.
    await waitFor(() => expect(autostart.isEnabled).toHaveBeenCalled());
    expect(autostart.enable).not.toHaveBeenCalled();

    act(() => {
      result.current.setLaunchAtLogin(true);
    });
    await waitFor(() => expect(autostart.enable).toHaveBeenCalledTimes(1));

    vi.mocked(autostart.isEnabled).mockResolvedValue(true);
    act(() => {
      result.current.setLaunchAtLogin(false);
    });
    await waitFor(() => expect(autostart.disable).toHaveBeenCalledTimes(1));
  });

  it("throws when useSettings is used outside the provider", () => {
    expect(() => renderHook(() => useSettings())).toThrow(/within a SettingsProvider/);
  });
});
